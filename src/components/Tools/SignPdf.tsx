import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist'
import { Download, Upload } from 'lucide-react'
import './sign-pdf.css'

const MAX_BYTES = 80 * 1024 * 1024
const MAX_PAGES = 100

/**
 * Browser-local, image-based PDF signing. The output is a new raster PDF;
 * this does not create a cryptographic digital signature.
 */
export function SignPdf() {
  const inputRef = useRef<HTMLInputElement>(null)
  const signatureRef = useRef<HTMLCanvasElement>(null)
  const signatureInputRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const drawingRef = useRef(false)
  const [filename, setFilename] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [pdfRevision, setPdfRevision] = useState(0)
  const [pageAspect, setPageAspect] = useState(1)
  const [pageNumber, setPageNumber] = useState(1)
  const [signature, setSignature] = useState('')
  const [typedSignature, setTypedSignature] = useState('')
  const [position, setPosition] = useState({ x: 0.1, y: 0.7 })
  const [width, setWidth] = useState(30)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => () => { void loadingTaskRef.current?.destroy() }, [])

  useEffect(() => {
    const pdf = pdfRef.current
    const canvas = previewRef.current
    if (!pdf || !canvas) return
    let cancelled = false
    let task: { cancel: () => void; promise: Promise<void> } | undefined
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        if (cancelled) return
        const original = page.getViewport({ scale: 1 })
        setPageAspect(original.width / original.height)
        const viewport = page.getViewport({ scale: Math.min(1.5, 1000 / Math.max(original.width, original.height)) })
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        task = page.render({ canvas, viewport, background: '#ffffff' })
        await task.promise
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? `Could not preview page: ${error.message}` : 'Could not preview page.')
      }
    })()
    return () => { cancelled = true; task?.cancel() }
  }, [pageNumber, pageCount, pdfRevision])

  async function openPdf(file: File) {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setStatus('Choose a PDF file.'); return }
    if (file.size > MAX_BYTES) { setStatus('Choose a PDF smaller than 80 MB.'); return }
    setBusy(true)
    setStatus('Opening PDF on your device…')
    try {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/' })
      const pdf = await task.promise
      if (pdf.numPages > MAX_PAGES) { await task.destroy(); throw new Error('Use a PDF of 100 pages or fewer.') }
      await loadingTaskRef.current?.destroy()
      loadingTaskRef.current = task
      pdfRef.current = pdf
      setPdfRevision(value => value + 1)
      setFilename(file.name)
      setPageNumber(1)
      setPageCount(pdf.numPages)
      setPosition({ x: 0.1, y: 0.7 })
      setStatus('Draw your signature, then tap the page to place it.')
    } catch (error) {
      setStatus(error instanceof Error && error.name === 'PasswordException' ? 'Password-protected PDFs are not supported. Unlock a copy and try again.' : error instanceof Error ? `Could not open PDF: ${error.message}` : 'Could not open this PDF.')
    } finally { setBusy(false) }
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>, start = false) {
    const canvas = signatureRef.current
    if (!canvas || (!start && !drawingRef.current)) return
    const rect = canvas.getBoundingClientRect()
    const x = (event.clientX - rect.left) * canvas.width / rect.width
    const y = (event.clientY - rect.top) * canvas.height / rect.height
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = '#111827'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    if (start) { drawingRef.current = true; canvas.setPointerCapture(event.pointerId); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y + 0.01) }
    else ctx.lineTo(x, y)
    ctx.stroke()
    setSignature(canvas.toDataURL('image/png'))
  }

  function clearSignature() {
    const canvas = signatureRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    setSignature('')
  }

  function makeTypedSignature() {
    const canvas = signatureRef.current
    if (!canvas || !typedSignature.trim()) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#111827'; ctx.font = 'italic 72px cursive'; ctx.textBaseline = 'middle'
    ctx.fillText(typedSignature.trim(), 15, canvas.height / 2, canvas.width - 30)
    setSignature(canvas.toDataURL('image/png'))
  }

  async function uploadSignature(file: File) {
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setStatus('Choose a PNG or JPG signature image under 5 MB.'); return
    }
    try {
      const bitmap = await createImageBitmap(file)
      const canvas = signatureRef.current
      if (!canvas) { bitmap.close(); return }
      const ctx = canvas.getContext('2d')!
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height)
      const w = bitmap.width * scale, h = bitmap.height * scale
      ctx.drawImage(bitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h)
      bitmap.close()
      setSignature(canvas.toDataURL('image/png'))
      setStatus('Signature added. Tap the page or use the controls to position it.')
    } catch { setStatus('Could not read that signature image. Try a PNG or JPG.') }
  }

  async function exportPdf() {
    const pdf = pdfRef.current
    if (!pdf || !signature) return
    setBusy(true); setStatus('Creating your signed copy…')
    try {
      const { jsPDF } = await import('jspdf')
      let result: InstanceType<typeof jsPDF> | undefined
      for (let i = 1; i <= pdf.numPages; i++) {
        setStatus(`Preparing page ${i} of ${pdf.numPages}…`)
        const page = await pdf.getPage(i)
        const size = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(size.width, size.height)) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
        try {
          await page.render({ canvas, viewport, background: '#ffffff' }).promise
          const orientation = size.width > size.height ? 'landscape' : 'portrait'
          if (!result) result = new jsPDF({ orientation, unit: 'pt', format: [size.width, size.height], compress: true })
          else result.addPage([size.width, size.height], orientation)
          result.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, size.width, size.height, undefined, 'FAST')
          if (i === pageNumber) {
            const sigWidth = size.width * width / 100
            const sigHeight = sigWidth / 3
            result.addImage(signature, 'PNG', Math.max(0, Math.min(position.x * size.width, size.width - sigWidth)), Math.max(0, Math.min(position.y * size.height, size.height - sigHeight)), sigWidth, sigHeight)
          }
        } finally { canvas.width = 1; canvas.height = 1; page.cleanup() }
      }
      if (!result) throw new Error('No PDF pages found.')
      const url = URL.createObjectURL(result.output('blob'))
      const link = document.createElement('a'); link.href = url; link.download = `${filename.replace(/\.pdf$/i, '')}-signed.pdf`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      setStatus('Signed PDF downloaded. Review every page before sharing.')
    } catch (error) { setStatus(error instanceof Error ? `Could not export PDF: ${error.message}` : 'Could not export PDF. Try a smaller file.') }
    finally { setBusy(false) }
  }

  return <section className="sign-tool" aria-label="Sign PDF workspace">
    <p className="sign-warning">Your signature is placed as an image. This is not a certificate-based digital signature. The exported PDF is rebuilt from page images: searchable text, links, forms, annotations and existing digital signatures will not be preserved. Keep your original.</p>
    <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void openPdf(file); event.currentTarget.value = '' }} />
    <button className="btn btn-primary" type="button" onClick={() => inputRef.current?.click()} disabled={busy}><Upload size={18} />{filename ? 'Choose another PDF' : 'Choose a PDF'}</button>
    <p>PDF up to 80 MB and 100 pages · Processed on your device</p>
    {pageCount > 0 && <div className="sign-layout">
      <div>
        <h2>1. Draw your signature</h2>
        <p>Use your finger, mouse or stylus.</p>
        <canvas ref={signatureRef} width={600} height={200} className="signature-pad" aria-label="Signature drawing area" onPointerDown={event => draw(event, true)} onPointerMove={event => draw(event)} onPointerUp={() => { drawingRef.current = false }} onPointerCancel={() => { drawingRef.current = false }} />
        <button className="btn btn-secondary" type="button" onClick={clearSignature} disabled={busy}>Clear signature</button>
        <p>The drawing area requires a pointer or touchscreen. You can also type or upload a signature.</p>
        <label className="sign-control">Type your signature<input type="text" value={typedSignature} maxLength={80} disabled={busy} onChange={event => setTypedSignature(event.target.value)} /></label>
        <button className="btn btn-secondary" type="button" onClick={makeTypedSignature} disabled={busy || !typedSignature.trim()}>Use typed signature</button>
        <input ref={signatureInputRef} type="file" accept="image/png,image/jpeg" hidden onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void uploadSignature(file); event.currentTarget.value = '' }} />
        <button className="btn btn-secondary" type="button" onClick={() => signatureInputRef.current?.click()} disabled={busy}>Upload signature image</button>
        <p>Transparent PNG works best. JPG images may have an opaque background.</p>
        <label className="sign-control">Signature width: {width}%<input type="range" min="10" max="70" value={width} disabled={busy} onChange={event => setWidth(Number(event.target.value))} /></label>
        <label className="sign-control">Horizontal position: {Math.round(position.x * 100)}%<input type="range" min="0" max={100 - width} value={Math.min(position.x * 100, 100 - width)} disabled={busy} onChange={event => setPosition(p => ({ ...p, x: Number(event.target.value) / 100 }))} /></label>
        <label className="sign-control">Vertical position: {Math.round(position.y * 100)}%<input type="range" min="0" max="90" value={Math.min(position.y * 100, 90)} disabled={busy} onChange={event => setPosition(p => ({ ...p, y: Number(event.target.value) / 100 }))} /></label>
        <button type="button" className="btn btn-primary" onClick={() => void exportPdf()} disabled={busy || !signature}><Download size={18} />Download signed PDF</button>
      </div>
      <div><h2>2. Choose a page and place your signature</h2>
        <label className="sign-control">Page <select value={pageNumber} disabled={busy} onChange={event => setPageNumber(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1} of {pageCount}</option>)}</select></label>
        <p>Tap the page to position the signature, or use the position controls.</p>
        <div className="sign-preview" onClick={event => { if (busy) return; const rect = event.currentTarget.getBoundingClientRect(); setPosition({ x: Math.max(0, Math.min(1 - width / 100, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(0.9, (event.clientY - rect.top) / rect.height)) }) }}>
          <canvas ref={previewRef} aria-label={`Preview of page ${pageNumber}`} />
          {signature && <img className="sign-overlay" alt="Signature placement preview" src={signature} style={{ left: `${Math.min(position.x * 100, 100 - width)}%`, top: `${Math.max(0, Math.min(position.y * 100, 100 - width * pageAspect / 3))}%`, width: `${width}%` }} />}
        </div>
      </div>
    </div>}
    <p role="status" aria-live="polite">{status}</p>
  </section>
}
