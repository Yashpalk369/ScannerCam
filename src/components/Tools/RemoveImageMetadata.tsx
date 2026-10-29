import { useEffect, useRef, useState } from 'react'
import { Download, ShieldCheck, Upload } from 'lucide-react'
import { inspectImageForMetadataRemoval } from '../../core/image/metadataRemoval'

const MAX_BYTES = 40 * 1024 * 1024
const MAX_PIXELS = 20_000_000

/** Re-encode a still image on-device: source metadata is not copied to the new file. */
export function RemoveImageMetadata() {
  const inputRef = useRef<HTMLInputElement>(null)
  const currentUrl = useRef<string | null>(null)
  const job = useRef(0)
  const [output, setOutput] = useState<{ url: string; name: string; size: number } | null>(null)
  const [status, setStatus] = useState('')
  const [working, setWorking] = useState(false)

  useEffect(() => () => {
    job.current++
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current)
  }, [])

  async function process(file: File) {
    const id = ++job.current
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current)
    currentUrl.current = null
    setOutput(null)
    setWorking(true)
    setStatus('Preparing your image on this device…')
    try {
      if (file.size > MAX_BYTES) throw new Error('Choose an image smaller than 40 MB.')
      const bytes = new Uint8Array(await file.arrayBuffer())
      const kind = inspectImageForMetadataRemoval(bytes)
      const bitmap = await createImageBitmap(file)
      try {
        if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_PIXELS) throw new Error('Choose an image no larger than 20 megapixels.')
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Could not prepare the image in this browser.')
        context.drawImage(bitmap, 0, 0)
        const mime = kind === 'jpeg' ? 'image/jpeg' : 'image/png'
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, mime, 0.95))
        if (!blob || blob.type !== mime) throw new Error('Could not save the image in this browser.')
        if (id !== job.current) return
        const url = URL.createObjectURL(blob)
        currentUrl.current = url
        const basename = file.name.replace(/\.[^.]+$/, '') || 'image'
        setOutput({ url, name: `${basename}-metadata-removed.${kind === 'jpeg' ? 'jpg' : 'png'}`, size: blob.size })
        setStatus('Ready to download. The original file has not been changed.')
      } finally {
        bitmap.close()
      }
    } catch (error) {
      if (id === job.current) setStatus(error instanceof Error ? error.message : 'Could not process this image. Try another JPEG or PNG.')
    } finally {
      if (id === job.current) setWorking(false)
    }
  }

  return <section className="tool-explainer" aria-label="Remove image metadata workspace">
    <h2>Remove metadata from an image</h2>
    <p>Choose a JPEG or still PNG up to 40 MB and 20 megapixels. A new image is created on your device; source EXIF, GPS and other embedded metadata are not copied.</p>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void process(file); event.target.value = '' }} />
    <button className="btn btn-primary" type="button" disabled={working} onClick={() => inputRef.current?.click()}><Upload size={18} /> {working ? 'Processing…' : 'Choose JPEG or PNG'}</button>
    {output && <p><a className="btn btn-primary" href={output.url} download={output.name}><Download size={18} /> Download cleaned image ({(output.size / 1024).toFixed(0)} KB)</a></p>}
    <p role="status" aria-live="polite">{status}</p>
    <p><ShieldCheck size={16} aria-hidden="true" /> The image stays on your device. Re-encoding may change image quality or colors and removes color profiles. Animated images are not supported.</p>
    <p>Metadata removal cannot hide faces, text, landmarks or other information visible in the picture. The original remains on your device; check the downloaded copy before sharing.</p>
  </section>
}
