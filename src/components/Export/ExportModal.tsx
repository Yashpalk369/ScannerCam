import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  FileText,
  Image as ImageIcon,
  Download,
  CheckCircle2,
  Search,
  Loader2,
} from 'lucide-react'
import type { ScanPage } from '../../core/cv/types'
import { parseHocrWords } from '../../core/pdf/ocrWords'
import type { OcrWord } from '../../core/pdf/ocrWords'
import { createPdfForTarget, downloadBlob } from '../../core/pdf/pdfBuilder'
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
  const [margin, setMargin] = useState(20)
  const [target, setTarget] = useState(
    window.location.pathname.startsWith('/compress-pdf') ? '1000' : '',
  )
  const [customKB, setCustomKB] = useState('500')
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const [language, setLanguage] = useState('eng')
  const previewGeneration = useRef(0)
  const [quality, setQuality] = useState<PdfQuality>('balanced')
  const [layout, setLayout] = useState<PdfLayout>('document')
  const [frontId, setFrontId] = useState(pages[0]?.id ?? '')
  const [backId, setBackId] = useState(pages[1]?.id ?? '')
  const [searchablePdf, setSearchablePdf] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(
    window.location.pathname.startsWith('/image-to-text'),
  )
  const [isExporting, setIsExporting] = useState(false)
  const [isPreparing, setIsPreparing] = useState(true)
  const [exportProgress, setExportProgress] = useState('')
  const [exportError, setExportError] = useState<string | null>(null)
  const [sizeError, setSizeError] = useState<string | null>(null)
  const [preparedPdf, setPreparedPdf] = useState<{
    blob: Blob
    selection: ScanPage[]
    key: string
  } | null>(null)
  const exportLock = useRef(false)
  const filenameRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(false)
  const exportController = useRef<AbortController | null>(null)

  const front = pages.find((page) => page.id === frontId)
  const back = pages.find((page) => page.id === backId)
  const selectionError =
    layout === 'id-card'
      ? !front
        ? 'Choose a front side.'
        : backId === frontId
          ? 'Choose different scans for the front and back.'
          : backId && !back
            ? 'Choose a back side or select Front only.'
            : null
      : null
  const selectedPages = useMemo(
    () =>
      layout === 'document'
        ? pages
        : pages
            .filter((page) => page.id === frontId || page.id === backId)
            .sort(
              (a, b) => Number(b.id === frontId) - Number(a.id === frontId),
            ),
    [pages, layout, frontId, backId],
  )
  const targetKB = target === 'custom' ? Number(customKB) : Number(target)
  const targetError =
    target && (!Number.isFinite(targetKB) || targetKB < 1 || targetKB > 100000)
      ? 'Enter a target from 1 to 100,000 KB.'
      : null
  const targetBytes = target ? Math.floor(targetKB * 1000) : undefined
  const textOnlyLanguage = ['hin', 'ara'].includes(language)
  const settingsKey = `${paperFormat}:${margin}:${quality}:${layout}:${targetBytes}`
  const options = {
    targetBytes,
    format: paperFormat,
    margin,
    qualityPreset: quality,
    layout,
    orientation: 'auto' as const,
  }
  const readyPdf =
    preparedPdf?.selection === selectedPages && preparedPdf.key === settingsKey
      ? preparedPdf.blob
      : null

  useEffect(() => {
    mountedRef.current = true
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    filenameRef.current?.focus()
    return () => {
      mountedRef.current = false
      exportController.current?.abort()
      if (exportController.current) ocrWorker.terminate()
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [])

  // Prepare and retain the actual image-only PDF, rather than guessing its size.
  // Cancellation prevents old options from replacing a newer size preview.
  useEffect(() => {
    const controller = new AbortController()
    setPreparedPdf(null)
    setSizeError(null)
    setExportError(null)
    if (!isOpen || !selectedPages.length || selectionError || targetError) {
      setIsPreparing(false)
      return () => controller.abort()
    }
    setIsPreparing(true)
    const timer = setTimeout(async () => {
      try {
        const blob = await createPdfForTarget(selectedPages, {
          targetBytes,
          format: paperFormat,
          margin,
          qualityPreset: quality,
          layout,
          orientation: 'auto',
          signal: controller.signal,
        })
        if (!controller.signal.aborted)
          setPreparedPdf({ blob, selection: selectedPages, key: settingsKey })
      } catch (error) {
        if (!controller.signal.aborted)
          setSizeError(
            error instanceof Error
              ? error.message
              : 'Could not calculate PDF size. Retry.',
          )
      } finally {
        if (!controller.signal.aborted) setIsPreparing(false)
      }
    }, 150)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [
    isOpen,
    selectedPages,
    selectionError,
    paperFormat,
    margin,
    quality,
    layout,
    settingsKey,
    targetBytes,
    targetError,
  ])

  const handleExportPdf = async () => {
    if (
      !selectedPages.length ||
      selectionError ||
      targetError ||
      sizeError ||
      (searchablePdf && textOnlyLanguage) ||
      exportLock.current
    )
      return
    exportLock.current = true
    const controller = new AbortController()
    exportController.current = controller
    setIsExporting(true)
    setExportError(null)
    setExportProgress('Preparing…')
    const updateProgress = (message: string) => {
      if (mountedRef.current) setExportProgress(message)
    }
    try {
      const ocrTexts: string[] = []
      const ocrWords: OcrWord[][] = []
      let recognizedPages = 0
      if (searchablePdf) {
        for (let i = 0; i < selectedPages.length; i += 1) {
          updateProgress(
            `OCR: ${layout === 'id-card' ? 'side' : 'page'} ${i + 1} of ${selectedPages.length}…`,
          )
          try {
            const result = await ocrWorker.recognizePage(
              await blobToDataUrl(selectedPages[i].blob),
              language,
            )
            controller.signal.throwIfAborted()
            ocrTexts[i] = result.text
            ocrWords[i] = parseHocrWords(result.hocr, selectedPages[i].width, selectedPages[i].height)
            if (result.text.trim() && !ocrWords[i].length) throw new Error('OCR did not return word positions.')
            if (result.text.trim()) recognizedPages += 1
          } catch (error) {
            controller.signal.throwIfAborted()
            throw new Error(
              `OCR failed on ${layout === 'id-card' ? 'side' : 'page'} ${i + 1}. Retry or turn OCR off to download an image-only PDF.`,
              { cause: error },
            )
          }
        }
      }
      updateProgress('Building PDF…')
      const blob =
        !searchablePdf && readyPdf
          ? readyPdf
          : await createPdfForTarget(selectedPages, {
              ...options,
              signal: controller.signal,
              searchable: searchablePdf,
              ocrTexts,
              ocrWords,
              onProgress: (_current, _total, message) =>
                updateProgress(message),
            })
      controller.signal.throwIfAborted()
      const name = filename.trim() || 'ScannerCam-Doc'
      downloadBlob(blob, name.endsWith('.pdf') ? name : `${name}.pdf`)
      const textStatus = searchablePdf
        ? ` Text recognized on ${recognizedPages} of ${selectedPages.length} scans.`
        : ''
      setStatus(`PDF exported successfully.${textStatus}`)
      onClose()
    } catch (error) {
      if (controller.signal.aborted) return
      if (mountedRef.current)
        setExportError(
          error instanceof Error
            ? error.message
            : 'Could not export the PDF. Your scans are unchanged; please try again.',
        )
      setStatus('Failed to export PDF.', true)
    } finally {
      exportLock.current = false
      exportController.current = null
      if (mountedRef.current) {
        setIsExporting(false)
        setExportProgress('')
      }
      if (searchablePdf) ocrWorker.terminate()
    }
  }

  useEffect(() => {
    previewGeneration.current++
    setPreviewUrl('')
    setPreviewBusy(false)
  }, [readyPdf])
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl],
  )
  const previewPdf = async () => {
    if (!readyPdf) return
    const generation = previewGeneration.current
    setPreviewBusy(true)
    try {
      const { importFile } = await import('../../core/import/files')
      for await (const item of importFile(
        new File([readyPdf], 'preview.pdf', { type: 'application/pdf' }),
      )) {
        if (mountedRef.current && generation === previewGeneration.current)
          setPreviewUrl(URL.createObjectURL(item.blob))
        break
      }
    } catch {
      if (mountedRef.current)
        setExportError(
          'Could not show the PDF preview. Try downloading and inspecting the file.',
        )
    } finally {
      if (mountedRef.current && generation === previewGeneration.current)
        setPreviewBusy(false)
    }
  }
  const downloadText = async () => {
    if (exportLock.current) return
    exportLock.current = true
    setIsExporting(true)
    setExportError(null)
    const controller = new AbortController()
    exportController.current = controller
    try {
      const texts: string[] = []
      for (let i = 0; i < selectedPages.length; i++) {
        setExportProgress(
          `Recognizing page ${i + 1} of ${selectedPages.length}…`,
        )
        const result = await ocrWorker.recognizePage(
          await blobToDataUrl(selectedPages[i].blob),
          language,
        )
        controller.signal.throwIfAborted()
        texts.push(result.text)
      }
      downloadBlob(
        new Blob([texts.join('\n\n')], { type: 'text/plain;charset=utf-8' }),
        `${filename || 'Recognized-text'}.txt`,
      )
      setStatus('Recognized text downloaded. Review it for recognition errors.')
    } catch (error) {
      if (!controller.signal.aborted)
        setExportError(
          error instanceof Error ? error.message : 'Could not recognize text.',
        )
    } finally {
      exportLock.current = false
      exportController.current = null
      ocrWorker.terminate()
      if (mountedRef.current) {
        setIsExporting(false)
        setExportProgress('')
      }
    }
  }

  const jpgBlob = async (page: ScanPage) => {
    const image = await createImageBitmap(page.blob)
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    try {
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0)
      return await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error('Could not create JPG.')),
          'image/jpeg',
          0.95,
        ),
      )
    } finally {
      image.close()
      canvas.width = canvas.height = 1
    }
  }
  const handleExportJpgs = async (selection: ScanPage[]) => {
    if (exportLock.current) return
    exportLock.current = true
    setIsExporting(true)
    const controller = new AbortController()
    exportController.current = controller
    try {
      for (let i = 0; i < selection.length; i++) {
        const page = selection[i],
          blob = await jpgBlob(page)
        controller.signal.throwIfAborted()
        downloadBlob(
          blob,
          `${filename.trim() || 'Scan'}-${page.name.replace(/[^\p{L}\p{N}._-]+/gu, '-')}.jpg`,
        )
      }
      setStatus(
        `Exported ${selection.length} JPG ${selection.length === 1 ? 'image' : 'images'}.`,
      )
      onClose()
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current)
        setExportError(
          error instanceof Error ? error.message : 'Could not export JPG.',
        )
    } finally {
      exportLock.current = false
      exportController.current = null
      if (mountedRef.current) setIsExporting(false)
    }
  }

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled)',
      ),
    ).filter((control) => control.getClientRects().length > 0)
    if (!controls.length) {
      event.preventDefault()
      return
    }
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  if (!isOpen) return null
  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!isExporting) onClose()
      }}
    >
      <div
        className="modal-dialog scanner-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <div className="modal-header">
          <div className="modal-title">
            <Download size={20} />
            <h3 id="export-title">Export Documents</h3>
          </div>
          <button
            type="button"
            className="btn-circle-subtle"
            onClick={onClose}
            aria-label={isExporting ? 'Cancel export' : 'Close export'}
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="exportFilename" className="input-label">
              File Name
            </label>
            <input
              ref={filenameRef}
              id="exportFilename"
              type="text"
              className="text-input"
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              disabled={isExporting}
              placeholder="e.g. Contract-Signed"
            />
          </div>
          <div className="form-group">
            <label htmlFor="exportPreset" className="input-label">
              Quick preset
            </label>
            <select
              id="exportPreset"
              className="select-input"
              defaultValue=""
              disabled={isExporting}
              onChange={(event) => {
                const value = event.target.value
                if (!value) return
                setLayout('document')
                setPaperFormat('a4')
                setMargin(20)
                setQuality(
                  value === 'print'
                    ? 'high'
                    : value === 'receipt'
                      ? 'small'
                      : 'balanced',
                )
                setTarget(value === 'application' ? '1000' : '')
                setFilename(
                  `${value === 'application' ? 'Application' : value === 'receipt' ? 'Receipts' : 'Print'}-${new Date().toISOString().slice(0, 10)}`,
                )
              }}
            >
              <option value="">Choose a starting point</option>
              <option value="application">Job application · 1 MB target</option>
              <option value="receipt">Receipts · small file</option>
              <option value="print">Print · high quality</option>
            </select>
          </div>
          <div className="export-options-grid">
            <div className="form-group">
              <label htmlFor="pdfLayout" className="input-label">
                PDF Layout
              </label>
              <select
                id="pdfLayout"
                className="select-input"
                value={layout}
                disabled={isExporting}
                onChange={(event) => setLayout(event.target.value as PdfLayout)}
              >
                <option value="document">Documents</option>
                <option value="id-card">ID card</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="pdfQuality" className="input-label">
                PDF Quality
              </label>
              <select
                id="pdfQuality"
                className="select-input"
                value={quality}
                disabled={isExporting}
                onChange={(event) =>
                  setQuality(event.target.value as PdfQuality)
                }
              >
                {Object.entries(PDF_QUALITY_PRESETS).map(([value, preset]) => (
                  <option key={value} value={value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="export-options-grid">
            <div className="form-group">
              <label htmlFor="targetSize" className="input-label">
                Maximum PDF size
              </label>
              <select
                id="targetSize"
                className="select-input"
                value={target}
                disabled={isExporting}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">No size limit</option>
                <option value="500">500 KB</option>
                <option value="1000">1 MB</option>
                <option value="2000">2 MB</option>
                <option value="custom">Custom limit</option>
              </select>
            </div>
            {target === 'custom' && (
              <div className="form-group">
                <label htmlFor="customSize" className="input-label">
                  Limit in KB (1 KB = 1,000 bytes)
                </label>
                <input
                  id="customSize"
                  className="text-input"
                  type="number"
                  min={1}
                  max={100000}
                  value={customKB}
                  disabled={isExporting}
                  onChange={(event) => setCustomKB(event.target.value)}
                />
              </div>
            )}
          </div>
          {target && (
            <p className="compression-warning">
              Compression can reduce readability. Review the PDF preview before
              submitting it.
            </p>
          )}
          <p className="pdf-quality-description">
            {PDF_QUALITY_PRESETS[quality].description}. This changes the PDF
            only; your scans and JPG exports keep their detail.
          </p>
          <div
            className="pdf-size-preview"
            role="status"
            data-testid="pdf-size"
            data-bytes={readyPdf?.size ?? ''}
          >
            <span>
              {searchablePdf ? 'Estimated size before OCR' : 'PDF size'}
            </span>
            <strong>
              {isPreparing
                ? 'Calculating…'
                : readyPdf
                  ? formatFileSize(readyPdf.size)
                  : 'Unavailable'}
            </strong>
            {searchablePdf && <small>The text layer adds extra bytes.</small>}
          </div>
          {readyPdf && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={previewBusy || isExporting}
              onClick={() => void previewPdf()}
            >
              {previewBusy ? 'Opening preview…' : 'Preview PDF quality'}
            </button>
          )}
          {previewUrl && (
            <img
              className="compression-preview"
              src={previewUrl}
              alt="First page of the prepared PDF at its export quality"
            />
          )}
          {layout === 'id-card' && (
            <div className="id-card-options">
              <div className="export-options-grid">
                <div className="form-group">
                  <label htmlFor="idFront" className="input-label">
                    Front side
                  </label>
                  <select
                    id="idFront"
                    className="select-input"
                    value={frontId}
                    disabled={isExporting}
                    onChange={(event) => setFrontId(event.target.value)}
                  >
                    {pages.map((page, index) => (
                      <option key={page.id} value={page.id}>
                        {index + 1}. {page.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="idBack" className="input-label">
                    Back side
                  </label>
                  <select
                    id="idBack"
                    className="select-input"
                    value={backId}
                    disabled={isExporting}
                    onChange={(event) => setBackId(event.target.value)}
                  >
                    <option value="">Front only</option>
                    {pages.map((page, index) => (
                      <option key={page.id} value={page.id}>
                        {index + 1}. {page.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {!selectionError && (
                <div
                  className="id-card-sheet-preview"
                  aria-label="Selected ID card sides"
                >
                  {[front, back]
                    .filter((page): page is ScanPage => Boolean(page))
                    .map((page, index) => (
                      <figure key={page.id}>
                        <figcaption>
                          {index === 0 ? 'Front' : 'Back'}
                        </figcaption>
                        <img
                          src={page.previewUrl}
                          alt={`${index === 0 ? 'Front' : 'Back'} side preview`}
                        />
                      </figure>
                    ))}
                </div>
              )}
              <p className="pdf-quality-description">
                Selected sides are stacked on one portrait sheet. Cards fit an
                85.6 × 54 mm area. Print at 100% scale.
              </p>
            </div>
          )}
          <button
            type="button"
            className="export-advanced-toggle"
            aria-expanded={advancedOpen}
            aria-controls="export-advanced-options"
            disabled={isExporting}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <span>Advanced options</span>
            <span aria-hidden="true">{advancedOpen ? '−' : '+'}</span>
          </button>
          <div
            id="export-advanced-options"
            className="export-advanced-options"
            hidden={!advancedOpen}
          >
            <div className="export-options-grid">
              <div className="form-group">
                <label htmlFor="paperSize" className="input-label">
                  Paper Size
                </label>
                <select
                  id="paperSize"
                  className="select-input"
                  value={paperFormat}
                  disabled={isExporting}
                  onChange={(event) =>
                    setPaperFormat(event.target.value as 'a4' | 'letter')
                  }
                >
                  <option value="a4">A4 (Standard ISO)</option>
                  <option value="letter">US Letter</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="pageMargins" className="input-label">
                  Margins
                </label>
                <select
                  id="pageMargins"
                  className="select-input"
                  value={margin}
                  disabled={isExporting}
                  onChange={(event) => setMargin(Number(event.target.value))}
                >
                  <option value={20}>Standard (20 pt)</option>
                  <option value={0}>Borderless (0 pt)</option>
                  <option value={40}>Wide (40 pt)</option>
                </select>
              </div>
            </div>
            <button
              type="button"
              className={`searchable-toggle-card ${searchablePdf ? 'enabled' : ''}`}
              role="checkbox"
              aria-checked={searchablePdf}
              disabled={isExporting}
              onClick={() => setSearchablePdf((value) => !value)}
            >
              <span className="searchable-toggle-icon">
                <Search size={18} />
              </span>
              <span className="searchable-toggle-text">
                <strong>Searchable PDF (OCR)</strong>
                <span className="pdf-quality-description">
                  Recognize text locally in your selected language. First use
                  needs internet to download recognition files. No document
                  uploads.
                </span>
              </span>
              <span className={`toggle-pill ${searchablePdf ? 'on' : 'off'}`}>
                {searchablePdf ? 'ON' : 'OFF'}
              </span>
            </button>
            <div className="form-group">
              <label htmlFor="ocrLanguage" className="input-label">
                Text recognition language
              </label>
              <select
                id="ocrLanguage"
                className="select-input"
                value={language}
                disabled={isExporting}
                onChange={(event) => setLanguage(event.target.value)}
              >
                {[
                  ['eng', 'English'],
                  ['spa', 'Spanish'],
                  ['fra', 'French'],
                  ['deu', 'German'],
                  ['hin', 'Hindi'],
                  ['ara', 'Arabic'],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            {textOnlyLanguage && (
              <p className="pdf-quality-description">
                Hindi and Arabic are available as Unicode text downloads. Turn
                off Searchable PDF to export the page images; these scripts
                cannot be embedded reliably in the current PDF text layer.
              </p>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isExporting}
              onClick={() => void downloadText()}
            >
              Download recognized text (.txt)
            </button>
            {layout === 'document' && (
              <div className="export-image-options">
                <p className="input-label">Image downloads</p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!activePage || isExporting}
                  onClick={() =>
                    activePage && void handleExportJpgs([activePage])
                  }
                >
                  <ImageIcon size={16} />
                  <span>Download Current JPG</span>
                </button>
                {pages.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={isExporting}
                    onClick={() => void handleExportJpgs(pages)}
                  >
                    <ImageIcon size={16} />
                    <span>Download All JPGs</span>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="export-summary-box">
            <CheckCircle2 size={18} className="summary-icon" />
            <div>
              <strong>
                {layout === 'id-card'
                  ? '1 sheet'
                  : `${selectedPages.length} ${selectedPages.length === 1 ? 'page' : 'pages'}`}{' '}
                ready
              </strong>
              <p>
                {layout === 'id-card'
                  ? `${selectedPages.length} selected ${selectedPages.length === 1 ? 'side' : 'sides'}`
                  : 'Auto-orientation matches each page.'}
              </p>
            </div>
          </div>

          {(selectionError || targetError || exportError || sizeError) && (
            <p className="pdf-export-error" role="alert">
              {selectionError || targetError || exportError || sizeError}
            </p>
          )}
          {isExporting && (
            <div className="export-progress-row" role="status">
              <Loader2 size={15} className="spin-icon text-brand" />
              <span>{exportProgress}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              !selectedPages.length ||
              isExporting ||
              isPreparing ||
              Boolean(
                selectionError ||
                targetError ||
                sizeError ||
                (searchablePdf && textOnlyLanguage),
              )
            }
            onClick={() => void handleExportPdf()}
          >
            {isExporting ? (
              <Loader2 size={16} className="spin-icon" />
            ) : (
              <FileText size={16} />
            )}
            <span>
              {isExporting
                ? exportProgress || 'Exporting…'
                : layout === 'id-card'
                  ? 'Download ID Card PDF'
                  : searchablePdf
                    ? 'Download Searchable PDF'
                    : 'Download Multi-Page PDF'}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
