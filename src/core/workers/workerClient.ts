import type { FilterMode, Quad } from '../cv/types'
import type {
  WorkerRequest,
  WorkerResponse,
  WorkerSuccessResponse,
} from './cv.worker'

class CVWorkerClient {
  private worker: Worker | null = null
  private pendingRequests = new Map<
    string,
    {
      resolve: (resp: WorkerSuccessResponse) => void
      reject: (err: Error) => void
    }
  >()

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./cv.worker.ts', import.meta.url),
        { type: 'module' },
      )

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const res = event.data
        const handler = this.pendingRequests.get(res.id)
        if (!handler) return

        this.pendingRequests.delete(res.id)
        if (res.success) {
          handler.resolve(res)
        } else {
          handler.reject(new Error(res.error))
        }
      }

      this.worker.onerror = (err) => {
        console.error('CV Worker error:', err)
      }
    }
    return this.worker
  }

  private sendRequest(req: WorkerRequest, transferList: Transferable[] = []): Promise<WorkerSuccessResponse> {
    const worker = this.getWorker()
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(req.id, { resolve, reject })
      worker.postMessage(req, transferList)
    })
  }

  /**
   * Loads a Blob into an HTMLImageElement.
   */
  async blobToImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve(img)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Failed to decode image from blob'))
      }
      img.src = url
    })
  }

  /**
   * Resizes an image if larger than maxEdge to preserve memory and speed.
   */
  async blobToImageData(blob: Blob, maxEdge = 3840): Promise<{
    imageData: ImageData
    width: number
    height: number
  }> {
    const img = await this.blobToImage(blob)
    let width = img.naturalWidth
    let height = img.naturalHeight

    const longestEdge = Math.max(width, height)
    if (longestEdge > maxEdge) {
      const scale = maxEdge / longestEdge
      width = Math.max(1, Math.round(width * scale))
      height = Math.max(1, Math.round(height * scale))
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2D canvas context')

    ctx.drawImage(img, 0, 0, width, height)
    const imageData = ctx.getImageData(0, 0, width, height)
    return { imageData, width, height }
  }

  /**
   * Converts an ImageData object back to a compressed JPEG Blob (HD quality).
   */
  async imageDataToBlob(imageData: ImageData, quality = 0.96): Promise<Blob> {
    const canvas = document.createElement('canvas')
    canvas.width = imageData.width
    canvas.height = imageData.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2D canvas context')

    ctx.putImageData(imageData, 0, 0)
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Failed to encode canvas to blob'))
        },
        'image/jpeg',
        quality,
      )
    })
  }

  /**
   * Warps perspective and applies filter off the main thread.
   */
  async warpAndFilter(
    blob: Blob,
    quad: Quad,
    filter: FilterMode,
  ): Promise<{ blob: Blob; width: number; height: number }> {
    const { imageData, width, height } = await this.blobToImageData(blob)
    const id = crypto.randomUUID()

    const res = await this.sendRequest(
      {
        id,
        type: 'WARP_AND_FILTER',
        srcBuffer: imageData.data.buffer,
        srcWidth: width,
        srcHeight: height,
        quad,
        filter,
      },
      [imageData.data.buffer],
    )

    if (!res.dstBuffer || !res.dstWidth || !res.dstHeight) {
      throw new Error('Worker did not return valid image buffer')
    }

    const outImageData = new ImageData(
      new Uint8ClampedArray(res.dstBuffer),
      res.dstWidth,
      res.dstHeight,
    )
    const outBlob = await this.imageDataToBlob(outImageData)

    return {
      blob: outBlob,
      width: res.dstWidth,
      height: res.dstHeight,
    }
  }

  /**
   * Re-applies a filter to an already warped blob off the main thread.
   */
  async applyFilter(
    blob: Blob,
    filter: FilterMode,
  ): Promise<{ blob: Blob; width: number; height: number }> {
    const { imageData, width, height } = await this.blobToImageData(blob)
    const id = crypto.randomUUID()

    const res = await this.sendRequest(
      {
        id,
        type: 'APPLY_FILTER',
        srcBuffer: imageData.data.buffer,
        srcWidth: width,
        srcHeight: height,
        filter,
      },
      [imageData.data.buffer],
    )

    if (!res.dstBuffer || !res.dstWidth || !res.dstHeight) {
      throw new Error('Worker did not return valid image buffer')
    }

    const outImageData = new ImageData(
      new Uint8ClampedArray(res.dstBuffer),
      res.dstWidth,
      res.dstHeight,
    )
    const outBlob = await this.imageDataToBlob(outImageData)

    return {
      blob: outBlob,
      width: res.dstWidth,
      height: res.dstHeight,
    }
  }

  /**
   * Auto-detects document corners in a blob off the main thread.
   */
  async detectQuad(blob: Blob): Promise<Quad> {
    const { imageData, width, height } = await this.blobToImageData(blob, 1000)
    const id = crypto.randomUUID()

    const res = await this.sendRequest(
      {
        id,
        type: 'DETECT_QUAD',
        srcBuffer: imageData.data.buffer,
        srcWidth: width,
        srcHeight: height,
      },
      [imageData.data.buffer],
    )

    if (!res.quad) {
      throw new Error('Failed to detect quad')
    }

    // Scale quad coordinates back to original unscaled dimensions if necessary
    const rawImg = await this.blobToImage(blob)
    const scaleX = rawImg.naturalWidth / width
    const scaleY = rawImg.naturalHeight / height

    return [
      { x: Math.round(res.quad[0].x * scaleX), y: Math.round(res.quad[0].y * scaleY) },
      { x: Math.round(res.quad[1].x * scaleX), y: Math.round(res.quad[1].y * scaleY) },
      { x: Math.round(res.quad[2].x * scaleX), y: Math.round(res.quad[2].y * scaleY) },
      { x: Math.round(res.quad[3].x * scaleX), y: Math.round(res.quad[3].y * scaleY) },
    ]
  }

  /**
   * Rotates a blob 90 degrees clockwise.
   */
  async rotateBlob90(blob: Blob): Promise<Blob> {
    const img = await this.blobToImage(blob)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalHeight
    canvas.height = img.naturalWidth
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get 2D canvas context')

    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate(Math.PI / 2)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) resolve(b)
          else reject(new Error('Failed to encode rotated image'))
        },
        'image/jpeg',
        0.95,
      )
    })
  }
}

export const cvWorker = new CVWorkerClient()
