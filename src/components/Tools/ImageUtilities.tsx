import { useEffect, useRef, useState } from 'react'
import { Download, Image as ImageIcon, Upload } from 'lucide-react'

type Mode = 'resize-image-to-kb' | 'heic-to-jpg'
type Result = { url: string; size: number; width: number; height: number; metTarget: boolean }

// File-size limits on submission portals are commonly specified in decimal KB.
const formatSize = (bytes: number) => `${(bytes / 1000).toFixed(1)} KB (${bytes.toLocaleString()} bytes)`

async function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('Could not create a JPG. Try another image.')),
    'image/jpeg', quality,
  ))
}

async function decodePhoto(file: File): Promise<{ image: HTMLImageElement; release: () => void }> {
  // Reuse the scanner's local HEIC conversion and its native-browser fallback.
  const { importFile } = await import('../../core/import/files')
  let blob: Blob | undefined
  for await (const item of importFile(file)) { blob = item.blob; break }
  if (!blob) throw new Error('Could not open the image.')
  const url = URL.createObjectURL(blob)
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Could not open this image. Try a JPG or PNG.'))
      image.src = url
    })
    return { image, release: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

export function ImageUtilities({ mode }: { mode: Mode }) {
  const isResize = mode === 'resize-image-to-kb'
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [target, setTarget] = useState('100')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])

  const select = (chosen?: File) => {
    if (!chosen) return
    setResult(null)
    setFile(null)
    setMessage('')
    const isHeic = /\.(heic|heif)$/i.test(chosen.name) || /image\/hei[cf]/i.test(chosen.type)
    if ((!isResize && !isHeic) || (isResize && !isHeic && !['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type))) {
      setMessage(isResize ? 'Choose a JPG, PNG, WebP, or HEIC image.' : 'Choose a HEIC or HEIF photo.')
      return
    }
    if (chosen.size > 40 * 1024 * 1024) { setMessage('Choose an image smaller than 40 MB.'); return }
    setFile(chosen)
  }

  const run = async () => {
    if (!file || busy) return
    const kb = Number(target)
    if (isResize && (!Number.isFinite(kb) || kb < 5 || kb > 10240)) {
      setMessage('Enter a target between 5 KB and 10,240 KB.')
      return
    }
    setBusy(true)
    setResult(null)
    setMessage('Processing your image on this device…')
    let release: (() => void) | undefined
    const canvas = document.createElement('canvas')
    try {
      const decoded = await decodePhoto(file)
      release = decoded.release
      const { image } = decoded
      if (image.naturalWidth * image.naturalHeight > 20_000_000) throw new Error('Choose a photo under 20 megapixels.')
      if (!image.naturalWidth || !image.naturalHeight) throw new Error('Could not read image dimensions.')
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Your browser could not create an image. Try another browser.')
      let best: { blob: Blob; width: number; height: number } | undefined
      let smallest: { blob: Blob; width: number; height: number } | undefined
      let scale = 1
      const byteLimit = kb * 1000
      for (let attempt = 0; attempt < (isResize ? 9 : 1); attempt++) {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        if (!isResize) {
          best = { blob: await canvasBlob(canvas, 0.94), width: canvas.width, height: canvas.height }
          break
        }
        // Search at each resolution, keeping the highest-quality output that meets the limit.
        let low = 0.25, high = 0.95
        for (let pass = 0; pass < 7; pass++) {
          const quality = pass === 0 ? low : (low + high) / 2
          const blob = await canvasBlob(canvas, quality)
          const candidate = { blob, width: canvas.width, height: canvas.height }
          if (!smallest || blob.size < smallest.blob.size) smallest = candidate
          if (blob.size <= byteLimit) { best = candidate; low = quality } else high = quality
        }
        if (best) break
        scale *= 0.75
      }
      const chosen = best ?? smallest
      if (!chosen) throw new Error('Could not prepare the image.')
      const metTarget = !isResize || chosen.blob.size <= byteLimit
      setResult({ url: URL.createObjectURL(chosen.blob), size: chosen.blob.size, width: chosen.width, height: chosen.height, metTarget })
      setMessage(metTarget ? 'Your JPG is ready. Check the preview before downloading.' : 'The target could not be reached. This is the smallest result; try a larger target or a simpler image.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not process this image. Try another photo.')
    } finally {
      canvas.width = canvas.height = 1
      release?.()
      setBusy(false)
    }
  }

  return <section className="remover-workbench" aria-label={isResize ? 'Image size workspace' : 'HEIC conversion workspace'} aria-busy={busy}>
    <div className="tool-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) select(event.dataTransfer.files[0]) }}>
      <ImageIcon size={32} aria-hidden="true" />
      <h2>{isResize ? 'Choose an image to resize' : 'Choose a HEIC photo'}</h2>
      <p>{isResize ? 'JPG, PNG, WebP, or HEIC' : 'HEIC or HEIF'} · up to 40 MB and 20 megapixels. The output is a JPG; transparent areas become white.</p>
      <input ref={fileRef} aria-label={isResize ? 'Choose an image' : 'Choose a HEIC photo'} type="file" accept={isResize ? 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif' : 'image/heic,image/heif,.heic,.heif'} hidden disabled={busy} onChange={event => { select(event.target.files?.[0]); event.target.value = '' }} />
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={18} />{file ? 'Choose another image' : 'Choose image'}</button>
      <p className="tool-note">No signup · Your image stays on your device</p>
    </div>
    {file && <div className="tool-actions">
      <span>{file.name} · {formatSize(file.size)}</span>
      {isResize && <>
        <label htmlFor="image-size-target">Maximum size (KB, 1 KB = 1,000 bytes) </label>
        <input id="image-size-target" type="number" min="5" max="10240" step="1" value={target} disabled={busy} onChange={event => { setTarget(event.target.value); setResult(null) }} />
        {[20, 50, 100, 200].map(value => <button key={value} className="btn btn-secondary" type="button" disabled={busy} aria-pressed={target === String(value)} onClick={() => { setTarget(String(value)); setResult(null) }}>{value} KB</button>)}
      </>}
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void run()}>{busy ? 'Processing…' : isResize ? 'Resize image' : 'Convert to JPG'}</button>
    </div>}
    {message && <p className="tool-message" role="status">{message}</p>}
    {result && <div>
      <p><strong>{result.metTarget ? 'Output' : 'Smallest output'}:</strong> {formatSize(result.size)} · {result.width} × {result.height} pixels</p>
      <img src={result.url} alt="Converted image preview" style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} />
      <div className="tool-actions"><a className="btn btn-secondary" href={result.url} download={`${(file?.name ?? 'image').replace(/\.[^.]+$/, '')}.jpg`}><Download size={18} />Download JPG</a></div>
    </div>}
  </section>
}
