import { test, expect } from '@playwright/test'

test('resizes images locally, preserves proportions and handles transparency', async ({ page }) => {
  const uploads: string[] = []
  page.on('request', request => { if (request.method() === 'POST') uploads.push(request.url()) })
  await page.goto('/resize-image-pixels')
  const inputBytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 20
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 10, 10)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
  await page.getByLabel('Choose image', { exact: true }).setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(inputBytes) })
  await expect(page.getByText('Original: 40 × 20 pixels')).toBeVisible()
  await page.getByLabel('Width (pixels)').fill('20')
  await expect(page.getByLabel('Height (pixels)')).toHaveValue('10')
  await page.getByRole('button', { name: 'Resize image', exact: true }).click()
  await expect(page.getByAltText('Resized image preview')).toBeVisible()
  const pendingPng = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download image' }).click()
  const png = await pendingPng
  expect(png.suggestedFilename()).toBe('fixture-resized.png')
  const chunks: Buffer[] = []
  for await (const chunk of (await png.createReadStream())!) chunks.push(Buffer.from(chunk))
  const pngBytes = Buffer.concat(chunks)
  const pngInfo = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0)
    return { width: bitmap.width, height: bitmap.height, alpha: ctx.getImageData(19, 9, 1, 1).data[3] }
  }, Array.from(pngBytes))
  expect(pngInfo).toEqual({ width: 20, height: 10, alpha: 0 })
  await page.getByLabel('Output format').selectOption('jpeg')
  await page.getByRole('button', { name: 'Resize image', exact: true }).click()
  await expect(page.getByAltText('Resized image preview')).toBeVisible()
  const jpegPixel = await page.getByAltText('Resized image preview').evaluate(image => {
    const img = image as HTMLImageElement, canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0)
    return [...ctx.getImageData(19, 9, 1, 1).data]
  })
  expect(jpegPixel[0]).toBeGreaterThan(245); expect(jpegPixel[1]).toBeGreaterThan(245); expect(jpegPixel[2]).toBeGreaterThan(245); expect(jpegPixel[3]).toBe(255)
  await page.getByLabel('Lock aspect ratio').uncheck()
  await page.getByLabel('Width (pixels)').fill('100')
  await page.getByLabel('Height (pixels)').fill('70')
  await page.getByLabel('Lock aspect ratio').check()
  await expect(page.getByLabel('Height (pixels)')).toHaveValue('50')
  await page.getByLabel('Lock aspect ratio').uncheck()
  await page.getByLabel('Width (pixels)').fill('10000')
  await page.getByLabel('Height (pixels)').fill('10000')
  await page.getByRole('button', { name: 'Resize image', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('at most 20 megapixels')
  expect(uploads).toEqual([])
})
