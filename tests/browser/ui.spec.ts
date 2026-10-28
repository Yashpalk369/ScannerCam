import { test, expect, type Page } from '@playwright/test'

test.use({ hasTouch: true })

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, route => route.abort())
})

async function fixture(page: Page, count = 2, useStartingButton = false) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const payload = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 1100
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'
    context.fillRect(0, 0, 800, 1100)
    context.fillStyle = '#333'
    context.font = '32px sans-serif'
    for (let y = 100; y < 1000; y += 60) context.fillText('Sample document for UI testing', 70, y)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  const files = Array.from({ length: count }, (_, index) => ({ name: `page-${index}.png`, mimeType: 'image/png', buffer: Buffer.from(payload, 'base64') }))
  if (useStartingButton) {
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Upload Files', exact: true }).click()
    await (await chooserPromise).setFiles(files)
  } else await page.locator('input[type=file]').first().setInputFiles(files)
  await expect(page.getByRole('button', { name: `Export (${count})`, exact: true })).toBeEnabled()
}

async function savedPages(page: Page) {
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
      return Promise.all(records.map(async record => ({ id: record.id, quad: record.quad, blob: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await record.blob.arrayBuffer()))) })))
    } finally { database.close() }
  })
}

test('starting screen offers real scan and upload actions without disabled editing clutter', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError') }, configurable: true })
  })
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Scan Document', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload Files', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Magic Color', exact: true })).toHaveCount(0)
  await expect(page.locator('.scanner-toolbar')).toBeHidden()
  await expect(page.locator('.site-header').getByRole('link', { name: 'Open Scanner', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Scan Camera', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Scan Document', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Scan documents with camera' })).toBeVisible()
  await page.getByRole('button', { name: 'Close camera', exact: true }).click()
  await fixture(page, 2, true)
  await expect(page.locator('.scanner-toolbar')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Scan Camera', exact: true })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Scan Document', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Upload Files', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Magic Color', exact: true })).toBeEnabled()
})

test('multiple pages stay within mobile and desktop widths with large touch targets', async ({ page }) => {
  await fixture(page)
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const controls = await page.locator('.thumbnail-actions button').evaluateAll(buttons => buttons.map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })))
    for (const control of controls) { expect(control.width).toBeGreaterThanOrEqual(44); expect(control.height).toBeGreaterThanOrEqual(44) }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/mobile-ui-editor.png' })
})

test('keyboard page selection and visible history controls recover deleted pages', async ({ page }) => {
  await fixture(page)
  const first = page.getByRole('button', { name: 'Select page 1: Page 1', exact: true })
  await first.focus()
  await first.press('Enter')
  await expect(first).toHaveAttribute('aria-current', 'page')
  await first.press('ArrowRight')
  const second = page.getByRole('button', { name: 'Select page 2: Page 2', exact: true })
  await expect(second).toBeFocused()
  await expect(second).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'Remove page 2', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export (2)', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Remove page 1', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Scan Document', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
})

test('zoom, mouse pan, keyboard pan and Fit leave stored scans unchanged', async ({ page }) => {
  await fixture(page)
  const before = await savedPages(page)
  const zoom = page.getByTestId('viewer-transform')
  await page.getByRole('button', { name: 'Actual size', exact: true }).click()
  await expect.poll(async () => Number(await zoom.getAttribute('data-zoom'))).toBeGreaterThan(1)
  await expect(zoom).toHaveText('100%')
  const canvas = page.locator('canvas[aria-label="Scanned document preview"]')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 45, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => Number(await zoom.getAttribute('data-pan-x'))).toBeGreaterThan(10)
  await canvas.focus()
  await canvas.press('ArrowRight')
  await expect(page.getByRole('button', { name: 'Select page 2: Page 2', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'Before / After', exact: true }).click()
  await expect(page.getByRole('slider', { name: 'Before and after comparison', exact: true })).toBeVisible()
  await expect(zoom).toHaveText('100%')
  await page.getByRole('button', { name: 'Fit document', exact: true }).click()
  await expect(zoom).toHaveAttribute('data-zoom', '1')
  await expect(zoom).toHaveAttribute('data-pan-x', '0')
  await expect(zoom).toHaveAttribute('data-pan-y', '0')
  expect(await savedPages(page)).toEqual(before)
})

test('two-finger pinch zoom works and changing pages resets the view', async ({ page }) => {
  await fixture(page)
  const canvas = page.locator('canvas[aria-label="Scanned document preview"]')
  const box = (await canvas.boundingBox())!
  const center = { x: box.x + box.width / 2, y: box.y + 210 }
  const client = await page.context().newCDPSession(page)
  const touches = (gap: number) => [{ x: center.x - gap, y: center.y, id: 1 }, { x: center.x + gap, y: center.y, id: 2 }]
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(40) })
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(95) })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => Number(await page.getByTestId('viewer-transform').getAttribute('data-zoom'))).toBeGreaterThan(1.5)
  await page.getByRole('button', { name: 'Select page 1: Page 1', exact: true }).click()
  await expect(page.getByTestId('viewer-transform')).toHaveAttribute('data-zoom', '1')
})

test('crop handles map to the right raw coordinates when zoomed and panned', async ({ page }) => {
  await fixture(page, 1)
  const original = (await savedPages(page))[0]
  await page.getByRole('button', { name: 'Edit Corners', exact: true }).click()
  await page.getByRole('button', { name: 'Actual size', exact: true }).click()
  await expect(page.getByTestId('viewer-transform')).toHaveText('100%')
  const canvas = page.locator('canvas[aria-label="Document crop editor"]')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(-5000, -5000)
  await expect.poll(async () => Number(await page.getByTestId('viewer-transform').getAttribute('data-pan-y'))).toBeGreaterThan(100)
  const corner = { x: box.x + 20 + original.quad[0].x, y: box.y + 112 + original.quad[0].y }
  await page.mouse.move(corner.x, corner.y)
  await page.mouse.down()
  await page.mouse.move(corner.x + 20, corner.y + 30, { steps: 4 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Apply Perspective', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  const after = (await savedPages(page))[0]
  expect(after.quad[0].x).toBeCloseTo(original.quad[0].x + 20, 0)
  expect(after.quad[0].y).toBeCloseTo(original.quad[0].y + 30, 0)
})

test('export emphasizes PDF download and keeps advanced options accessible', async ({ page }) => {
  await fixture(page, 1)
  await page.getByRole('button', { name: 'Export (1)', exact: true }).click()
  const advanced = page.getByRole('button', { name: 'Advanced options', exact: true })
  await expect(advanced).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByLabel('Paper Size', { exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Download Current JPG', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Download Multi-Page PDF', exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/mobile-ui-export.png' })
  await advanced.click()
  await expect(page.getByLabel('Paper Size', { exact: true })).toBeVisible()
  await page.getByLabel('Paper Size', { exact: true }).selectOption('letter')
  await expect(page.getByRole('button', { name: 'Download Current JPG', exact: true })).toBeVisible()
  await advanced.click()
  const download = page.getByRole('button', { name: 'Download Multi-Page PDF', exact: true })
  await expect(download).toBeEnabled()
  await download.focus()
  await download.press('Tab')
  await expect(page.getByRole('button', { name: 'Close export', exact: true })).toBeFocused()
})
