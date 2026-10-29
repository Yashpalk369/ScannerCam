import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask } from 'pdfjs-dist'
import { downloadBlob } from '../../core/pdf/pdfBuilder'
import { parsePageRange } from '../../core/pdf/pageRange'
import './pdf-to-image.css'

/** Render PDF pages locally for single-page or ZIP downloads. */
export function PdfToImage() {
  const [fileName, setFileName] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageRange, setPageRange] = useState('')
  const [format, setFormat] = useState<'jpeg' | 'png'>('jpeg')
  const [busy, setBusy] = useState(false)
  const [rendered, setRendered] = useState(false)
  const [message, setMessage] = useState('Choose a PDF to get started.')
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const generationRef = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => { generationRef.current++; void taskRef.current?.destroy() }, [])

  async function openFile(file: File) {
    if (busy) return
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
      setMessage('Choose a PDF file.'); return
    }
    if (file.size > 80 * 1024 * 1024) {
      setMessage('Choose a PDF smaller than 80 MB.'); return
    }
    const generation = ++generationRef.current
    setBusy(true)
    setRendered(false)
    setMessage('Opening PDF…')
    setPageCount(0)
    docRef.current = null
    await taskRef.current?.destroy()
    taskRef.current = null
    try {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      const task = pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true,
        standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/',
      })
      taskRef.current = task
      const pdf = await task.promise
      if (generation !== generationRef.current) { await task.destroy(); return }
      if (pdf.numPages > 100) { await task.destroy(); taskRef.current = null; throw new Error('Choose a PDF with 100 pages or fewer.') }
      docRef.current = pdf
      setFileName(file.name.replace(/\.pdf$/i, '') || 'document')
      setPageNumber(1)
      setPageCount(pdf.numPages)
      setPageRange(`1-${Math.min(pdf.numPages, 25)}`)
      setMessage(`Loaded ${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}. Choose a page to download.`)
    } catch (error) {
      if (generation === generationRef.current) {
        setMessage(error instanceof Error && error.name === 'PasswordException'
          ? 'Password-protected PDFs are not supported. Unlock a copy and try again.'
          : error instanceof Error ? error.message : 'Could not open this PDF.')
      }
    } finally { if (generation === generationRef.current) setBusy(false) }
  }

  useEffect(() => {
    const doc = docRef.current
    const canvas = canvasRef.current
    if (!doc || !canvas || !pageCount) return
    setRendered(false)
    let cancelled = false
    let renderTask: { cancel: () => void } | undefined
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const initial = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(initial.width, initial.height)) })
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const task = page.render({ canvas, viewport, background: '#ffffff' })
        renderTask = task
        await task.promise
        if (!cancelled) { setRendered(true); setMessage(`Page ${pageNumber} of ${pageCount} is ready to download.`) }
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Could not render this page.')
      }
    })()
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pageCount, pageNumber])

  function download() {
    const canvas = canvasRef.current
    if (!canvas || !docRef.current) return
    setBusy(true)
    canvas.toBlob((blob) => {
      if (!blob) setMessage('Could not create the image. Please try again.')
      else { downloadBlob(blob, `${fileName}-page-${pageNumber}.${format === 'jpeg' ? 'jpg' : 'png'}`); setMessage(`Downloaded page ${pageNumber}.`) }
      setBusy(false)
    }, `image/${format}`, 0.95)
  }

  async function downloadBatch() {
    const doc = docRef.current
    if (!doc || busy) return
    let selected: number[]
    try {
      selected = parsePageRange(pageRange, pageCount)
      if (selected.length > 25) throw new Error('Choose at most 25 pages per ZIP to limit memory use.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Check the page numbers.'); return }
    setBusy(true)
    setMessage('Preparing images…')
    try {
      const { zipSync } = await import('fflate')
      const entries: Record<string, Uint8Array> = {}
      let totalBytes = 0
      for (const [index, pageNo] of selected.entries()) {
        setMessage(`Preparing page ${index + 1} of ${selected.length}…`)
        const page = await doc.getPage(pageNo)
        const initial = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(initial.width, initial.height)) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        try {
          await page.render({ canvas, viewport, background: '#ffffff' }).promise
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not create an image.')), `image/${format}`, 0.95))
          totalBytes += blob.size
          if (totalBytes > 50 * 1024 * 1024) throw new Error('Images exceed the 50 MB ZIP limit. Select fewer pages.')
          entries[`page-${String(pageNo).padStart(3, '0')}.${format === 'jpeg' ? 'jpg' : 'png'}`] = new Uint8Array(await blob.arrayBuffer())
        } finally { canvas.width = canvas.height = 1; page.cleanup() }
      }
      const bytes = zipSync(entries, { level: 0 })
      downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' }), `${fileName}-images.zip`)
      setMessage(`Downloaded ${selected.length} ${selected.length === 1 ? 'page' : 'pages'} as a ZIP.`)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create the ZIP. Try fewer pages.') }
    finally { setBusy(false) }
  }

  return <section className="pdf-image-workspace" aria-label="PDF to image converter">
    <p>Choose a PDF, preview a page and download it as a JPG or PNG. Pages are processed on your device.</p>
    <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => { const file = e.currentTarget.files?.[0]; if (file) void openFile(file); e.currentTarget.value = '' }} />
    <button className="btn btn-primary" type="button" disabled={busy} onClick={() => fileRef.current?.click()}>{pageCount ? 'Choose another PDF' : 'Choose PDF'}</button>
    <p className="pdf-image-status" role="status" aria-live="polite">{message}</p>
    {pageCount > 0 && <>
      <div className="pdf-image-controls">
        <label>Page <input type="number" min={1} max={pageCount} value={pageNumber} disabled={busy} onChange={e => setPageNumber(Math.min(pageCount, Math.max(1, Number(e.currentTarget.value) || 1)))} /> of {pageCount}</label>
        <label>Format <select value={format} disabled={busy} onChange={e => setFormat(e.currentTarget.value as 'jpeg' | 'png')}><option value="jpeg">JPG</option><option value="png">PNG</option></select></label>
        <button className="btn btn-primary" type="button" disabled={busy || !rendered} onClick={download}>Download page</button>
      </div>
      <p>Pages are rendered at up to 2× scale and 2400 pixels on the longest side.</p>
      <div className="pdf-image-controls">
        <label>Pages for ZIP <input type="text" value={pageRange} disabled={busy} onChange={e => setPageRange(e.currentTarget.value)} placeholder="e.g. 1-3, 5" /></label>
        <button className="btn btn-secondary" type="button" disabled={busy || !rendered} onClick={() => void downloadBatch()}>Download pages as ZIP</button>
      </div>
      <p>Choose up to 25 pages per ZIP (maximum 50 MB of images). For longer PDFs, download several batches. ZIP pages use the selected image format.</p>
      <canvas ref={canvasRef} className="pdf-image-preview" aria-label={`Preview of page ${pageNumber}`} />
    </>}
  </section>
}
