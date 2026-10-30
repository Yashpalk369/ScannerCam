import { test, expect } from '@playwright/test'
import { jsPDF } from 'jspdf'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

function samplePdf(width: number, height: number) {
  const pdf = new jsPDF({ unit: 'pt', format: [width, height] })
  pdf.text('Synthetic test document', 20, 40)
  return Buffer.from(pdf.output('arraybuffer'))
}

test('failed replacement clears the old PDF and signature, and a new PDF can be signed', async ({ page }) => {
  await page.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, route => route.abort())
  await page.goto('/sign-pdf')
  const input = page.locator('input[type=file]').first()
  await input.setInputFiles({ name: 'document-a.pdf', mimeType: 'application/pdf', buffer: samplePdf(300, 500) })
  await expect(page.getByLabel('Type your signature')).toBeVisible()
  await page.getByLabel('Type your signature').fill('Test signer')
  await page.getByRole('button', { name: 'Use typed signature' }).click()
  await expect(page.getByRole('button', { name: 'Download signed PDF' })).toBeEnabled()

  await input.setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await expect(page.getByRole('status')).toContainText('Could not open PDF')
  await expect(page.getByRole('button', { name: 'Download signed PDF' })).toHaveCount(0)
  await expect(page.getByLabel('Preview of page 1')).toHaveCount(0)

  await input.setInputFiles({ name: 'document-c.pdf', mimeType: 'application/pdf', buffer: samplePdf(400, 600) })
  await expect(page.getByLabel('Type your signature')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Download signed PDF' })).toBeDisabled()
  await page.getByLabel('Type your signature').fill('New signer')
  await page.getByRole('button', { name: 'Use typed signature' }).click()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download signed PDF' }).click()
  const download = await pending
  expect(download.suggestedFilename()).toBe('document-c-signed.pdf')
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  const task = pdfjs.getDocument({ data: new Uint8Array(Buffer.concat(chunks)) })
  try {
    const pdf = await task.promise
    expect(pdf.numPages).toBe(1)
    const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 })
    expect([viewport.width, viewport.height]).toEqual([400, 600])
  } finally { await task.destroy() }
})
