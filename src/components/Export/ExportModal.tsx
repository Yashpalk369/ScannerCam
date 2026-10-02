import React, { useState } from 'react'
import { X, FileText, Image as ImageIcon, Download, CheckCircle2, Search, Loader2 } from 'lucide-react'
import type { ScanPage } from '../../core/cv/types'
import { exportPagesToPdf, downloadBlob } from '../../core/pdf/pdfBuilder'
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

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  pages,
  activePage,
  setStatus,
}) => {
  const [filename, setFilename] = useState(
    `ScannerCam-${new Date().toISOString().slice(0, 10)}`,
  )
  const [paperFormat, setPaperFormat] = useState<'a4' | 'letter'>('a4')
  const [margin, setMargin] = useState<number>(20)
  const [searchablePdf, setSearchablePdf] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')

  if (!isOpen) return null

  const handleExportPdf = async () => {
    if (pages.length === 0) return
    setIsExporting(true)
    setExportProgress('Preparing…')

    try {
      let ocrTexts: string[] = []

      if (searchablePdf) {
        // Run OCR on each page before building PDF
        ocrTexts = new Array(pages.length).fill('')
        for (let i = 0; i < pages.length; i += 1) {
          setExportProgress(`OCR: page ${i + 1} of ${pages.length}…`)
          setStatus(`Recognizing text on page ${i + 1}…`)
          try {
            const dataUrl = await blobToDataUrl(pages[i].blob)
            const result = await ocrWorker.recognizePage(dataUrl)
            ocrTexts[i] = result.text
          } catch (ocrErr) {
            console.warn(`OCR failed for page ${i + 1}:`, ocrErr)
            // Non-fatal: continue without text for this page
          }
        }
      }

      setExportProgress('Building PDF…')
      setStatus('Compiling PDF…')

      await exportPagesToPdf(pages, {
        filename: filename.trim() || 'ScannerCam-Doc',
        format: paperFormat,
        margin,
        orientation: 'auto',
        searchable: searchablePdf,
        ocrTexts,
        onProgress: (_cur, _total, msg) => setExportProgress(msg),
      })

      setStatus(`PDF exported successfully${searchablePdf ? ' (searchable text layer included)' : ''}.`)
      onClose()
    } catch (err) {
      console.error('PDF export error:', err)
      setStatus('Failed to export PDF.', true)
    } finally {
      setIsExporting(false)
      setExportProgress('')
      // Free OCR worker memory after export
      if (searchablePdf) {
        ocrWorker.terminate()
      }
    }
  }

  const handleExportSingleJpg = () => {
    if (!activePage) return
    const name = `${(filename.trim() || 'Scan')}-${activePage.name.replaceAll(' ', '-')}.jpg`
    downloadBlob(activePage.blob, name)
    setStatus('Current page exported as JPG.')
    onClose()
  }

  const handleExportAllJpgs = () => {
    if (pages.length === 0) return
    pages.forEach((page, idx) => {
      setTimeout(() => {
        const name = `${filename.trim() || 'Scan'}-Page-${idx + 1}.jpg`
        downloadBlob(page.blob, name)
      }, idx * 250)
    })
    setStatus(`Exported ${pages.length} JPG images.`)
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Download size={20} />
            <h3>Export Documents</h3>
          </div>
          <button type="button" className="btn-circle-subtle" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="exportFilename" className="input-label">File Name</label>
            <input
              id="exportFilename"
              type="text"
              className="text-input"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="e.g. Contract-Signed"
            />
          </div>

          <div className="export-options-grid">
            <div className="form-group">
              <label htmlFor="paperSize" className="input-label">Paper Size</label>
              <select
                id="paperSize"
                className="select-input"
                value={paperFormat}
                onChange={(e) => setPaperFormat(e.target.value as 'a4' | 'letter')}
              >
                <option value="a4">A4 (Standard ISO)</option>
                <option value="letter">US Letter</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="pageMargins" className="input-label">Margins</label>
              <select
                id="pageMargins"
                className="select-input"
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
              >
                <option value={20}>Standard (20 pt)</option>
                <option value={0}>Borderless (0 pt)</option>
                <option value={40}>Wide (40 pt)</option>
              </select>
            </div>
          </div>

          {/* Searchable PDF toggle */}
          <div
            className={`searchable-toggle-card ${searchablePdf ? 'enabled' : ''}`}
            onClick={() => setSearchablePdf((v) => !v)}
            role="checkbox"
            aria-checked={searchablePdf}
            tabIndex={0}
            onKeyDown={(e) => e.key === ' ' && setSearchablePdf((v) => !v)}
          >
            <div className="searchable-toggle-icon">
              <Search size={18} />
            </div>
            <div className="searchable-toggle-text">
              <strong>Searchable PDF (OCR)</strong>
              <p>Adds an invisible text layer so the PDF is searchable and copyable. Tesseract.js runs locally — no data is uploaded.</p>
            </div>
            <div className={`toggle-pill ${searchablePdf ? 'on' : 'off'}`}>
              {searchablePdf ? 'ON' : 'OFF'}
            </div>
          </div>

          <div className="export-summary-box">
            <CheckCircle2 size={18} className="summary-icon" />
            <div>
              <strong>{pages.length} {pages.length === 1 ? 'page' : 'pages'} ready</strong>
              <p>Auto-orientation matches each page to portrait or landscape.</p>
            </div>
          </div>

          {isExporting && exportProgress && (
            <div className="export-progress-row">
              <Loader2 size={15} className="spin-icon text-brand" />
              <span>{exportProgress}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!activePage || isExporting}
            onClick={handleExportSingleJpg}
          >
            <ImageIcon size={16} />
            <span>Download Current JPG</span>
          </button>

          {pages.length > 1 && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isExporting}
              onClick={handleExportAllJpgs}
            >
              <ImageIcon size={16} />
              <span>Download All JPGs</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={pages.length === 0 || isExporting}
            onClick={handleExportPdf}
          >
            {isExporting ? <Loader2 size={16} className="spin-icon" /> : <FileText size={16} />}
            <span>{isExporting ? exportProgress || 'Exporting…' : searchablePdf ? 'Download Searchable PDF' : 'Download Multi-Page PDF'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
