import { useEffect, useRef, useState } from 'react'
import { Download, Image as ImageIcon, Upload } from 'lucide-react'

const MAX_BYTES = 40 * 1024 * 1024
const MAX_PIXELS = 20_000_000
const MAX_SIDE = 10_000
type Format = 'png' | 'jpeg' | 'webp'
type Source = { url: string; name: string; width: number; height: number }
type Output = { url: string; width: number; height: number; bytes: number; format: Format }

/** Resize still images locally; JPEG exports composite transparent pixels onto white. */
export function ResizeImagePixels() {
  const inputRef = useRef<HTMLInputElement>(null)
  const generationRef = useRef(0)
  const [source, setSource] = useState<Source | null>(null)
  const [output, setOutput] = useState<Output | null>(null)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [locked, setLocked] = useState(true)
  const [format, setFormat] = useState<Format>('png')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Choose a JPG, PNG or WebP image.')

  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url) }, [source])
  useEffect(() => () => { if (output) URL.revokeObjectURL(output.url) }, [output])
  useEffect(() => () => { generationRef.current++ }, [])

  async function choose(file?: File) {
    if (!file || busy) return
    const generation = ++generationRef.current
    setOutput(null); setSource(null); setWidth(''); setHeight('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setStatus('Choose a JPG, PNG or WebP image.'); return
    }
    if (file.size > MAX_BYTES) { setStatus('Choose an image no larger than 40 MiB.'); return }
    setBusy(true); setStatus('Opening image on your device…')
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not open this image.'))
        image.src = url
      })
      if (generation !== generationRef.current) { URL.revokeObjectURL(url); return }
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_PIXELS) throw new Error('Choose an image of at most 20 megapixels.')
      setSource({ url, name: file.name, width: image.naturalWidth, height: image.naturalHeight })
      setWidth(String(image.naturalWidth)); setHeight(String(image.naturalHeight))
      setStatus(`Image loaded: ${image.naturalWidth} × ${image.naturalHeight} pixels.`)
    } catch (error) {
      URL.revokeObjectURL(url)
      if (generation === generationRef.current) setStatus(error instanceof Error ? error.message : 'Could not open the image.')
    } finally { if (generation === generationRef.current) setBusy(false) }
  }

  function updateDimension(axis: 'width' | 'height', value: string) {
    setOutput(null)
    if (axis === 'width') setWidth(value); else setHeight(value)
    const number = Number(value)
    if (!locked || !source || !Number.isInteger(number) || number < 1 || number > MAX_SIDE) return
    if (axis === 'width') setHeight(String(Math.max(1, Math.round(number * source.height / source.width))))
    else setWidth(String(Math.max(1, Math.round(number * source.width / source.height))))
  }

  async function resize() {
    if (!source || busy) return
    const w = Number(width), h = Number(height)
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) {
      setOutput(null); setStatus('Choose whole-number dimensions from 1 to 10,000 pixels and at most 20 megapixels.'); return
    }
    const generation = ++generationRef.current
    setBusy(true); setOutput(null); setStatus('Resizing on your device…')
    const canvas = document.createElement('canvas')
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not open this image.'))
        image.src = source.url
      })
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Your browser could not create an image.')
      if (format === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h) }
      ctx.drawImage(image, 0, 0, w, h)
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not create the image.')), `image/${format}`, 0.92))
      if (blob.type !== `image/${format}`) throw new Error('Your browser does not support this output format. Try PNG or JPG.')
      if (generation !== generationRef.current) return
      setOutput({ url: URL.createObjectURL(blob), width: w, height: h, bytes: blob.size, format })
      setStatus('Resized image ready. Review the preview before downloading.')
    } catch (error) { if (generation === generationRef.current) setStatus(error instanceof Error ? error.message : 'Could not resize the image.') }
    finally { canvas.width = canvas.height = 1; if (generation === generationRef.current) setBusy(false) }
  }

  return <section className="remover-workbench" aria-label="Resize image by pixels" aria-busy={busy}>
    <div className="tool-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void choose(event.dataTransfer.files[0]) }}>
      <ImageIcon size={32} aria-hidden="true" />
      <h2>Resize an image by pixels</h2>
      <p>JPG, PNG or WebP · up to 40 MiB and 20 megapixels. Images stay on your device.</p>
      <input ref={inputRef} type="file" hidden accept="image/jpeg,image/png,image/webp" aria-label="Choose image" disabled={busy} onChange={event => { void choose(event.target.files?.[0]); event.target.value = '' }} />
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => inputRef.current?.click()}><Upload size={18} />{source ? 'Choose another image' : 'Choose image'}</button>
    </div>
    {source && <div className="tool-actions" style={{ alignItems: 'stretch', flexDirection: 'column' }}>
      <p>Original: {source.width} × {source.height} pixels</p>
      <label>Width (pixels) <input type="number" min="1" max={MAX_SIDE} step="1" value={width} disabled={busy} onChange={event => updateDimension('width', event.target.value)} /></label>
      <label>Height (pixels) <input type="number" min="1" max={MAX_SIDE} step="1" value={height} disabled={busy} onChange={event => updateDimension('height', event.target.value)} /></label>
      <label><input type="checkbox" checked={locked} disabled={busy} onChange={event => { const next = event.target.checked; setLocked(next); setOutput(null); const w = Number(width); if (next && Number.isInteger(w) && w >= 1 && w <= MAX_SIDE) setHeight(String(Math.max(1, Math.round(w * source.height / source.width)))) }} /> Lock aspect ratio</label>
      <label>Output format <select value={format} disabled={busy} onChange={event => { setFormat(event.target.value as Format); setOutput(null) }}><option value="png">PNG</option><option value="jpeg">JPG</option><option value="webp">WebP</option></select></label>
      <p>PNG and WebP can preserve transparency. JPG fills transparent areas with white. Animated images are exported as a still frame.</p>
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void resize()}>Resize image</button>
    </div>}
    <p role="status" aria-live="polite">{status}</p>
    {output && source && <div><p>Output: {output.width} × {output.height} pixels · {output.bytes.toLocaleString()} bytes</p><img src={output.url} alt="Resized image preview" style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} /><div className="tool-actions"><a className="btn btn-secondary" href={output.url} download={`${source.name.replace(/\.[^.]+$/, '')}-resized.${output.format === 'jpeg' ? 'jpg' : output.format}`}><Download size={18} />Download image</a></div></div>}
  </section>
}
