import { useEffect, useRef, useState } from 'react'
import * as ort from 'onnxruntime-web/wasm'
import { Download, Eraser, Loader2, Upload } from 'lucide-react'

// Free background remover — port of the tested standalone prototype
// (workspace/scanner-cam-remover-prototype/app-u2netp.js).
//
// Model: U2-Net small (u2netp), Apache-2.0, from rembg's GitHub releases.
// Served same-origin from /models/u2netp.onnx (public/models/u2netp.onnx).
// Preprocessing matches rembg's u2net pipeline: stretch-resize to 320x320,
// rescale 1/255, ImageNet mean/std, float32 CHW tensor. Postprocessing:
// min-max normalise the single-channel output to a 0-255 alpha mask.
// WASM backend only. Never @imgly/background-removal (AGPL-3.0),
// never RMBG-1.4 (non-commercial licence), never int8 + WebGPU.

const MODEL_URL = '/models/u2netp.onnx'
const MODEL_BYTES = 4574861
const MODEL_SIZE = 320
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

// The WASM backend files are copied at build time from node_modules
// (see the copy-ort-wasm plugin in vite.config.ts) into dist/ort-wasm/.
// This mirrors the tested prototype, which served the same pair from a
// local directory. Only the simd-threaded pair is needed: a plain Chromium
// (no SharedArrayBuffer, not cross-origin isolated) fetches exactly these.
ort.env.wasm.wasmPaths = '/ort-wasm/'

const PAGE_TITLE = 'Free Background Remover Online — No Signup, No Upload | ScannerCam'
const PAGE_DESCRIPTION =
  'Remove any photo background free in your browser. No signup, no upload, transparent PNG download. The free remove.bg alternative.'

function upsertMeta(key: string, content: string, attr: 'name' | 'property'): string | null {
  const selector = `meta[${attr}="${key}"]`
  let el = document.querySelector<HTMLMetaElement>(selector)
  let created = false
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
    created = true
  }
  const previous = created ? null : el.getAttribute('content')
  el.setAttribute('content', content)
  return previous
}

export const BackgroundRemover: React.FC = () => {
  const [modelReady, setModelReady] = useState(false)
  const [isLoadingModel, setIsLoadingModel] = useState(false)
  const [loadState, setLoadState] = useState('Model not loaded')
  const [loadProgress, setLoadProgress] = useState(0)
  const [loadLabel, setLoadLabel] = useState('')
  const [imageReady, setImageReady] = useState(false)
  const [sourceInfo, setSourceInfo] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [canDownload, setCanDownload] = useState(false)
  const [timing, setTiming] = useState('')
  const [status, setStatus] = useState('')

  const sessionRef = useRef<ort.InferenceSession | null>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const beforeRef = useRef<HTMLCanvasElement | null>(null)
  const afterRef = useRef<HTMLCanvasElement | null>(null)

  const log = (msg: string) => {
    setStatus((prev) => (prev ? `${prev}\n${msg}` : msg))
    console.log('[remover]', msg)
  }

  // SEO: dynamic SPA meta while this route is mounted.
  useEffect(() => {
    const previousTitle = document.title
    const previousDescription = upsertMeta('description', PAGE_DESCRIPTION, 'name')
    const previousOgTitle = upsertMeta('og:title', PAGE_TITLE, 'property')
    const previousOgDescription = upsertMeta('og:description', PAGE_DESCRIPTION, 'property')
    const previousOgUrl = upsertMeta('og:url', 'https://www.scanner.cam/remove-background', 'property')
    document.title = PAGE_TITLE
    return () => {
      document.title = previousTitle
      const restore = (key: string, previous: string | null, attr: 'name' | 'property') => {
        const el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
        if (!el) return
        if (previous === null) el.remove()
        else el.setAttribute('content', previous)
      }
      restore('description', previousDescription, 'name')
      restore('og:title', previousOgTitle, 'property')
      restore('og:description', previousOgDescription, 'property')
      restore('og:url', previousOgUrl, 'property')
    }
  }, [])

  const loadModel = async () => {
    if (isLoadingModel || modelReady) return
    setIsLoadingModel(true)
    setLoadState('Downloading model…')
    const t0 = performance.now()
    try {
      const res = await fetch(MODEL_URL)
      if (!res.ok) throw new Error(`model fetch failed: HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || MODEL_BYTES
      const reader = res.body?.getReader()
      if (!reader) throw new Error('model download stream unavailable')
      const chunks: Uint8Array[] = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          chunks.push(value)
          received += value.length
          setLoadProgress((received / total) * 100)
          setLoadLabel(`${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`)
        }
      }
      const bytes = new Uint8Array(received)
      let off = 0
      for (const c of chunks) {
        bytes.set(c, off)
        off += c.length
      }
      log(`model downloaded: ${received} bytes in ${((performance.now() - t0) / 1000).toFixed(1)}s`)
      if (received !== MODEL_BYTES) {
        log(`WARNING: expected ${MODEL_BYTES} bytes, got ${received} — continuing anyway`)
      }
      setLoadState('Creating session (WASM)…')
      const t1 = performance.now()
      sessionRef.current = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] })
      log(`session created in ${((performance.now() - t1) / 1000).toFixed(1)}s`)
      log(`session inputs: ${sessionRef.current.inputNames.join(', ')}; outputs: ${sessionRef.current.outputNames.join(', ')}`)
      setLoadState('Model ready')
      setModelReady(true)
    } catch (err) {
      setLoadState('Model load FAILED')
      log(`ERROR loading model: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsLoadingModel(false)
    }
  }

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      try {
        bitmapRef.current = await createImageBitmap(file, { imageOrientation: 'from-image' })
      } catch {
        const url = URL.createObjectURL(file)
        const img = new Image()
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('could not decode image'))
          img.src = url
        })
        bitmapRef.current = await createImageBitmap(img)
        URL.revokeObjectURL(url)
      }
      const bitmap = bitmapRef.current
      sizeRef.current = { w: bitmap.width, h: bitmap.height }
      const before = beforeRef.current
      if (before) {
        before.width = bitmap.width
        before.height = bitmap.height
        before.getContext('2d')?.drawImage(bitmap, 0, 0)
      }
      setSourceInfo(`${bitmap.width} × ${bitmap.height} px`)
      setCanDownload(false)
      setTiming('')
      log(`image loaded: ${bitmap.width}x${bitmap.height}`)
      setImageReady(true)
    } catch (err) {
      log(`ERROR loading image: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const removeBackground = async () => {
    const session = sessionRef.current
    const bitmap = bitmapRef.current
    if (!session || !bitmap || isRunning) return
    setIsRunning(true)
    const t0 = performance.now()
    try {
      const { w: sourceW, h: sourceH } = sizeRef.current
      const c320 = document.createElement('canvas')
      c320.width = MODEL_SIZE
      c320.height = MODEL_SIZE
      const ctx = c320.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('2d canvas unavailable')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, MODEL_SIZE, MODEL_SIZE)
      ctx.drawImage(bitmap, 0, 0, MODEL_SIZE, MODEL_SIZE)
      const px = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data
      const n = MODEL_SIZE * MODEL_SIZE
      const input = new Float32Array(3 * n)
      for (let i = 0; i < n; i++) {
        const r = px[i * 4] / 255
        const g = px[i * 4 + 1] / 255
        const b = px[i * 4 + 2] / 255
        input[i] = (r - MEAN[0]) / STD[0]
        input[n + i] = (g - MEAN[1]) / STD[1]
        input[2 * n + i] = (b - MEAN[2]) / STD[2]
      }
      const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE])

      const feeds: Record<string, ort.Tensor> = {}
      feeds[session.inputNames[0]] = tensor
      const tInfer = performance.now()
      const results = await session.run(feeds)
      const inferMs = performance.now() - tInfer
      const out = results[session.outputNames[0]]
      log(`inference: ${inferMs.toFixed(0)}ms; output dims [${out.dims.join(', ')}], type ${out.type}`)
      const logits = out.data as Float32Array
      if (logits.length < n) throw new Error(`unexpected output length ${logits.length}`)
      let lo = Infinity
      let hi = -Infinity
      for (let i = 0; i < n; i++) {
        if (logits[i] < lo) lo = logits[i]
        if (logits[i] > hi) hi = logits[i]
      }
      const span = hi - lo || 1
      log(`mask range: min ${lo.toFixed(4)}, max ${hi.toFixed(4)}`)

      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = MODEL_SIZE
      maskCanvas.height = MODEL_SIZE
      const mctx = maskCanvas.getContext('2d')
      if (!mctx) throw new Error('2d canvas unavailable')
      const maskImg = mctx.createImageData(MODEL_SIZE, MODEL_SIZE)
      for (let i = 0; i < n; i++) {
        maskImg.data[i * 4 + 3] = Math.round(255 * (logits[i] - lo) / span)
      }
      mctx.putImageData(maskImg, 0, 0)

      const maskFull = document.createElement('canvas')
      maskFull.width = sourceW
      maskFull.height = sourceH
      const fctx = maskFull.getContext('2d')
      if (!fctx) throw new Error('2d canvas unavailable')
      fctx.imageSmoothingEnabled = true
      fctx.imageSmoothingQuality = 'high'
      fctx.drawImage(maskCanvas, 0, 0, sourceW, sourceH)
      const maskAlpha = fctx.getImageData(0, 0, sourceW, sourceH).data

      const after = afterRef.current
      if (!after) throw new Error('result canvas unavailable')
      after.width = sourceW
      after.height = sourceH
      const actx = after.getContext('2d', { willReadFrequently: true })
      if (!actx) throw new Error('2d canvas unavailable')
      actx.drawImage(bitmap, 0, 0)
      const outImg = actx.getImageData(0, 0, sourceW, sourceH)
      for (let i = 0; i < sourceW * sourceH; i++) {
        outImg.data[i * 4 + 3] = maskAlpha[i * 4 + 3]
      }
      actx.putImageData(outImg, 0, 0)

      const totalMs = performance.now() - t0
      setTiming(
        `Inference: ${(inferMs / 1000).toFixed(2)}s · Total (preprocess + inference + composite): ${(totalMs / 1000).toFixed(2)}s`,
      )
      log(`done in ${(totalMs / 1000).toFixed(2)}s total`)
      setCanDownload(true)
    } catch (err) {
      log(`ERROR running model: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsRunning(false)
    }
  }

  const downloadResult = () => {
    const after = afterRef.current
    if (!after) return
    after.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'no-background.png'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }, 'image/png')
  }

  const checkerStyle: React.CSSProperties = {
    backgroundImage: 'conic-gradient(#ddd 25%, #fff 0 50%, #ddd 0 75%, #fff 0)',
    backgroundSize: '20px 20px',
  }

  return (
    <div role="region" aria-labelledby="remover-title" style={{ maxWidth: 1100, margin: '0 auto', padding: '0 1rem 2rem' }}>
      <h1 className="scanner-page-title" id="remover-title">
        Free Background Remover Online
      </h1>
      <p style={{ color: '#475569', maxWidth: 680 }}>
        Remove the background from any photo in your browser. No signup, no upload, no watermark — download a
        transparent PNG.
      </p>
      <p style={{ color: '#475569' }}>
        Your photo never leaves your device — removal runs in your browser. Model: U2-Net small (Apache-2.0).
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', margin: '1.25rem 0' }}>
        <button
          type="button"
          id="remover-load-btn"
          className="btn btn-primary"
          onClick={loadModel}
          disabled={isLoadingModel || modelReady}
        >
          {isLoadingModel ? <Loader2 size={16} className="spin-icon" /> : <Eraser size={16} />}
          <span>1. Load model</span>
        </button>
        <span id="remover-load-state" style={{ color: '#475569', fontSize: '0.9rem' }}>
          {loadState}
        </span>
      </div>
      {(isLoadingModel || loadProgress > 0) && (
        <div style={{ margin: '0 0 1rem' }}>
          <progress id="remover-dl-progress" value={loadProgress} max={100} style={{ width: '100%' }} />
          <span id="remover-dl-label" style={{ color: '#475569', fontSize: '0.9rem' }}>
            {loadLabel}
          </span>
        </div>
      )}

      <div style={{ margin: '1rem 0' }}>
        <label htmlFor="remover-file-input" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>
          2. Choose a photo (JPG / PNG / WebP)
        </label>
        <input
          id="remover-file-input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFile}
        />
        {sourceInfo && (
          <span style={{ color: '#475569', fontSize: '0.9rem', marginLeft: '0.5rem' }}>{sourceInfo}</span>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', margin: '1rem 0' }}>
        <button
          type="button"
          id="remover-run-btn"
          className="btn btn-primary"
          onClick={removeBackground}
          disabled={!modelReady || !imageReady || isRunning}
        >
          {isRunning ? <Loader2 size={16} className="spin-icon" /> : <Upload size={16} />}
          <span>3. Remove background</span>
        </button>
        <button
          type="button"
          id="remover-download-btn"
          className="btn btn-secondary"
          onClick={downloadResult}
          disabled={!canDownload}
        >
          <Download size={16} />
          <span>Download transparent PNG</span>
        </button>
      </div>

      {timing && (
        <p id="remover-timing" style={{ color: '#475569', fontSize: '0.9rem' }}>
          {timing}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Before</h2>
          <canvas
            id="remover-before-canvas"
            ref={beforeRef}
            style={{ maxWidth: '100%', height: 'auto', border: '1px solid #cbd5e1', borderRadius: 8 }}
          />
        </div>
        <div style={{ flex: '1 1 300px' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>After (transparent)</h2>
          <canvas
            id="remover-after-canvas"
            ref={afterRef}
            style={{ maxWidth: '100%', height: 'auto', border: '1px solid #cbd5e1', borderRadius: 8, ...checkerStyle }}
          />
        </div>
      </div>

      <p style={{ color: '#475569', fontSize: '0.9rem', marginTop: '1rem' }}>
        Quality note: best for product photos and portraits. Hair and fine edges can look softer than with premium
        tools — that is the trade-off for a 4.4&nbsp;MB model that runs on phones.
      </p>

      {status && (
        <pre
          id="remover-status"
          style={{
            whiteSpace: 'pre-wrap',
            background: '#f1f5f9',
            padding: '0.75rem',
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            borderRadius: 8,
            marginTop: '1rem',
          }}
        >
          {status}
        </pre>
      )}
    </div>
  )
}
