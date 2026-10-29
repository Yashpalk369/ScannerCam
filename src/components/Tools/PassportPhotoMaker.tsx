import { useEffect, useRef, useState } from 'react'
import { Download, Image as ImageIcon, Upload } from 'lucide-react'

type Preset = '35x45' | '2x2' | 'custom'

export function PassportPhotoMaker() {
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [name, setName] = useState('photo')
  const [preset, setPreset] = useState<Preset>('35x45')
  const [customWidth, setCustomWidth] = useState('413')
  const [customHeight, setCustomHeight] = useState('531')
  const [zoom, setZoom] = useState(1)
  const [x, setX] = useState(50)
  const [y, setY] = useState(50)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const width = preset === '35x45' ? 413 : preset === '2x2' ? 600 : Number(customWidth)
  const height = preset === '35x45' ? 531 : preset === '2x2' ? 600 : Number(customHeight)
  const validDimensions = Number.isInteger(width) && Number.isInteger(height) && width >= 50 && height >= 50 && width <= 3000 && height <= 3000

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !image || !validDimensions) return
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) { setMessage('Your browser could not create the photo. Try another browser.'); return }
    const ratio = width / height
    const baseWidth = Math.min(image.naturalWidth, image.naturalHeight * ratio)
    const baseHeight = baseWidth / ratio
    const sourceWidth = baseWidth / zoom
    const sourceHeight = baseHeight / zoom
    const left = (image.naturalWidth - sourceWidth) * x / 100
    const top = (image.naturalHeight - sourceHeight) * y / 100
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, left, top, sourceWidth, sourceHeight, 0, 0, width, height)
  }, [image, validDimensions, width, height, zoom, x, y])

  const selectPhoto = async (file?: File) => {
    if (!file || busy) return
    setMessage('')
    setImage(null)
    if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) { setMessage('Choose a JPG, PNG, WebP, or HEIC photo.'); return }
    if (file.size > 40 * 1024 * 1024) { setMessage('Choose a photo smaller than 40 MB.'); return }
    setBusy(true)
    let url = ''
    try {
      const { importFile } = await import('../../core/import/files')
      let blob: Blob | undefined
      for await (const item of importFile(file)) { blob = item.blob; break }
      if (!blob) throw new Error('Could not open the photo.')
      url = URL.createObjectURL(blob)
      const loaded = new Image()
      await new Promise<void>((resolve, reject) => {
        loaded.onload = () => resolve()
        loaded.onerror = () => reject(new Error('Could not open the photo. Try a JPG or PNG.'))
        loaded.src = url
      })
      if (!loaded.naturalWidth || !loaded.naturalHeight || loaded.naturalWidth * loaded.naturalHeight > 20_000_000) throw new Error('Choose a photo under 20 megapixels.')
      setName(file.name.replace(/\.[^.]+$/, ''))
      setZoom(1); setX(50); setY(50)
      setImage(loaded)
      setMessage('Adjust the crop and review the preview before downloading.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open this photo.')
    } finally {
      if (url) URL.revokeObjectURL(url)
      setBusy(false)
    }
  }

  const download = () => {
    const canvas = canvasRef.current
    if (!canvas || !validDimensions) return
    canvas.toBlob(blob => {
      if (!blob) { setMessage('Could not create the JPG. Try again.'); return }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = `${name}-photo.jpg`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    }, 'image/jpeg', 0.95)
  }

  return <section className="remover-workbench" aria-label="Photo crop workspace" aria-busy={busy}>
    <div className="tool-upload" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void selectPhoto(event.dataTransfer.files[0]) }}>
      <ImageIcon size={32} aria-hidden="true" />
      <h2>Crop and resize your photo</h2>
      <p>Choose a JPG, PNG, WebP, or HEIC photo up to 40 MB and 20 megapixels.</p>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" aria-label="Choose a photo" hidden disabled={busy} onChange={event => { void selectPhoto(event.target.files?.[0]); event.target.value = '' }} />
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={18} />{busy ? 'Opening photo…' : image ? 'Choose another photo' : 'Choose a photo'}</button>
      <p className="tool-note">Your photo is processed on your device.</p>
    </div>
    {image && <>
      <div className="tool-actions">
        <label htmlFor="photo-size">Photo size </label>
        <select id="photo-size" value={preset} onChange={event => setPreset(event.target.value as Preset)}>
          <option value="35x45">35 × 45 mm — 413 × 531 pixels</option>
          <option value="2x2">2 × 2 inches — 600 × 600 pixels</option>
          <option value="custom">Custom pixels</option>
        </select>
        {preset === 'custom' && <><label>Width (px) <input type="number" min="50" max="3000" value={customWidth} onChange={event => setCustomWidth(event.target.value)} /></label><label>Height (px) <input type="number" min="50" max="3000" value={customHeight} onChange={event => setCustomHeight(event.target.value)} /></label></>}
      </div>
      {!validDimensions && <p role="alert">Enter whole-number dimensions between 50 and 3,000 pixels.</p>}
      <div className="tool-actions">
        <label>Zoom <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
        <label>Horizontal position <input type="range" min="0" max="100" value={x} onChange={event => setX(Number(event.target.value))} /></label>
        <label>Vertical position <input type="range" min="0" max="100" value={y} onChange={event => setY(Number(event.target.value))} /></label>
      </div>
      {validDimensions && <p>Output: {width} × {height} pixels. Presets are sized at approximately 300 pixels per inch.</p>}
      <canvas ref={canvasRef} aria-label="Cropped photo preview" style={{ display: validDimensions ? 'block' : 'none', maxWidth: '100%', maxHeight: 400, border: '1px solid #dbe4ed' }} />
      <p className="tool-note">This tool crops and resizes only; it does not change the background or verify official requirements. Check the current rules for your application before submitting.</p>
      <button className="btn btn-primary" type="button" disabled={!validDimensions} onClick={download}><Download size={18} />Download JPG</button>
    </>}
    {message && <p className="tool-message" role="status">{message}</p>}
  </section>
}
