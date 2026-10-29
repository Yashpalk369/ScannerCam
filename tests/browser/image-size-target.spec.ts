import { test, expect } from '@playwright/test'

async function noisyPng(page: import('@playwright/test').Page) {
  const data = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 600; canvas.height = 600
    const ctx = canvas.getContext('2d')!
    const image = ctx.createImageData(canvas.width, canvas.height)
    let seed = 123456789
    for (let i = 0; i < image.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      image.data[i] = seed & 255
      image.data[i + 1] = (seed >>> 8) & 255
      image.data[i + 2] = (seed >>> 16) & 255
      image.data[i + 3] = 255
    }
    ctx.putImageData(image, 0, 0)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  })
  return Buffer.from(data)
}

test('download respects the displayed decimal KB limit', async ({ page }) => {
  await page.goto('/resize-image-to-kb')
  await page.getByLabel('Choose an image', { exact: true }).setInputFiles({name:'fixture.png', mimeType:'image/png', buffer:await noisyPng(page)})
  await expect(page.getByLabel('Maximum size (KB, 1 KB = 1,000 bytes)')).toBeVisible()
  await page.getByRole('button', { name:'50 KB', exact:true }).click()
  await page.getByRole('button', { name:'Resize image', exact:true }).click()
  await expect(page.getByRole('status')).toContainText('Your JPG is ready', {timeout:20000})
  const pending = page.waitForEvent('download')
  await page.getByRole('link', {name:'Download JPG'}).click()
  const download = await pending
  const chunks: Buffer[] = []
  for await (const chunk of (await download.createReadStream())!) chunks.push(Buffer.from(chunk))
  const image = Buffer.concat(chunks)
  expect(image.length).toBeLessThanOrEqual(50_000)
  expect([...image.subarray(0,2)]).toEqual([0xff,0xd8])
  await expect(page.locator('p').filter({hasText:'Output:'})).toContainText(`${image.length.toLocaleString()} bytes`)
})

test('reports a target that the browser encoder cannot achieve', async ({ page }) => {
  // Simulate an encoder with a minimum output size: the UI must not claim success.
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      callback(new Blob([new Uint8Array(6000)], {type:'image/jpeg'}))
    }
  })
  await page.goto('/resize-image-to-kb')
  await page.getByLabel('Choose an image', {exact:true}).setInputFiles('tests/fixtures/document.png')
  await page.getByLabel('Maximum size (KB, 1 KB = 1,000 bytes)').fill('5')
  await page.getByRole('button', {name:'Resize image',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('target could not be reached')
  await expect(page.locator('p').filter({hasText:'Smallest output:'})).toContainText('6,000 bytes')
})
