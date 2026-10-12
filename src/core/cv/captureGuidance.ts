import type { Quad } from './types'

export interface CaptureStability {
  anchor: Quad | null
  since: number
  ready: boolean
}

export const EMPTY_STABILITY: CaptureStability = { anchor: null, since: 0, ready: false }

/** Coordinates are measured on the small detection frame, independent of camera resolution. */
export function updateCaptureStability(
  previous: CaptureStability,
  quad: Quad | null,
  now: number,
  qualityAllowsCapture: boolean,
): CaptureStability {
  if (!quad || !qualityAllowsCapture) return EMPTY_STABILITY
  const drift = previous.anchor
    ? Math.max(...quad.map((point, index) => Math.hypot(point.x - previous.anchor![index].x, point.y - previous.anchor![index].y)))
    : Infinity
  if (drift > 5) return { anchor: quad, since: now, ready: false }
  return { ...previous, ready: now - previous.since >= 900 }
}

export interface CaptureQuality {
  lowLight: boolean
  blurry: boolean
}

/** Sample the document interior so a textured desk cannot hide a soft or dark scan. */
export function assessCaptureQuality(image: ImageData, quad: Quad): CaptureQuality {
  const { data, width, height } = image
  const left = Math.min(...quad.map(p => p.x))
  const right = Math.max(...quad.map(p => p.x))
  const top = Math.min(...quad.map(p => p.y))
  const bottom = Math.max(...quad.map(p => p.y))
  const x0 = Math.max(1, Math.round(left + (right - left) * 0.2))
  const x1 = Math.min(width - 2, Math.round(right - (right - left) * 0.2))
  const y0 = Math.max(1, Math.round(top + (bottom - top) * 0.2))
  const y1 = Math.min(height - 2, Math.round(bottom - (bottom - top) * 0.2))
  const luminance = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
  }
  let sum = 0
  let squares = 0
  let laplacianSquares = 0
  let count = 0
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const value = luminance(x, y)
      const laplacian = 4 * value - luminance(x - 1, y) - luminance(x + 1, y) - luminance(x, y - 1) - luminance(x, y + 1)
      sum += value
      squares += value * value
      laplacianSquares += laplacian * laplacian
      count += 1
    }
  }
  if (count === 0) return { lowLight: false, blurry: false }
  const mean = sum / count
  const variance = squares / count - mean * mean
  // A blank page has no detail to assess: avoid calling it blurry.
  return { lowLight: mean < 65, blurry: variance > 150 && laplacianSquares / count < 20 }
}

/** Map video coordinates into an object-fit: contain viewport, including letterboxing. */
export function mapVideoQuad(quad: Quad, videoWidth: number, videoHeight: number, viewWidth: number, viewHeight: number): Quad {
  const scale = Math.min(viewWidth / videoWidth, viewHeight / videoHeight)
  const offsetX = (viewWidth - videoWidth * scale) / 2
  const offsetY = (viewHeight - videoHeight * scale) / 2
  return quad.map(point => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY })) as Quad
}
