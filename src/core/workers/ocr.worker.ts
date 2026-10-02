/**
 * OCR Worker — Tesseract.js based text recognition running off the main thread.
 *
 * This worker is loaded on-demand only when the user requests a searchable PDF,
 * so it does not add to the initial bundle size.
 *
 * Communication protocol:
 *   Request:  { id, type: 'OCR_PAGE', imageDataUrl: string, lang: string }
 *   Response: { id, success: true, text: string, hocr: string }
 *           | { id, success: false, error: string }
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


const workerScope = self as unknown as {
  postMessage: (msg: unknown) => void
  onmessage: ((event: MessageEvent<OcrRequest>) => void) | null
  importScripts?: (...urls: string[]) => void
}

// Lazy Tesseract instance — created once and reused for subsequent pages
let tesseractWorkerPromise: Promise<{
  recognize: (img: string, opts?: unknown) => Promise<{ data: { text: string; hocr: string } }>
  terminate: () => Promise<void>
}> | null = null

async function getTesseract(lang: string) {
  // Dynamically import Tesseract from CDN (avoids bundling in main chunk)
  const { createWorker } = await import('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js' as string) as {
    createWorker: (lang: string, oem?: number, opts?: unknown) => Promise<unknown>
  }

  const worker = await createWorker(lang, 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5/tesseract-core.wasm.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    cacheMethod: 'refresh',
  }) as {
    recognize: (img: string, opts?: unknown) => Promise<{ data: { text: string; hocr: string } }>
    terminate: () => Promise<void>
  }

  return worker
}

workerScope.onmessage = async (event: MessageEvent<OcrRequest>) => {
  const req = event.data

  if (req.type !== 'OCR_PAGE') return

  try {
    if (!tesseractWorkerPromise) {
      tesseractWorkerPromise = getTesseract(req.lang)
    }

    const tWorker = await tesseractWorkerPromise
    const result = await tWorker.recognize(req.imageDataUrl, { rotateAuto: false })

    const response: OcrSuccessResponse = {
      id: req.id,
      success: true,
      text: result.data.text,
      hocr: result.data.hocr,
    }

    workerScope.postMessage(response)
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const response: OcrErrorResponse = {
      id: req.id,
      success: false,
      error: errorMsg,
    }
    workerScope.postMessage(response)
  }
}
