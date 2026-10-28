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

export const BackgroundRemover: React.FC = () => {
  const [isLoadingModel, setIsLoadingModel] = useState(false)
  const [loadState, setLoadState] = useState('Model not loaded')
  const [loadProgress, setLoadProgress] = useState(0)
  const [loadLabel, setLoadLabel] = useState('')
  const [isDecoding, setIsDecoding] = useState(false)
  const decodingRef = useRef(false)
  const [imageReady, setImageReady] = useState(false)
  const [sourceInfo, setSourceInfo] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [canDownload, setCanDownload] = useState(false)
  const [, setTiming] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const loadingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const [status, setStatus] = useState('')

  const sessionRef = useRef<ort.InferenceSession | null>(null)
  const bitmapRef = useRef<ImageBitmap | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const beforeRef = useRef<HTMLCanvasElement | null>(null)
  const afterRef = useRef<HTMLCanvasElement | null>(null)

  const log = (message: string) => console.debug('[remover]', message)
  useEffect(
    () => () => {
      abortRef.current?.abort()
      bitmapRef.current?.close()
      void sessionRef.current?.release()
    },
    [],
  )

  const loadModel = async () => {
    if (sessionRef.current) return sessionRef.current
    if (loadingRef.current) return
    loadingRef.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setIsLoadingModel(true)
    setLoadState('Downloading processing files…')
    const t0 = performance.now()
    try {
      const res = await fetch(MODEL_URL, { signal: controller.signal })
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
          setLoadLabel(
            `${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`,
          )
        }
      }
      const bytes = new Uint8Array(received)
      let off = 0
      for (const c of chunks) {
        bytes.set(c, off)
        off += c.length
      }
      log(
        `model downloaded: ${received} bytes in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
      )
      if (received !== MODEL_BYTES) {
        throw new Error('The processing files were incomplete. Please retry.')
      }
      setLoadState('Preparing background removal…')
      const t1 = performance.now()
      sessionRef.current = await ort.InferenceSession.create(bytes, {
        executionProviders: ['wasm'],
      })
      log(`session created in ${((performance.now() - t1) / 1000).toFixed(1)}s`)
      log(
        `session inputs: ${sessionRef.current.inputNames.join(', ')}; outputs: ${sessionRef.current.outputNames.join(', ')}`,
      )
      setLoadState('Model ready')
      return sessionRef.current
    } catch (err) {
      setLoadState('Model load FAILED')
      if (!controller.signal.aborted)
        setStatus(
          'Could not download processing files. Check your connection and retry.',
        )
    } finally {
      loadingRef.current = false
      setIsLoadingModel(false)
    }
  }

  const handleFile = async (file?: File) => {
    if (!file || isRunning || isLoadingModel || decodingRef.current) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setStatus('Choose a JPG, PNG, or WebP photo.')
      return
    }
    if (file.size > 40 * 1024 * 1024) {
      setStatus('Choose a photo smaller than 40 MB.')
      return
    }
    decodingRef.current = true
    setIsDecoding(true)
    setCanDownload(false)
    setImageReady(false)
    setStatus('')
    bitmapRef.current?.close()
    try {
      try {
        bitmapRef.current = await createImageBitmap(file, {
          imageOrientation: 'from-image',
        })
      } catch {
        const url = URL.createObjectURL(file)
        const img = new Image()
        try {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve()
            img.onerror = () => reject(new Error('could not decode image'))
            img.src = url
          })
          bitmapRef.current = await createImageBitmap(img)
        } finally {
          URL.revokeObjectURL(url)
        }
      }
      const bitmap = bitmapRef.current
      if (bitmap.width * bitmap.height > 20000000) {
        bitmap.close()
        bitmapRef.current = null
        throw new Error('Choose a photo with fewer than 20 million pixels.')
      }
      afterRef.current
        ?.getContext('2d')
        ?.clearRect(0, 0, afterRef.current.width, afterRef.current.height)
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
      setStatus(
        err instanceof Error
          ? err.message
          : 'Could not read this photo. Try another image.',
      )
    } finally {
      decodingRef.current = false
      setIsDecoding(false)
    }
  }

  const removeBackground = async () => {
    const bitmap = bitmapRef.current
    if (!bitmap || isRunning) return
    setIsRunning(true)
    setCanDownload(false)
    setStatus('')
    const t0 = performance.now()
    try {
      const session = await loadModel()
      if (!session) return
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
      const tensor = new ort.Tensor('float32', input, [
        1,
        3,
        MODEL_SIZE,
        MODEL_SIZE,
      ])

      const feeds: Record<string, ort.Tensor> = {}
      feeds[session.inputNames[0]] = tensor
      const tInfer = performance.now()
      const results = await session.run(feeds)
      const inferMs = performance.now() - tInfer
      const out = results[session.outputNames[0]]
      log(
        `inference: ${inferMs.toFixed(0)}ms; output dims [${out.dims.join(', ')}], type ${out.type}`,
      )
      const logits = out.data as Float32Array
      if (logits.length < n)
        throw new Error(`unexpected output length ${logits.length}`)
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
        maskImg.data[i * 4 + 3] = Math.round((255 * (logits[i] - lo)) / span)
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
        outImg.data[i * 4 + 3] = Math.round(
          (outImg.data[i * 4 + 3] * maskAlpha[i * 4 + 3]) / 255,
        )
      }
      actx.putImageData(outImg, 0, 0)

      const totalMs = performance.now() - t0
      setTiming(
        `Inference: ${(inferMs / 1000).toFixed(2)}s · Total (preprocess + inference + composite): ${(totalMs / 1000).toFixed(2)}s`,
      )
      log(`done in ${(totalMs / 1000).toFixed(2)}s total`)
      tensor.dispose()
      for (const output of Object.values(results)) output.dispose()
      setCanDownload(true)
      setStatus('Background removed. Review the edges before downloading.')
    } catch (err) {
      setStatus('Could not process this photo. Try a smaller image or retry.')
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

  return (
    <section
      className="remover-workbench"
      aria-label="Background removal workspace"
      aria-busy={isRunning}
    >
      <div
        className="tool-upload"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          void handleFile(event.dataTransfer.files[0])
        }}
      >
        <Eraser size={32} aria-hidden="true" />
        <h2>
          {imageReady
            ? 'Your photo is ready'
            : 'Give your photo a clean background'}
        </h2>
        <p>
          Choose a photo or drop it here. JPG, PNG, or WebP · up to 40 MB and 20
          megapixels.
        </p>
        <input
          ref={fileRef}
          id="remover-file-input"
          aria-label="Choose a photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          disabled={isRunning || isDecoding}
          onChange={(event) => {
            void handleFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <button
          type="button"
          className={`btn ${imageReady ? 'btn-secondary' : 'btn-primary'}`}
          disabled={isRunning || isDecoding}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={18} />
          {isDecoding
            ? 'Reading photo…'
            : imageReady
              ? 'Choose another photo'
              : 'Choose a photo'}
        </button>
        <p className="tool-note">
          No signup · No watermark · Your photo stays on your device
        </p>
      </div>
      {imageReady && (
        <div className="tool-actions">
          <button
            type="button"
            id="remover-run-btn"
            className="btn btn-primary"
            onClick={() => void removeBackground()}
            disabled={isRunning || isDecoding}
          >
            {isRunning ? (
              <Loader2 size={18} className="spin-icon" />
            ) : (
              <Eraser size={18} />
            )}
            {isLoadingModel
              ? 'Preparing…'
              : isRunning
                ? 'Removing background…'
                : 'Remove background'}
          </button>
          {canDownload && (
            <button
              type="button"
              id="remover-download-btn"
              className="btn btn-secondary"
              onClick={downloadResult}
            >
              <Download size={18} />
              Download transparent PNG
            </button>
          )}
          <span className="tool-note">{sourceInfo}</span>
        </div>
      )}
      {isLoadingModel && (
        <div role="status" className="tool-progress">
          <p>
            {loadState} {loadLabel}
          </p>
          <progress
            aria-label="Processing files download"
            value={loadProgress}
            max={100}
          />
        </div>
      )}
      {status && (
        <p className="tool-message" role="status">
          {status}
        </p>
      )}
      <div className="remover-previews" hidden={!imageReady}>
        <figure>
          <figcaption>Original</figcaption>
          <div className="image-preview">
            <canvas
              ref={beforeRef}
              id="remover-before-canvas"
              aria-label="Original photo"
            />
          </div>
        </figure>
        <figure>
          <figcaption>
            {canDownload
              ? 'Background removed'
              : 'Your result will appear here'}
          </figcaption>
          <div className="image-preview checkerboard">
            <canvas
              ref={afterRef}
              id="remover-after-canvas"
              aria-label="Transparent result"
              style={{ visibility: canDownload ? 'visible' : 'hidden' }}
            />
          </div>
        </figure>
      </div>
      <p className="tool-note">
        Best for portraits and product photos. Hair, glass, and fine edges may
        need further editing.
      </p>
    </section>
  )
}
