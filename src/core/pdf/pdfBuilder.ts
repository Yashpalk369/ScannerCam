import { jsPDF } from 'jspdf'
import type { ScanPage } from '../cv/types'
import {
  fitImage,
  idCardBoxes,
  PDF_QUALITY_PRESETS,
  rasterSize,
} from './pdfLayout'
import type { ImageBox, PdfLayout, PdfQuality } from './pdfLayout'

export interface PdfExportOptions {
  filename?: string
  format?: 'a4' | 'letter'
  orientation?: 'auto' | 'portrait' | 'landscape'
  margin?: number // in points
  maxImageEdge?: number
  targetBytes?: number
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
  if (signal?.aborted)
    throw new DOMException('PDF preparation cancelled.', 'AbortError')
}

async function prepareImage(
  page: ScanPage,
  placement: ImageBox,
  options: PdfExportOptions,
): Promise<Uint8Array> {
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
    const size = rasterSize(
      image.naturalWidth,
      image.naturalHeight,
      placement,
      quality,
    )
    if (options.maxImageEdge) {
      const factor = Math.min(
        1,
        options.maxImageEdge / Math.max(size.width, size.height),
      )
      size.width = Math.max(1, Math.round(size.width * factor))
      size.height = Math.max(1, Math.round(size.height * factor))
    }
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare the PDF image.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(image, 0, 0, size.width, size.height)
    const jpegQuality =
      options.quality ?? PDF_QUALITY_PRESETS[quality].jpegQuality
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('Could not compress the PDF image.')),
        'image/jpeg',
        jpegQuality,
      )
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
 * PDF rendering mode 3 keeps text searchable without painting over the scan.
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

  doc.setFontSize(1)

  // Split text into lines and distribute them proportionally across the page
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return

  const lineHeight = pageH / Math.max(lines.length, 1)

  lines.forEach((line, i) => {
    const y = pageY + (i + 0.5) * lineHeight
    if (y > pageY + pageH) return
    doc.text(line.trim(), pageX, y, {
      baseline: 'middle',
      renderingMode: 'invisible',
    })
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
  if (options.layout === 'id-card' && pages.length > 2)
    throw new Error('Choose one or two sides for an ID card.')
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
    options.layout === 'id-card'
      ? 'portrait'
      : options.orientation === 'auto'
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
    onProgress?.(
      i + 1,
      pages.length,
      `Adding page ${i + 1} of ${pages.length}…`,
    )

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

    const box =
      options.layout === 'id-card'
        ? idCardBoxes(pageWidth, pageHeight, pages.length, margin)[i]
        : {
            x: margin,
            y: margin,
            width: pageWidth - margin * 2,
            height: pageHeight - margin * 2,
          }
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

/** Measure every candidate including the text layer; never call an oversized result successful. */
export async function createPdfForTarget(
  pages: ScanPage[],
  options: PdfExportOptions = {},
): Promise<Blob> {
  const target = options.targetBytes
  if (target !== undefined && (!Number.isFinite(target) || target < 1000))
    throw new Error('Choose a target of at least 1 KB.')
  let blob = await createPdfBlob(pages, options)
  if (!target || blob.size <= target) return blob
  for (const [edge, quality] of [
    [2000, 0.75],
    [1800, 0.6],
    [1600, 0.5],
    [1400, 0.45],
    [1200, 0.4],
    [1000, 0.35],
    [800, 0.3],
    [600, 0.25],
  ]) {
    checkAborted(options.signal)
    options.onProgress?.(
      0,
      pages.length,
      `Compressing toward ${Math.round(target / 1000)} KB…`,
    )
    const candidate = await createPdfBlob(pages, {
      ...options,
      maxImageEdge: edge,
      quality,
    })
    if (candidate.size < blob.size) blob = candidate
    if (blob.size <= target) return blob
  }
  throw new Error(
    `Could not meet this size limit. Smallest result: ${Math.ceil(blob.size / 1000)} KB. Choose a larger limit or export fewer pages.`,
  )
}

export async function exportPagesToPdf(
  pages: ScanPage[],
  options: PdfExportOptions = {},
): Promise<void> {
  if (pages.length === 0) return
  const blob = await createPdfBlob(pages, options)
  const filename =
    options.filename || `ScannerCam-${new Date().toISOString().slice(0, 10)}`
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
