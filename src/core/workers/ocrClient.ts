/**
 * OCR Worker Client — typed async RPC bridge for the Tesseract.js OCR worker.
 * The worker is spawned lazily on first use so it never impacts initial load.
 */

interface OcrRequest {
  id: string
  type: 'OCR_PAGE'
  imageDataUrl: string
  lang: string
}

interface OcrSuccessResponse {
  id: string
  success: true
  text: string
  hocr: string
}

interface OcrErrorResponse {
  id: string
  success: false
  error: string
}

type OcrResponse = OcrSuccessResponse | OcrErrorResponse

class OcrWorkerClient {
  private worker: Worker | null = null
  private pending = new Map<string, {
    resolve: (r: OcrSuccessResponse) => void
    reject: (e: Error) => void
  }>()

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./ocr.worker.ts', import.meta.url),
        { type: 'module' },
      )
      this.worker.onmessage = (e: MessageEvent<OcrResponse>) => {
        const res = e.data
        const handler = this.pending.get(res.id)
        if (!handler) return
        this.pending.delete(res.id)
        if (res.success) {
          handler.resolve(res)
        } else {
          handler.reject(new Error(res.error))
        }
      }
      this.worker.onerror = (err) => {
        console.error('OCR Worker error:', err)
      }
    }
    return this.worker
  }

  /**
   * Performs OCR on a single image data URL.
   * Returns { text, hocr } — text for display, hocr for PDF embedding.
   */
  async recognizePage(imageDataUrl: string, lang = 'eng'): Promise<{ text: string; hocr: string }> {
    const worker = this.getWorker()
    const id = crypto.randomUUID()

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const req: OcrRequest = { id, type: 'OCR_PAGE', imageDataUrl, lang }
      worker.postMessage(req)
    })
  }

  /** Terminate the OCR worker to free memory. */
  terminate() {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    this.pending.clear()
  }
}

export const ocrWorker = new OcrWorkerClient()
