export interface OcrWord { text: string; x0: number; y0: number; x1: number; y1: number }

/** Parse the recognized word bounds without inserting OCR markup into the page. */
export function parseHocrWords(hocr: string, width: number, height: number): OcrWord[] {
  if (!hocr) return []
  const document = new DOMParser().parseFromString(hocr, 'text/html')
  return [...document.querySelectorAll('.ocrx_word, .ocr_word')].flatMap(element => {
    const text = element.textContent?.trim() ?? ''
    const match = element.getAttribute('title')?.match(/(?:^|;)\s*bbox\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/)
    if (!text || !match) return []
    const [x0, y0, x1, y1] = match.slice(1).map(Number)
    if (x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0 || x1 > width || y1 > height) return []
    return [{ text, x0, y0, x1, y1 }]
  })
}
