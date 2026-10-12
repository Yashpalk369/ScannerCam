export type PdfQuality = 'small' | 'balanced' | 'high'
export type PdfLayout = 'document' | 'id-card'

export const PDF_QUALITY_PRESETS = {
  small: { label: 'Small', dpi: 120, jpegQuality: 0.6, description: 'Smaller files for sharing and upload limits' },
  balanced: { label: 'Balanced', dpi: 180, jpegQuality: 0.8, description: 'Clear text with a moderate file size' },
  high: { label: 'High Quality', dpi: 300, jpegQuality: 0.94, description: 'More detail for printing and archiving' },
} as const

export interface ImageBox {
  x: number
  y: number
  width: number
  height: number
}

export function fitImage(width: number, height: number, box: ImageBox): ImageBox {
  if (width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0 || ![width, height, ...Object.values(box)].every(Number.isFinite)) {
    throw new Error('Invalid image or page dimensions.')
  }
  const scale = Math.min(box.width / width, box.height / height)
  const renderWidth = width * scale
  const renderHeight = height * scale
  return { x: box.x + (box.width - renderWidth) / 2, y: box.y + (box.height - renderHeight) / 2, width: renderWidth, height: renderHeight }
}

export function idCardBoxes(pageWidth: number, pageHeight: number, count: number, margin: number): ImageBox[] {
  if (count !== 1 && count !== 2) throw new Error('Choose one or two sides for an ID card.')
  const width = Math.min(85.6 / 25.4 * 72, pageWidth - margin * 2)
  const height = Math.min(54 / 25.4 * 72, (pageHeight - margin * 2 - 32 * (count - 1)) / count)
  if (width <= 0 || height <= 0) throw new Error('Margins leave no room for the ID card.')
  const top = (pageHeight - height * count - 32 * (count - 1)) / 2
  return Array.from({ length: count }, (_, index) => ({ x: (pageWidth - width) / 2, y: top + index * (height + 32), width, height }))
}

export function rasterSize(width: number, height: number, placement: ImageBox, quality: PdfQuality): { width: number; height: number } {
  const dpi = PDF_QUALITY_PRESETS[quality].dpi
  const scale = Math.min(1, placement.width / 72 * dpi / width, placement.height / 72 * dpi / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}
