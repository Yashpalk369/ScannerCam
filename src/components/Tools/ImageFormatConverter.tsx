import { useEffect, useRef, useState } from 'react'
import { Download, Image as ImageIcon, Upload } from 'lucide-react'

type OutputFormat = 'jpeg' | 'png' | 'webp'
type Conversion = { url: string; bytes: number; width: number; height: number; format: OutputFormat }

const MAX_BYTES = 40 * 1024 * 1024
const MAX_PIXELS = 20_000_000
const EXTENSION: Record<OutputFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }

/** Convert images on the device, without copying source metadata to the output. */
export function ImageFormatConverter() {
  const fileInput = useRef<HTMLInputElement>(null)
  const generationRef = useRef(0)
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState<OutputFormat>('jpeg')
  const [result, setResult] = useState<Conversion | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])
  useEffect(() => () => { generationRef.current++ }, [])

  function select(chosen?: File) {
    if (!chosen || busy) return
    setFile(null)
    setResult(null)
    setMessage('')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(chosen.type)) {
      setMessage('Choose a JPG, PNG or WebP image.')
      return
    }
    if (chosen.size > MAX_BYTES) {
      setMessage('Choose an image of 40 MiB or less.')
      return
    }
    setFile(chosen)
  }

  async function convert() {
    if (!file || busy) return
    const generation = ++generationRef.current
    setBusy(true)
    setMessage('Converting on your device…')
    setResult(null)
    const sourceUrl = URL.createObjectURL(file)
    const canvas = document.createElement('canvas')
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Could not open this image. Try another file.'))
        image.src = sourceUrl
      })
      const width = image.naturalWidth
      const height = image.naturalHeight
      if (!width || !height || width * height > MAX_PIXELS) throw new Error('Choose an image no larger than 20 megapixels.')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Your browser could not create an image. Try another browser.')
      if (format === 'jpeg') {
        context.fillStyle = '#fff'
        context.fillRect(0, 0, width, height)
      }
      context.drawImage(image, 0, 0)
      const mime = `image/${format}`
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('Could not create the image. Try another browser.')),
        mime, 0.92,
      ))
      // Some browsers silently fall back to PNG for unsupported encoders.
      if (blob.type.toLowerCase() !== mime) throw new Error(`Your browser cannot export ${format.toUpperCase()}. Choose another format.`)
      if (generation !== generationRef.current) return
      setResult({ url: URL.createObjectURL(blob), bytes: blob.size, width, height, format })
      setMessage('Conversion complete. Review the preview before downloading.')
    } catch (error) {
      if (generation === generationRef.current) setMessage(error instanceof Error ? error.message : 'Could not convert this image.')
    } finally {
      URL.revokeObjectURL(sourceUrl)
      canvas.width = canvas.height = 1
      if (generation === generationRef.current) setBusy(false)
    }
  }

  return <section className="remover-workbench" aria-label="Image format converter" aria-busy={busy}>
    <div className="tool-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); select(event.dataTransfer.files[0]) }}>
      <ImageIcon size={32} aria-hidden="true" />
      <h2>Choose an image</h2>
      <p>JPG, PNG or WebP · up to 40 MiB and 20 megapixels. Files are processed on your device.</p>
      <input ref={fileInput} aria-label="Choose an image" type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={event => { select(event.target.files?.[0]); event.currentTarget.value = '' }} />
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={18} />{file ? 'Choose another image' : 'Choose image'}</button>
      <p className="tool-note">Animated images are converted to a still image. Metadata is not preserved. JPG fills transparent areas with white.</p>
    </div>
    {file && <div className="tool-actions">
      <span>{file.name}</span>
      <label htmlFor="convert-format">Output format</label>
      <select id="convert-format" value={format} disabled={busy} onChange={event => { setFormat(event.currentTarget.value as OutputFormat); setResult(null) }}>
        <option value="jpeg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option>
      </select>
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void convert()}>{busy ? 'Converting…' : 'Convert image'}</button>
    </div>}
    {message && <p className="tool-message" role="status" aria-live="polite">{message}</p>}
    {result && <div>
      <p>Output: {result.width} × {result.height} pixels · {result.bytes.toLocaleString()} bytes</p>
      <img src={result.url} alt="Converted image preview" style={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain' }} />
      <div className="tool-actions"><a className="btn btn-secondary" href={result.url} download={`${(file?.name ?? 'image').replace(/\.[^.]+$/, '')}.${EXTENSION[result.format]}`}><Download size={18} />Download {EXTENSION[result.format].toUpperCase()}</a></div>
    </div>}
  </section>
}
