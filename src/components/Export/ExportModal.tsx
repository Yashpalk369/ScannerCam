import React, { useEffect, useMemo, useRef, useState } from 'react'
import { X, FileText, Image as ImageIcon, Download, CheckCircle2, Search, Loader2 } from 'lucide-react'
import type { ScanPage } from '../../core/cv/types'
import { createPdfBlob, downloadBlob } from '../../core/pdf/pdfBuilder'
import { formatFileSize, PDF_QUALITY_PRESETS } from '../../core/pdf/pdfLayout'
import type { PdfLayout, PdfQuality } from '../../core/pdf/pdfLayout'
import { ocrWorker } from '../../core/workers/ocrClient'

interface ExportModalProps {
  isOpen: boolean
  onClose: () => void
  pages: ScanPage[]
  activePage: ScanPage | null
  setStatus: (msg: string, error?: boolean) => void
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, pages, activePage, setStatus }) => {
  const [filename, setFilename] = useState(`ScannerCam-${new Date().toISOString().slice(0, 10)}`)
  const [paperFormat, setPaperFormat] = useState<'a4' | 'letter'>('a4')
  const [margin, setMargin] = useState(20)
  const [quality, setQuality] = useState<PdfQuality>('balanced')
  const [layout, setLayout] = useState<PdfLayout>('document')
  const [frontId, setFrontId] = useState(pages[0]?.id ?? '')
  const [backId, setBackId] = useState(pages[1]?.id ?? '')
  const [searchablePdf, setSearchablePdf] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isPreparing, setIsPreparing] = useState(true)
  const [exportProgress, setExportProgress] = useState('')
  const [exportError, setExportError] = useState<string | null>(null)
  const [sizeError, setSizeError] = useState<string | null>(null)
  const [preparedPdf, setPreparedPdf] = useState<{ blob: Blob; selection: ScanPage[]; key: string } | null>(null)
  const exportLock = useRef(false)
  const filenameRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(false)

  const front = pages.find(page => page.id === frontId)
  const back = pages.find(page => page.id === backId)
  const selectionError = layout === 'id-card'
    ? !front ? 'Choose a front side.' : backId === frontId ? 'Choose different scans for the front and back.' : backId && !back ? 'Choose a back side or select Front only.' : null
    : null
  const selectedPages = useMemo(() => layout === 'document' ? pages : pages.filter(page => page.id === frontId || page.id === backId).sort((a, b) => Number(b.id === frontId) - Number(a.id === frontId)), [pages, layout, frontId, backId])
  const settingsKey = `${paperFormat}:${margin}:${quality}:${layout}`
  const options = { format: paperFormat, margin, qualityPreset: quality, layout, orientation: 'auto' as const }
  const readyPdf = preparedPdf?.selection === selectedPages && preparedPdf.key === settingsKey ? preparedPdf.blob : null

  useEffect(() => {
    mountedRef.current = true
    const previousFocus = document.activeElement as HTMLElement | null
    filenameRef.current?.focus()
    return () => { mountedRef.current = false; previousFocus?.focus() }
  }, [])

  // Prepare and retain the actual image-only PDF, rather than guessing its size.
  // Cancellation prevents old options from replacing a newer size preview.
  useEffect(() => {
    const controller = new AbortController()
    setPreparedPdf(null)
    setSizeError(null)
    setExportError(null)
    if (!isOpen || !selectedPages.length || selectionError) { setIsPreparing(false); return () => controller.abort() }
    setIsPreparing(true)
    const timer = setTimeout(async () => {
      try {
        const blob = await createPdfBlob(selectedPages, { format: paperFormat, margin, qualityPreset: quality, layout, orientation: 'auto', signal: controller.signal })
        if (!controller.signal.aborted) setPreparedPdf({ blob, selection: selectedPages, key: settingsKey })
      } catch {
        if (!controller.signal.aborted) setSizeError('Could not calculate the PDF size. Try downloading again.')
      } finally {
        if (!controller.signal.aborted) setIsPreparing(false)
      }
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [isOpen, selectedPages, selectionError, paperFormat, margin, quality, layout, settingsKey])

  const handleExportPdf = async () => {
    if (!selectedPages.length || selectionError || exportLock.current) return
    exportLock.current = true
    setIsExporting(true)
    setExportError(null)
    setExportProgress('Preparing…')
    const updateProgress = (message: string) => { if (mountedRef.current) setExportProgress(message) }
    try {
      const ocrTexts: string[] = []
      let recognizedPages = 0
      if (searchablePdf) {
        for (let i = 0; i < selectedPages.length; i += 1) {
          updateProgress(`OCR: ${layout === 'id-card' ? 'side' : 'page'} ${i + 1} of ${selectedPages.length}…`)
          try {
            const result = await ocrWorker.recognizePage(await blobToDataUrl(selectedPages[i].blob))
            ocrTexts[i] = result.text
            if (result.text.trim()) recognizedPages += 1
          } catch { ocrTexts[i] = '' }
        }
      }
      updateProgress('Building PDF…')
      const blob = !searchablePdf && readyPdf ? readyPdf : await createPdfBlob(selectedPages, { ...options, searchable: searchablePdf, ocrTexts, onProgress: (_current, _total, message) => updateProgress(message) })
      const name = filename.trim() || 'ScannerCam-Doc'
      downloadBlob(blob, name.endsWith('.pdf') ? name : `${name}.pdf`)
      const textStatus = searchablePdf ? ` Text recognized on ${recognizedPages} of ${selectedPages.length} scans.` : ''
      setStatus(`PDF exported successfully.${textStatus}`)
      onClose()
    } catch {
      if (mountedRef.current) setExportError('Could not export the PDF. Your scans are unchanged; please try again.')
      setStatus('Failed to export PDF.', true)
    } finally {
      exportLock.current = false
      if (mountedRef.current) { setIsExporting(false); setExportProgress('') }
      if (searchablePdf) ocrWorker.terminate()
    }
  }

  const handleExportSingleJpg = () => {
    if (!activePage) return
    downloadBlob(activePage.blob, `${filename.trim() || 'Scan'}-${activePage.name.replaceAll(' ', '-')}.jpg`)
    setStatus('Current page exported as JPG.')
    onClose()
  }

  const handleExportAllJpgs = () => {
    pages.forEach((page, index) => setTimeout(() => downloadBlob(page.blob, `${filename.trim() || 'Scan'}-Page-${index + 1}.jpg`), index * 250))
    setStatus(`Exported ${pages.length} JPG images.`)
    onClose()
  }

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')).filter(control => control.getClientRects().length > 0)
    if (!controls.length) { event.preventDefault(); return }
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  if (!isOpen) return null
  return (
    <div className="modal-overlay" onClick={() => { if (!isExporting) onClose() }}>
      <div className="modal-dialog scanner-export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title" onClick={event => event.stopPropagation()} onKeyDown={trapFocus}>
        <div className="modal-header">
          <div className="modal-title"><Download size={20} /><h3 id="export-title">Export Documents</h3></div>
          <button type="button" className="btn-circle-subtle" onClick={onClose} disabled={isExporting} aria-label="Close export"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="exportFilename" className="input-label">File Name</label>
            <input ref={filenameRef} id="exportFilename" type="text" className="text-input" value={filename} onChange={event => setFilename(event.target.value)} disabled={isExporting} placeholder="e.g. Contract-Signed" />
          </div>
          <div className="export-options-grid">
            <div className="form-group">
              <label htmlFor="pdfLayout" className="input-label">PDF Layout</label>
              <select id="pdfLayout" className="select-input" value={layout} disabled={isExporting} onChange={event => setLayout(event.target.value as PdfLayout)}>
                <option value="document">Documents</option><option value="id-card">ID card</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pdfQuality" className="input-label">PDF Quality</label>
              <select id="pdfQuality" className="select-input" value={quality} disabled={isExporting} onChange={event => setQuality(event.target.value as PdfQuality)}>
                {Object.entries(PDF_QUALITY_PRESETS).map(([value, preset]) => <option key={value} value={value}>{preset.label}</option>)}
              </select>
            </div>
          </div>
          <p className="pdf-quality-description">{PDF_QUALITY_PRESETS[quality].description}. This changes the PDF only; your scans and JPG exports keep their detail.</p>
          <div className="pdf-size-preview" role="status" data-testid="pdf-size" data-bytes={readyPdf?.size ?? ''}>
            <span>{searchablePdf ? 'Estimated size before OCR' : 'PDF size'}</span>
            <strong>{isPreparing ? 'Calculating…' : readyPdf ? formatFileSize(readyPdf.size) : 'Unavailable'}</strong>
            {searchablePdf && <small>The text layer adds extra bytes.</small>}
          </div>
          {layout === 'id-card' && <div className="id-card-options">
            <div className="export-options-grid">
              <div className="form-group"><label htmlFor="idFront" className="input-label">Front side</label><select id="idFront" className="select-input" value={frontId} disabled={isExporting} onChange={event => setFrontId(event.target.value)}>{pages.map((page, index) => <option key={page.id} value={page.id}>{index + 1}. {page.name}</option>)}</select></div>
              <div className="form-group"><label htmlFor="idBack" className="input-label">Back side</label><select id="idBack" className="select-input" value={backId} disabled={isExporting} onChange={event => setBackId(event.target.value)}><option value="">Front only</option>{pages.map((page, index) => <option key={page.id} value={page.id}>{index + 1}. {page.name}</option>)}</select></div>
            </div>
            {!selectionError && <div className="id-card-sheet-preview" aria-label="Selected ID card sides">
              {[front, back].filter((page): page is ScanPage => Boolean(page)).map((page, index) => <figure key={page.id}><figcaption>{index === 0 ? 'Front' : 'Back'}</figcaption><img src={page.previewUrl} alt={`${index === 0 ? 'Front' : 'Back'} side preview`} /></figure>)}
            </div>}
            <p className="pdf-quality-description">Selected sides are stacked on one portrait sheet. Cards fit an 85.6 × 54 mm area. Print at 100% scale.</p>
          </div>}
          <button type="button" className="export-advanced-toggle" aria-expanded={advancedOpen} aria-controls="export-advanced-options" disabled={isExporting} onClick={() => setAdvancedOpen(value => !value)}>
            <span>Advanced options</span><span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
          </button>
          <div id="export-advanced-options" className="export-advanced-options" hidden={!advancedOpen}>
          <div className="export-options-grid">
            <div className="form-group"><label htmlFor="paperSize" className="input-label">Paper Size</label><select id="paperSize" className="select-input" value={paperFormat} disabled={isExporting} onChange={event => setPaperFormat(event.target.value as 'a4' | 'letter')}><option value="a4">A4 (Standard ISO)</option><option value="letter">US Letter</option></select></div>
            <div className="form-group"><label htmlFor="pageMargins" className="input-label">Margins</label><select id="pageMargins" className="select-input" value={margin} disabled={isExporting} onChange={event => setMargin(Number(event.target.value))}><option value={20}>Standard (20 pt)</option><option value={0}>Borderless (0 pt)</option><option value={40}>Wide (40 pt)</option></select></div>
          </div>
          <button type="button" className={`searchable-toggle-card ${searchablePdf ? 'enabled' : ''}`} role="checkbox" aria-checked={searchablePdf} disabled={isExporting} onClick={() => setSearchablePdf(value => !value)}>
            <span className="searchable-toggle-icon"><Search size={18} /></span>
            <span className="searchable-toggle-text"><strong>Searchable PDF (OCR)</strong><span className="pdf-quality-description">Add searchable text using local OCR. No document uploads.</span></span>
            <span className={`toggle-pill ${searchablePdf ? 'on' : 'off'}`}>{searchablePdf ? 'ON' : 'OFF'}</span>
          </button>
            {layout === 'document' && <div className="export-image-options">
              <p className="input-label">Image downloads</p>
              <button type="button" className="btn btn-secondary" disabled={!activePage || isExporting} onClick={handleExportSingleJpg}><ImageIcon size={16} /><span>Download Current JPG</span></button>
              {pages.length > 1 && <button type="button" className="btn btn-secondary" disabled={isExporting} onClick={handleExportAllJpgs}><ImageIcon size={16} /><span>Download All JPGs</span></button>}
            </div>}
          </div>
          <div className="export-summary-box">
            <CheckCircle2 size={18} className="summary-icon" />
            <div><strong>{layout === 'id-card' ? '1 sheet' : `${selectedPages.length} ${selectedPages.length === 1 ? 'page' : 'pages'}`} ready</strong><p>{layout === 'id-card' ? `${selectedPages.length} selected ${selectedPages.length === 1 ? 'side' : 'sides'}` : 'Auto-orientation matches each page.'}</p></div>
          </div>

          {(selectionError || exportError || sizeError) && <p className="pdf-export-error" role="alert">{selectionError || exportError || sizeError}</p>}
          {isExporting && <div className="export-progress-row" role="status"><Loader2 size={15} className="spin-icon text-brand" /><span>{exportProgress}</span></div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" disabled={!selectedPages.length || isExporting || isPreparing || Boolean(selectionError)} onClick={() => void handleExportPdf()}>
            {isExporting ? <Loader2 size={16} className="spin-icon" /> : <FileText size={16} />}<span>{isExporting ? exportProgress || 'Exporting…' : layout === 'id-card' ? 'Download ID Card PDF' : searchablePdf ? 'Download Searchable PDF' : 'Download Multi-Page PDF'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
