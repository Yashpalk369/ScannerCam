import type { FilterMode, Point, Quad } from '../cv/types'
import {
  applyHomography,
  buildHomography,
  defaultQuad,
  estimateWarpSize,
} from '../cv/homography'
import { applyFilterToImageData } from '../cv/filters'
import { detectDocumentQuad } from '../cv/edgeDetection'

export interface WarpRequest {
  id: string
  type: 'WARP_AND_FILTER'
  srcBuffer: ArrayBuffer
  srcWidth: number
  srcHeight: number
  quad: Quad
  filter: FilterMode
}

export interface FilterOnlyRequest {
  id: string
  type: 'APPLY_FILTER'
  srcBuffer: ArrayBuffer
  srcWidth: number
  srcHeight: number
  filter: FilterMode
}

export interface DetectQuadRequest {
  id: string
  type: 'DETECT_QUAD'
  srcBuffer: ArrayBuffer
  srcWidth: number
  srcHeight: number
}

export type WorkerRequest = WarpRequest | FilterOnlyRequest | DetectQuadRequest

export interface WorkerSuccessResponse {
  id: string
  success: true
  dstBuffer?: ArrayBuffer
  dstWidth?: number
  dstHeight?: number
  quad?: Quad
}

export interface WorkerErrorResponse {
  id: string
  success: false
  error: string
}

export type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse

function warpPerspectivePixels(
  srcPixels: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  quad: Quad,
): { dstPixels: Uint8ClampedArray; dstWidth: number; dstHeight: number } {
  const target = estimateWarpSize(quad)
  const dstWidth = target.width
  const dstHeight = target.height

  const dstCorners: Quad = [
    { x: 0, y: 0 },
    { x: dstWidth - 1, y: 0 },
    { x: dstWidth - 1, y: dstHeight - 1 },
    { x: 0, y: dstHeight - 1 },
  ]

  // Map from output canvas coordinates to input quad coordinates
  const h = buildHomography(dstCorners, quad)
  const dstPixels = new Uint8ClampedArray(dstWidth * dstHeight * 4)

  for (let y = 0; y < dstHeight; y += 1) {
    const rowOffset = y * dstWidth * 4
    for (let x = 0; x < dstWidth; x += 1) {
      const idx = rowOffset + x * 4
      const mapped: Point = applyHomography(h, x, y)

      if (
        !Number.isFinite(mapped.x) ||
        !Number.isFinite(mapped.y) ||
        mapped.x < 0 ||
        mapped.y < 0 ||
        mapped.x >= srcWidth - 1 ||
        mapped.y >= srcHeight - 1
      ) {
        dstPixels[idx] = 255
        dstPixels[idx + 1] = 255
        dstPixels[idx + 2] = 255
        dstPixels[idx + 3] = 255
        continue
      }

      const x0 = Math.floor(mapped.x)
      const y0 = Math.floor(mapped.y)
      const x1 = Math.min(x0 + 1, srcWidth - 1)
      const y1 = Math.min(y0 + 1, srcHeight - 1)
      const dx = mapped.x - x0
      const dy = mapped.y - y0

      const idx00 = (y0 * srcWidth + x0) * 4
      const idx10 = (y0 * srcWidth + x1) * 4
      const idx01 = (y1 * srcWidth + x0) * 4
      const idx11 = (y1 * srcWidth + x1) * 4

      for (let c = 0; c < 4; c += 1) {
        const top = srcPixels[idx00 + c] * (1 - dx) + srcPixels[idx10 + c] * dx
        const bottom = srcPixels[idx01 + c] * (1 - dx) + srcPixels[idx11 + c] * dx
        dstPixels[idx + c] = Math.round(top * (1 - dy) + bottom * dy)
      }
    }
  }

  return { dstPixels, dstWidth, dstHeight }
}

const workerScope = self as unknown as {
  postMessage: (msg: unknown, transfer?: Transferable[]) => void
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
}

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data

  try {
    if (req.type === 'WARP_AND_FILTER') {
      const srcPixels = new Uint8ClampedArray(req.srcBuffer)
      const { dstPixels, dstWidth, dstHeight } = warpPerspectivePixels(
        srcPixels,
        req.srcWidth,
        req.srcHeight,
        req.quad,
      )

      // Cast to any to satisfy strict ImageDataArray<ArrayBuffer> definition in TS 6
      const imgData = new ImageData(dstPixels as any, dstWidth, dstHeight)
      applyFilterToImageData(imgData, req.filter)

      const response: WorkerSuccessResponse = {
        id: req.id,
        success: true,
        dstBuffer: imgData.data.buffer,
        dstWidth,
        dstHeight,
      }

      workerScope.postMessage(response, [imgData.data.buffer])
      return
    }

    if (req.type === 'APPLY_FILTER') {
      const pixels = new Uint8ClampedArray(req.srcBuffer)
      const imgData = new ImageData(pixels as any, req.srcWidth, req.srcHeight)
      applyFilterToImageData(imgData, req.filter)

      const response: WorkerSuccessResponse = {
        id: req.id,
        success: true,
        dstBuffer: imgData.data.buffer,
        dstWidth: req.srcWidth,
        dstHeight: req.srcHeight,
      }

      workerScope.postMessage(response, [imgData.data.buffer])
      return
    }

    if (req.type === 'DETECT_QUAD') {
      const pixels = new Uint8ClampedArray(req.srcBuffer)
      const imgData = new ImageData(pixels as any, req.srcWidth, req.srcHeight)
      const detected = detectDocumentQuad(imgData)

      const response: WorkerSuccessResponse = {
        id: req.id,
        success: true,
        quad: detected ?? defaultQuad(req.srcWidth, req.srcHeight),
      }

      workerScope.postMessage(response)
      return
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const errorResponse: WorkerErrorResponse = {
      id: req.id,
      success: false,
      error: errorMsg,
    }
    workerScope.postMessage(errorResponse)
  }
}
