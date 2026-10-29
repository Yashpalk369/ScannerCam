import { test, expect } from '@playwright/test'
import { jsPDF } from 'jspdf'
import { unzipSync } from 'fflate'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

function fixturePdf() {
  const pdf = new jsPDF({ unit: 'pt', format: [400, 600] })
  pdf.text('First page', 20, 40)
  pdf.addPage([600, 400], 'landscape')
  pdf.text('Second page', 20, 40)
  pdf.addPage([500, 700], 'portrait')
  pdf.text('Third page', 20, 40)
  return Buffer.from(pdf.output('arraybuffer'))
}

async function dimensions(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
  try {
    const doc = await task.promise
    const pages = []
    for (let i = 1; i <= doc.numPages; i++) {
      const viewport = (await doc.getPage(i)).getViewport({ scale: 1 })
      pages.push([viewport.width, viewport.height])
    }
    return pages
  } finally { await task.destroy() }
}

test('extracts selected pages as a PDF or separate one-page PDFs in a ZIP', async ({ page }) => {
  await page.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, route => route.abort())
  await page.goto('/extract-pdf-pages')
  await page.locator('input[type=file]').setInputFiles({ name: 'sample.pdf', mimeType: 'application/pdf', buffer: fixturePdf() })
  await expect(page.getByLabel('Pages to keep')).toHaveValue('1-3')
  await page.getByLabel('Pages to keep').fill('2, 1')
  let downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Extract and download PDF' }).click()
  let download = await downloading
  expect(download.suggestedFilename()).toBe('sample-extracted.pdf')
  let chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  expect(await dimensions(Buffer.concat(chunks))).toEqual([[600, 400], [400, 600]])

  await page.getByLabel('Output').selectOption('separate')
  downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Split and download ZIP' }).click()
  download = await downloading
  expect(download.suggestedFilename()).toBe('sample-split-pages.zip')
  chunks = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)))
  expect(Object.keys(entries)).toEqual(['page-002.pdf', 'page-001.pdf'])
  expect(await dimensions(entries['page-002.pdf'])).toEqual([[600, 400]])
  expect(await dimensions(entries['page-001.pdf'])).toEqual([[400, 600]])

  await page.getByLabel('Pages to keep').fill('2-9')
  await page.getByRole('button', { name: 'Split and download ZIP' }).click()
  await expect(page.getByRole('status')).toContainText('valid pages between 1 and 3')
})
