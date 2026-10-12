import { jsPDF } from 'jspdf'
import type { ScanPage } from '../cv/types'
import { fitImage, idCardBoxes, PDF_QUALITY_PRESETS, rasterSize } from './pdfLayout'
import type { ImageBox, PdfLayout, PdfQuality } from './pdfLayout'

export interface PdfExportOptions {
  filename?: string
  format?: 'a4' | 'letter'
  orientation?: 'auto' | 'portrait' | 'landscape'
  margin?: number // in points
  quality?: number
  qualityPreset?: PdfQuality
  layout?: PdfLayout
  signal?: AbortSignal
  /** If true, embeds an invisible OCR text layer for searchable/copyable PDF */
  searchable?: boolean
  /** OCR text per page, indexed by page order. Must be provided when searchable=true. */
  ocrTexts?: string[]
  onProgress?: (current: number, total: number, message: string) => void
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('PDF preparation cancelled.', 'AbortError')
}

async function prepareImage(page: ScanPage, placement: ImageBox, options: PdfExportOptions): Promise<Uint8Array> {
  checkAborted(options.signal)
  const url = URL.createObjectURL(page.blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error(`Could not read ${page.name}.`))
      image.src = url
    })
    checkAborted(options.signal)
    const quality = options.qualityPreset ?? 'balanced'
    const size = rasterSize(image.naturalWidth, image.naturalHeight, placement, quality)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare the PDF image.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(image, 0, 0, size.width, size.height)
    const jpegQuality = options.quality ?? PDF_QUALITY_PRESETS[quality].jpegQuality
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not compress the PDF image.')), 'image/jpeg', jpegQuality)
    })
    // Release raster memory before processing the next scan.
    canvas.width = canvas.height = 1
    checkAborted(options.signal)
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Embeds an invisible OCR text overlay over a PDF page.
 * Text is rendered at font-size 1 with white color (invisible but selectable/searchable).
 */
function embedTextLayer(
  doc: jsPDF,
  text: string,
  pageX: number,
  pageY: number,
  _pageW: number,
  pageH: number,
): void {
  if (!text || !text.trim()) return

  // Save state, set invisible white text
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(1)

  // Split text into lines and distribute them proportionally across the page
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return

  const lineHeight = pageH / Math.max(lines.length, 1)

  lines.forEach((line, i) => {
    const y = pageY + (i + 0.5) * lineHeight
    if (y > pageY + pageH) return
    doc.text(line.trim(), pageX, y, { baseline: 'middle' })
  })

  // Reset to default black
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(12)
}

export async function createPdfBlob(
  pages: ScanPage[],
  options: PdfExportOptions = {},
): Promise<Blob> {
  if (pages.length === 0) throw new Error('Add a scan before exporting.')
  if (options.layout === 'id-card' && pages.length > 2) throw new Error('Choose one or two sides for an ID card.')
  checkAborted(options.signal)

  const {
    format = 'a4',
    margin = 20,
    searchable = false,
    ocrTexts = [],
    onProgress,
  } = options

  // Read first page to determine initial document orientation
  const firstIsLandscape = pages[0].width > pages[0].height
  const initialOrientation =
    options.layout === 'id-card' ? 'portrait' : options.orientation === 'auto'
      ? firstIsLandscape
        ? 'landscape'
        : 'portrait'
      : options.orientation || (firstIsLandscape ? 'landscape' : 'portrait')

  const doc = new jsPDF({
    orientation: initialOrientation,
    unit: 'pt',
    format,
    compress: true,
  })

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]
    onProgress?.(i + 1, pages.length, `Adding page ${i + 1} of ${pages.length}…`)

    const isLandscape = page.width > page.height
    const pageOrientation =
      options.orientation === 'auto'
        ? isLandscape
          ? 'landscape'
          : 'portrait'
        : options.orientation || (isLandscape ? 'landscape' : 'portrait')

    if (i > 0 && options.layout !== 'id-card') {
      doc.addPage(format, pageOrientation)
    }

    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()

    const box = options.layout === 'id-card'
      ? idCardBoxes(pageWidth, pageHeight, pages.length, margin)[i]
      : { x: margin, y: margin, width: pageWidth - margin * 2, height: pageHeight - margin * 2 }
    const placement = fitImage(page.width, page.height, box)
    const { x, y, width: renderW, height: renderH } = placement
    const image = await prepareImage(page, placement, options)
    checkAborted(options.signal)
    doc.addImage(image, 'JPEG', x, y, renderW, renderH, undefined, 'FAST')
    if (options.layout === 'id-card') {
      doc.setFontSize(10)
      doc.setTextColor(80, 80, 80)
      doc.text(i === 0 ? 'Front' : 'Back', box.x, box.y - 8)
    }

    // Embed invisible OCR text layer if available
    if (searchable && ocrTexts[i]) {
      embedTextLayer(doc, ocrTexts[i], x, y, renderW, renderH)
    }
  }

  checkAborted(options.signal)
  return doc.output('blob')
}

export async function exportPagesToPdf(pages: ScanPage[], options: PdfExportOptions = {}): Promise<void> {
  if (pages.length === 0) return
  const blob = await createPdfBlob(pages, options)
  const filename = options.filename || `ScannerCam-${new Date().toISOString().slice(0, 10)}`
  options.onProgress?.(pages.length, pages.length, 'Saving PDF…')
  downloadBlob(blob, filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Give the browser time to start reading the file before releasing its URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
