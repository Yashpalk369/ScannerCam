/** Parse a list of page numbers and inclusive ranges, preserving the specified order. */
export function parsePageRange(input: string, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) throw new Error('The PDF has no pages.')
  const text = input.trim()
  if (!text) throw new Error('Enter page numbers, for example 1-3, 5.')
  const result: number[] = []
  const seen = new Set<number>()
  for (const part of text.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!match) throw new Error('Use page numbers and ranges separated by commas, for example 1-3, 5.')
    const start = Number(match[1]), end = Number(match[2] ?? match[1])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end > pageCount || end < start)
      throw new Error(`Choose valid pages between 1 and ${pageCount}.`)
    for (let page = start; page <= end; page++) {
      if (!seen.has(page)) { seen.add(page); result.push(page) }
    }
  }
  return result
}
