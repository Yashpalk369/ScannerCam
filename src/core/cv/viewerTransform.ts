import type { EditorView, Point } from './types'

export interface ViewerTransform {
  zoom: number
  pan: Point
}

export interface ViewerViewport {
  width: number
  height: number
  top: number
  bottom: number
}

export function clampZoom(zoom: number): number {
  return Math.max(1, Math.min(24, Number.isFinite(zoom) ? zoom : 1))
}

export function calculateImageView(imageWidth: number, imageHeight: number, viewport: ViewerViewport, transform: ViewerTransform): {
  view: EditorView; pan: Point; fitScale: number; center: Point
} {
  const availableWidth = Math.max(1, viewport.width - 40)
  const availableHeight = Math.max(1, viewport.height - viewport.top - viewport.bottom)
  const fitScale = Math.min(1, availableWidth / imageWidth, availableHeight / imageHeight)
  const scale = fitScale * clampZoom(transform.zoom)
  const drawWidth = imageWidth * scale
  const drawHeight = imageHeight * scale
  const maxX = Math.max(0, (drawWidth - availableWidth) / 2)
  const maxY = Math.max(0, (drawHeight - availableHeight) / 2)
  const pan = {
    x: Math.max(-maxX, Math.min(maxX, transform.pan.x)),
    y: Math.max(-maxY, Math.min(maxY, transform.pan.y)),
  }
  const center = { x: viewport.width / 2, y: viewport.top + availableHeight / 2 }
  return {
    view: { offsetX: center.x - drawWidth / 2 + pan.x, offsetY: center.y - drawHeight / 2 + pan.y, scale, drawWidth, drawHeight, imageWidth, imageHeight },
    pan, fitScale, center,
  }
}

/** Preserve the image point beneath the mouse or the midpoint of a pinch. */
export function zoomAtPoint(current: ViewerTransform, nextZoom: number, anchor: Point, center: Point): ViewerTransform {
  const zoom = clampZoom(nextZoom)
  const ratio = zoom / current.zoom
  return {
    zoom,
    pan: {
      x: (anchor.x - center.x) - (anchor.x - center.x - current.pan.x) * ratio,
      y: (anchor.y - center.y) - (anchor.y - center.y - current.pan.y) * ratio,
    },
  }
}
