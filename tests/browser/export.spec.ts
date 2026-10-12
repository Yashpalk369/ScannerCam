import { test, expect, type Page, type Download } from '@playwright/test'

// Keep feature checks independent of optional fonts and analytics access.
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, route => route.abort())
})

async function uploadScans(page: Page, count = 1, cards = false) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const scans = await page.evaluate(({ count, cards }) => Array.from({ length: count }, (_, index) => {
    const canvas = document.createElement('canvas')
    canvas.width = cards ? 1200 : 1800
    canvas.height = cards ? 760 : 2400
    const context = canvas.getContext('2d')!
    if (cards) {
      context.fillStyle = index === 0 ? '#c84040' : '#4040c8'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#fff'
      context.font = '80px sans-serif'
      context.fillText(index === 0 ? 'FRONT' : 'BACK', 80, 160)
    } else {
      const pixels = context.createImageData(canvas.width, canvas.height)
      let seed = 42
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const brightness = 150 + x / canvas.width * 65 + (seed % 15)
        const i = (y * canvas.width + x) * 4
        pixels.data.set([brightness, brightness, brightness, 255], i)
      }
      context.putImageData(pixels, 0, 0)
      context.fillStyle = '#222'
      context.font = '36px sans-serif'
      for (let y = 100; y < 2200; y += 70) context.fillText('Readable document · scan quality test', 100, y)
    }
    return canvas.toDataURL('image/png').split(',')[1]
  }), { count, cards })
  await page.locator('input[type=file]').first().setInputFiles(scans.map((data, index) => ({ name: `scan-${index + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })))
  await expect(page.getByRole('button', { name: `Export (${count})`, exact: true })).toBeEnabled({ timeout: 20000 })
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function sizeReady(page: Page) {
  const size = page.getByTestId('pdf-size')
  await expect(size).toHaveAttribute('data-bytes', /^[1-9]\d*$/)
  return Number(await size.getAttribute('data-bytes'))
}

async function scanFingerprint(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('scannercam_db')
      request.onsuccess = () => resolve(request.result)
    })
    try {
      const records = await new Promise<any[]>(resolve => {
        const request = database.transaction('scanned_pages').objectStore('scanned_pages').getAll()
        request.onsuccess = () => resolve(request.result)
      })
      return await Promise.all(records.map(async record => ({ id: record.id, filter: record.filter, quad: record.quad, image: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await record.blob.arrayBuffer()))) })))
    } finally { database.close() }
  })
}

test('PDF quality changes the actual size, and its preview matches the download', async ({ page }) => {
  await uploadScans(page)
  const before = await scanFingerprint(page)
  await page.getByRole('button', { name: 'Export (1)', exact: true }).click()
  const balanced = await sizeReady(page)
  await page.getByLabel('PDF Quality', { exact: true }).selectOption('high')
  const high = await sizeReady(page)
  await page.getByLabel('PDF Quality', { exact: true }).selectOption('small')
  const small = await sizeReady(page)
  expect(small).toBeLessThan(balanced)
  expect(balanced).toBeLessThan(high)
  await page.getByLabel('File Name', { exact: true }).fill('compressed-scan')
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Multi-Page PDF', exact: true }).click()
  const download = await downloading
  const pdf = await downloadBytes(download)
  expect(download.suggestedFilename()).toBe('compressed-scan.pdf')
  expect(pdf.length).toBe(small)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(await scanFingerprint(page)).toEqual(before)
})

test('ID card mode selects distinct sides and exports both onto one portrait sheet', async ({ page }) => {
  await uploadScans(page, 2, true)
  await page.getByRole('button', { name: 'Export (2)', exact: true }).click()
  await page.getByLabel('PDF Layout', { exact: true }).selectOption('id-card')
  await expect(page.getByAltText('Front side preview')).toBeVisible()
  await expect(page.getByAltText('Back side preview')).toBeVisible()
  const front = await page.getByLabel('Front side', { exact: true }).inputValue()
  const back = await page.getByLabel('Back side', { exact: true }).inputValue()
  await page.getByLabel('Back side', { exact: true }).selectOption(front)
  await expect(page.getByRole('alert')).toContainText('Choose different scans')
  await expect(page.getByRole('button', { name: 'Download ID Card PDF', exact: true })).toBeDisabled()
  await page.getByLabel('Back side', { exact: true }).selectOption(back)
  const oldBackPreview = await page.getByAltText('Back side preview').getAttribute('src')
  const oldFrontPreview = await page.getByAltText('Front side preview').getAttribute('src')
  await page.getByLabel('Front side', { exact: true }).selectOption(back)
  await page.getByLabel('Back side', { exact: true }).selectOption(front)
  await expect(page.getByAltText('Front side preview')).toHaveAttribute('src', oldBackPreview!)
  await expect(page.getByAltText('Back side preview')).toHaveAttribute('src', oldFrontPreview!)
  await page.getByLabel('Paper Size', { exact: true }).selectOption('letter')
  const size = await sizeReady(page)
  await page.screenshot({ path: 'test-results/id-card-export.png' })
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ID Card PDF', exact: true }).click()
  const pdf = await downloadBytes(await downloading)
  const source = pdf.toString('latin1')
  expect(pdf.length).toBe(size)
  expect(source.match(/\/Type \/Page\b/g)).toHaveLength(1)
  expect(source.match(/\/Subtype \/Image\b/g)).toHaveLength(2)
  expect(source).toMatch(/\/MediaBox \[0 0 612[.0]* 792[.0]*\]/)
  const jpegImages: string[] = []
  let cursor = 0
  while ((cursor = source.indexOf('/Subtype /Image', cursor)) !== -1) {
    const streamMarker = source.indexOf('stream\n', cursor)
    const header = source.slice(cursor, streamMarker)
    const length = Number(header.match(/\/Length (\d+)/)![1])
    const start = streamMarker + 'stream\n'.length
    jpegImages.push(pdf.subarray(start, start + length).toString('base64'))
    cursor = start + length
  }
  const colors = await page.evaluate(async images => Promise.all(images.map(async data => {
    const binary = Uint8Array.from(atob(data), character => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([binary], { type: 'image/jpeg' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return Array.from(context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data)
  })), jpegImages)
  // We swapped the scans: blue must be Front, red must be Back in the actual file.
  expect(colors[0][2]).toBeGreaterThan(colors[0][0] + 80)
  expect(colors[1][0]).toBeGreaterThan(colors[1][2] + 80)
})

test('ID mode can export only a front side, and document mode still exports two pages', async ({ page }) => {
  await uploadScans(page, 2, true)
  await page.getByRole('button', { name: 'Export (2)', exact: true }).click()
  await page.getByLabel('PDF Layout', { exact: true }).selectOption('id-card')
  await page.getByLabel('Back side', { exact: true }).selectOption('')
  await expect(page.getByAltText('Back side preview')).toHaveCount(0)
  await sizeReady(page)
  let downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ID Card PDF', exact: true }).click()
  const frontOnly = (await downloadBytes(await downloading)).toString('latin1')
  expect(frontOnly.match(/\/Type \/Page\b/g)).toHaveLength(1)
  expect(frontOnly.match(/\/Subtype \/Image\b/g)).toHaveLength(1)
  await page.getByRole('button', { name: 'Export (2)', exact: true }).click()
  await sizeReady(page)
  downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Multi-Page PDF', exact: true }).click()
  const document = (await downloadBytes(await downloading)).toString('latin1')
  expect(document.match(/\/Type \/Page\b/g)).toHaveLength(2)
})

test('before/after compares unenhanced pixels on the same crop without modifying scans', async ({ page }) => {
  await uploadScans(page)
  const before = await scanFingerprint(page)
  await page.getByRole('button', { name: 'Before / After', exact: true }).click()
  const slider = page.getByRole('slider', { name: 'Before and after comparison', exact: true })
  await expect(slider).toBeVisible()
  const setPosition = async (position: number) => {
    await slider.fill(String(position))
    await page.waitForFunction(position => {
      const slider = document.querySelector<HTMLInputElement>('#comparison-slider')
      return slider?.value === String(position)
    }, position)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    return page.locator('canvas[aria-label="Before and after document comparison"]').evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d')!
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let sum = 0, count = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] === 255) { sum += pixels[i]; count++ }
      return { brightness: sum / count, width: canvas.width, height: canvas.height }
    })
  }
  const unenhanced = await setPosition(100)
  const enhanced = await setPosition(0)
  expect(enhanced.width).toBe(unenhanced.width)
  expect(enhanced.height).toBe(unenhanced.height)
  expect(enhanced.brightness).toBeGreaterThan(unenhanced.brightness + 10)
  expect(await scanFingerprint(page)).toEqual(before)
  await slider.fill('50')
  await page.screenshot({ path: 'test-results/before-after-comparison.png' })
  await page.getByRole('button', { name: 'Edit Corners', exact: true }).click()
  await expect(slider).toHaveCount(0)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Before / After', exact: true })).toHaveAttribute('aria-pressed', 'false')
})
