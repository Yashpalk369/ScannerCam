import { expect, test } from '@playwright/test'

test('converts locally with transparency preserved for PNG and white for JPG', async ({ page }) => {
  const uploads: string[] = []
  page.on('request', request => { if (request.method() === 'POST') uploads.push(request.url()) })
  await page.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//, route => route.abort())
  await page.goto('/image-format-converter')
  const data = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 12
    const context = canvas.getContext('2d')!
    context.fillStyle = 'red'; context.fillRect(0, 0, 4, 4)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
  await page.getByLabel('Choose an image', { exact: true }).setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from(data) })
  for (const [format, expectedName, alpha] of [['png', 'test.png', 0], ['jpeg', 'test.jpg', 255], ['webp', 'test.webp', 0]] as const) {
    await page.getByLabel('Output format').selectOption(format)
    await page.getByRole('button', { name: 'Convert image', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Conversion complete')
    const pending = page.waitForEvent('download')
    await page.getByRole('link', { name: `Download ${format === 'jpeg' ? 'JPG' : format.toUpperCase()}` }).click()
    const download = await pending
    expect(download.suggestedFilename()).toBe(expectedName)
    const chunks: Buffer[] = []
    for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
    const output = Buffer.concat(chunks)
    const pixel = await page.evaluate(async ({ bytes, type }) => {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type }))
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0)
      return [...context.getImageData(10, 10, 1, 1).data]
    }, { bytes: Array.from(output), type: `image/${format}` })
    expect(pixel[3]).toBe(alpha)
    if (format === 'jpeg') expect(pixel.slice(0, 3).every(value => value >= 245)).toBe(true)
  }
  expect(uploads).toEqual([])
})

test('does not mislabel a PNG fallback as WebP', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      return original.call(this, callback, type === 'image/webp' ? 'image/png' : type, quality)
    }
  })
  await page.goto('/image-format-converter')
  await page.getByLabel('Choose an image', { exact: true }).setInputFiles('tests/fixtures/document.png')
  await page.getByLabel('Output format').selectOption('webp')
  await page.getByRole('button', { name: 'Convert image' }).click()
  await expect(page.getByRole('status')).toContainText('cannot export WEBP')
  await expect(page.getByRole('link', { name: 'Download WEBP' })).toHaveCount(0)
})
