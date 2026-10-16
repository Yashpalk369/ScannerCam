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
    timeout: ReturnType<typeof setTimeout>
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
        clearTimeout(handler.timeout)
        if (res.success) {
          handler.resolve(res)
        } else {
          handler.reject(new Error(res.error))
        }
      }
      this.worker.onerror = (err) => {
        console.error('OCR Worker error:', err)
        this.terminate(new Error('OCR worker failed. Retry or download a PDF with OCR turned off.'))
      }
      this.worker.onmessageerror = () => this.terminate(new Error('Could not read the OCR result. Please retry.'))
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
      const timeout = setTimeout(() => this.terminate(new Error('OCR timed out. Please retry with fewer pages or turn OCR off.')), 120000)
      this.pending.set(id, { resolve, reject, timeout })
      const req: OcrRequest = { id, type: 'OCR_PAGE', imageDataUrl, lang }
      try { worker.postMessage(req) }
      catch (error) { this.terminate(error instanceof Error ? error : new Error('Could not start OCR.')) }
    })
  }

  /** Terminate the OCR worker to free memory. */
  terminate(reason: Error = new DOMException('OCR cancelled.', 'AbortError')) {
    if (this.worker) {
      this.worker.terminate()
      this.worker = null
    }
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout)
      request.reject(reason)
    }
    this.pending.clear()
  }
}

export const ocrWorker = new OcrWorkerClient()
