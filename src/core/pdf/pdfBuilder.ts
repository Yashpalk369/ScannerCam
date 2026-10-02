import { jsPDF } from 'jspdf'
import type { ScanPage } from '../cv/types'

export interface PdfExportOptions {
  filename?: string
  format?: 'a4' | 'letter'
  orientation?: 'auto' | 'portrait' | 'landscape'
  margin?: number // in points
  quality?: number
  /** If true, embeds an invisible OCR text layer for searchable/copyable PDF */
  searchable?: boolean
  /** OCR text per page, indexed by page order. Must be provided when searchable=true. */
  ocrTexts?: string[]
  onProgress?: (current: number, total: number, message: string) => void
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read blob as data URL'))
    reader.readAsDataURL(blob)
  })
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

export async function exportPagesToPdf(
  pages: ScanPage[],
  options: PdfExportOptions = {},
): Promise<void> {
  if (pages.length === 0) return

  const {
    filename = `ScannerCam-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.pdf`,
    format = 'a4',
    margin = 20,
    searchable = false,
    ocrTexts = [],
    onProgress,
  } = options

  // Read first page to determine initial document orientation
  const firstDataUrl = await blobToDataUrl(pages[0].blob)
  const firstIsLandscape = pages[0].width > pages[0].height
  const initialOrientation =
    options.orientation === 'auto'
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

    const dataUrl = i === 0 ? firstDataUrl : await blobToDataUrl(page.blob)
    const isLandscape = page.width > page.height
    const pageOrientation =
      options.orientation === 'auto'
        ? isLandscape
          ? 'landscape'
          : 'portrait'
        : options.orientation || (isLandscape ? 'landscape' : 'portrait')

    if (i > 0) {
      doc.addPage(format, pageOrientation)
    }

    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()

    const availW = Math.max(20, pageWidth - margin * 2)
    const availH = Math.max(20, pageHeight - margin * 2)

    const scale = Math.min(availW / page.width, availH / page.height)
    const renderW = page.width * scale
    const renderH = page.height * scale

    const x = (pageWidth - renderW) / 2
    const y = (pageHeight - renderH) / 2

    doc.addImage(dataUrl, 'JPEG', x, y, renderW, renderH, undefined, 'FAST')

    // Embed invisible OCR text layer if available
    if (searchable && ocrTexts[i]) {
      embedTextLayer(doc, ocrTexts[i], x, y, renderW, renderH)
    }
  }

  onProgress?.(pages.length, pages.length, 'Saving PDF…')
  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
