import { test, expect } from '@playwright/test'
import { jsPDF } from 'jspdf'
import { unzipSync } from 'fflate'

function pdfFixture(pageCount = 3) {
  const doc = new jsPDF({ unit: 'pt', format: [200, 300] })
  for (let i = 0; i < pageCount; i++) {
    if (i) doc.addPage([200, 300])
    doc.setFillColor(i === 0 ? 255 : 0, i === 1 ? 255 : 0, i === 2 ? 255 : 0)
    doc.rect(0, 0, 200, 300, 'F')
  }
  return Buffer.from(doc.output('arraybuffer'))
}
async function bytes(download: Awaited<ReturnType<import('@playwright/test').Page['waitForEvent']>>) {
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

test('downloads one page or selected pages in a ZIP without uploading the PDF', async ({ page }) => {
  const unexpectedUploads: string[] = []
  page.on('request', request => { if (request.method() === 'POST') unexpectedUploads.push(request.url()) })
  await page.goto('/pdf-to-jpg')
  await page.locator('input[type=file]').setInputFiles({ name: 'colours.pdf', mimeType: 'application/pdf', buffer: pdfFixture() })
  const single = page.getByRole('button', { name: 'Download page', exact: true })
  await expect(single).toBeEnabled()
  let pending = page.waitForEvent('download')
  await single.click()
  let download = await pending
  expect(download.suggestedFilename()).toBe('colours-page-1.jpg')
  expect([...(await bytes(download)).subarray(0, 2)]).toEqual([255, 216])
  await page.getByLabel('Format').selectOption('png')
  await page.getByLabel('Pages for ZIP').fill('2, 1')
  pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download pages as ZIP' }).click()
  download = await pending
  expect(download.suggestedFilename()).toBe('colours-images.zip')
  const files = unzipSync(new Uint8Array(await bytes(download)))
  expect(Object.keys(files)).toEqual(['page-002.png', 'page-001.png'])
  for (const [name, expected] of [['page-002.png', [0, 255, 0]], ['page-001.png', [255, 0, 0]]] as const) {
    const pixel = await page.evaluate(async (input: number[]) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(input)], { type: 'image/png' }))
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0)
      return [...ctx.getImageData(10, 10, 1, 1).data].slice(0, 3)
    }, Array.from(files[name]))
    expect(pixel).toEqual(expected)
  }
  await page.getByLabel('Pages for ZIP').fill('1-4')
  await page.getByRole('button', { name: 'Download pages as ZIP' }).click()
  await expect(page.getByRole('status')).toContainText('valid pages between 1 and 3')
  expect(unexpectedUploads).toEqual([])
})

test('limits batch size to 25 pages', async ({ page }) => {
  await page.goto('/pdf-to-jpg')
  await page.locator('input[type=file]').setInputFiles({ name: 'many.pdf', mimeType: 'application/pdf', buffer: pdfFixture(26) })
  await expect(page.getByRole('button', { name: 'Download pages as ZIP' })).toBeEnabled()
  await page.getByLabel('Pages for ZIP').fill('1-26')
  await page.getByRole('button', { name: 'Download pages as ZIP' }).click()
  await expect(page.getByRole('status')).toContainText('at most 25 pages')
})
