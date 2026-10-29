import { useRef, useState } from 'react'
import { FileText, Upload } from 'lucide-react'
import { parsePageRange } from '../../core/pdf/pageRange'

/** Extract selected pages locally, rendering them as images in a new PDF. */
export function SplitPdf() {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [count, setCount] = useState(0)
  const [range, setRange] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const openPdf = async (pdfFile: File) => {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    return pdfjs.getDocument({ data: new Uint8Array(await pdfFile.arrayBuffer()), cMapUrl: '/pdf-assets/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdf-assets/standard_fonts/', wasmUrl: '/pdf-assets/wasm/' })
  }

  const choose = async (selected?: File) => {
    if (!selected || busy) return
    setFile(null); setCount(0); setRange(''); setMessage('')
    if (!/\.pdf$/i.test(selected.name) && selected.type !== 'application/pdf') { setMessage('Choose a PDF file.'); return }
    if (selected.size > 80 * 1024 * 1024) { setMessage('Choose a PDF smaller than 80 MB.'); return }
    setBusy(true)
    try {
      const task = await openPdf(selected)
      try {
        const pdf = await task.promise
        if (pdf.numPages > 100) throw new Error('This tool supports PDFs of up to 100 pages.')
        setFile(selected); setCount(pdf.numPages); setRange(`1-${pdf.numPages}`)
      } finally { await task.destroy() }
    } catch (error) {
      setMessage(error instanceof Error && error.name === 'PasswordException' ? 'Password-protected PDFs are not supported. Unlock a copy first.' : error instanceof Error ? error.message : 'Could not open this PDF.')
    } finally { setBusy(false) }
  }

  const extract = async () => {
    if (!file || busy) return
    let selected: number[]
    try { selected = parsePageRange(range, count) } catch (error) { setMessage(error instanceof Error ? error.message : 'Check the page numbers.'); return }
    setBusy(true); setMessage('Preparing PDF…')
    try {
      const [task, { jsPDF }] = await Promise.all([openPdf(file), import('jspdf')])
      try {
        const pdf = await task.promise
        let output: InstanceType<typeof jsPDF> | null = null
        for (const [index, number] of selected.entries()) {
          setMessage(`Preparing page ${index + 1} of ${selected.length}…`)
          const page = await pdf.getPage(number)
          const base = page.getViewport({ scale: 1 })
          const view = page.getViewport({ scale: Math.min(2, 2400 / Math.max(base.width, base.height)) })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height)
          try {
            await page.render({ canvas, viewport: view, background: '#ffffff' }).promise
            const orientation = base.width > base.height ? 'landscape' : 'portrait'
            if (!output) output = new jsPDF({ unit: 'pt', format: [base.width, base.height], orientation, compress: true })
            else output.addPage([base.width, base.height], orientation)
            output.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, base.width, base.height, undefined, 'FAST')
          } finally { canvas.width = canvas.height = 1; page.cleanup() }
        }
        if (!output) throw new Error('No pages selected.')
        const url = URL.createObjectURL(output.output('blob'))
        const link = document.createElement('a'); link.href = url; link.download = `${file.name.replace(/\.pdf$/i, '')}-extracted.pdf`; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        setMessage(`Downloaded ${selected.length} ${selected.length === 1 ? 'page' : 'pages'}.`)
      } finally { await task.destroy() }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not extract pages. Try a smaller PDF.') }
    finally { setBusy(false) }
  }

  return <section className="remover-workbench" aria-label="Extract PDF pages workspace">
    <div className="tool-upload">
      <FileText size={32} aria-hidden="true" />
      <h2>Extract PDF pages</h2>
      <p>Choose a PDF up to 80 MB and 100 pages. Processing happens on your device.</p>
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => input.current?.click()}><Upload size={18} /> Choose PDF</button>
      <input ref={input} hidden type="file" accept="application/pdf,.pdf" onChange={event => { void choose(event.target.files?.[0]); event.target.value = '' }} />
      <p className="tool-note">Pages are converted to images. Selectable text, links, forms and digital signatures are not preserved. Keep the original file.</p>
    </div>
    {file && <div className="tool-actions" style={{ alignItems: 'stretch', flexDirection: 'column' }}>
      <p><strong>{file.name}</strong> · {count} {count === 1 ? 'page' : 'pages'}</p>
      <label htmlFor="extract-pages">Pages to keep</label>
      <input id="extract-pages" type="text" value={range} onChange={e => setRange(e.target.value)} disabled={busy} placeholder="e.g. 1-3, 5" />
      <p className="tool-note">Use commas and ranges, for example 1-3, 5. Pages appear in the order entered; duplicates are ignored.</p>
      <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void extract()}>Extract and download PDF</button>
    </div>}
    {message && <p className="tool-message" role="status" aria-live="polite">{message}</p>}
  </section>
}
