import { test, expect, type Page } from '@playwright/test'

async function cameraFixture(page: Page, options: { denied?: boolean; delayed?: boolean } = {}) {
  await page.addInitScript(settings => {
    const state = {
      denied: Boolean(settings.denied), delayed: Boolean(settings.delayed),
      tracks: [] as MediaStreamTrack[], pending: [] as (() => void)[], shift: 0, blank: false,
      requests: [] as MediaStreamConstraints[],
    }
    ;(window as any).__camera = state
    // Exercise real video playback using a deterministic document stream.
    Object.defineProperty(window, 'ImageCapture', { value: undefined, configurable: true })
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async (constraints: MediaStreamConstraints) => {
      state.requests.push(constraints)
      if (state.denied) throw new DOMException('Denied', 'NotAllowedError')
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 480
      const context = canvas.getContext('2d')!
      const draw = () => {
        context.fillStyle = '#333'
        context.fillRect(0, 0, 640, 480)
        if (!state.blank) {
          context.fillStyle = '#eee'
          context.fillRect(160 + state.shift, 55, 300, 370)
          context.fillStyle = '#222'
          for (let y = 100; y < 380; y += 25) context.fillRect(195 + state.shift, y, 210, 4)
        }
      }
      draw()
      const stream = canvas.captureStream(15)
      const track = stream.getVideoTracks()[0]
      const timer = setInterval(() => { if (track.readyState === 'ended') clearInterval(timer); else draw() }, 60)
      state.tracks.push(track)
      if (state.delayed) await new Promise<void>(resolve => state.pending.push(resolve))
      return stream
    }, configurable: true })
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [
      { kind: 'videoinput', deviceId: 'back', label: 'Back camera' },
      { kind: 'videoinput', deviceId: 'front', label: 'Front camera' },
    ], configurable: true })
  }, options)
  await page.goto('/')
  await page.getByRole('button', { name: 'Scan Document', exact: true }).click()
}

async function manualMode(page: Page) {
  const toggle = page.getByRole('button', { name: 'Auto-capture', exact: true })
  if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click()
  await expect(page.getByRole('button', { name: 'Capture photo', exact: true })).toBeEnabled()
}

async function stoppedTracks(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).__camera.tracks.every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true)
}

test('mobile capture can be retaken, kept, restored and exported without signup', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await cameraFixture(page)
  await manualMode(page)
  await page.getByRole('button', { name: 'Capture photo', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Review captured photo' })).toBeVisible()
  await expect(page.getByAltText('Captured document before cropping')).toBeVisible()
  await page.screenshot({ path: 'test-results/mobile-capture-review.png' })
  await page.getByRole('button', { name: 'Retake', exact: true }).click()
  await page.getByRole('button', { name: 'Capture photo', exact: true }).click()
  await page.getByRole('button', { name: 'Keep & finish', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  await stoppedTracks(page)
  await page.reload()
  await page.getByRole('button', { name: 'Export (1)', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Multi-Page PDF', exact: true }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe('%PDF-')
  expect(errors).toEqual([])
})

test('auto-capture cancels lost edges, then reviews once and waits for the next page', async ({ page }) => {
  await cameraFixture(page)
  await expect(page.locator('.auto-capture-countdown')).toBeVisible()
  await page.evaluate(() => { (window as any).__camera.blank = true })
  await expect(page.locator('.auto-capture-countdown')).toHaveCount(0)
  await page.waitForTimeout(2200)
  await expect(page.getByRole('dialog', { name: 'Review captured photo' })).toHaveCount(0)
  await page.evaluate(() => { (window as any).__camera.blank = false })
  await expect(page.getByRole('dialog', { name: 'Review captured photo' })).toBeVisible()
  await page.getByRole('button', { name: 'Keep & scan next', exact: true }).click()
  await expect(page.getByText('1 page kept', { exact: true })).toBeVisible()
  await expect(page.getByText('Move to the next page, or tap Capture photo.', { exact: true })).toBeVisible()
  await page.waitForTimeout(3200)
  await expect(page.getByRole('dialog', { name: 'Review captured photo' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await stoppedTracks(page)
})

test('moving the page or disabling AUTO cancels the countdown', async ({ page }) => {
  await cameraFixture(page)
  await expect(page.locator('.auto-capture-countdown')).toBeVisible()
  await page.evaluate(() => { (window as any).__camera.shift = 40 })
  await expect(page.locator('.auto-capture-countdown')).toHaveCount(0)
  await page.getByRole('button', { name: 'Auto-capture', exact: true }).click()
  await page.waitForTimeout(2500)
  await expect(page.getByRole('dialog', { name: 'Review captured photo' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close camera', exact: true }).click()
  await stoppedTracks(page)
})

test('permission errors can be retried and camera switching stops the old stream', async ({ page }) => {
  await cameraFixture(page, { denied: true })
  await expect(page.getByRole('alert')).toContainText('Camera permission was denied')
  await page.evaluate(() => { (window as any).__camera.denied = false })
  await page.getByRole('button', { name: 'Retry camera', exact: true }).click()
  await manualMode(page)
  await page.getByRole('button', { name: 'Switch camera', exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__camera.tracks.length)).toBeGreaterThan(1)
  await expect.poll(() => page.evaluate(() => (window as any).__camera.tracks.slice(0, -1).every((track: MediaStreamTrack) => track.readyState === 'ended'))).toBe(true)
  await page.getByRole('button', { name: 'Close camera', exact: true }).click()
  await stoppedTracks(page)
})

test('closing during a pending permission request stops streams that arrive later', async ({ page }) => {
  await cameraFixture(page, { delayed: true })
  await expect.poll(() => page.evaluate(() => (window as any).__camera.pending.length)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Close camera', exact: true }).click()
  await page.evaluate(() => { (window as any).__camera.pending.forEach((resolve: () => void) => resolve()) })
  await stoppedTracks(page)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('hiding the tab releases the camera and offers an explicit restart', async ({ page }) => {
  await cameraFixture(page)
  await manualMode(page)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(page.getByRole('alert')).toContainText('Camera paused')
  await stoppedTracks(page)
  await expect(page.getByRole('button', { name: 'Capture photo', exact: true })).toBeDisabled()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.getByRole('button', { name: 'Retry camera', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Capture photo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Close camera', exact: true }).click()
  await stoppedTracks(page)
})

test('a failed save retains the captured photo for retry without adding a page', async ({ page }) => {
  await cameraFixture(page)
  await manualMode(page)
  await page.getByRole('button', { name: 'Capture photo', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Review captured photo' })).toBeVisible()
  await page.evaluate(() => {
    const original = Worker.prototype.postMessage
    ;(window as any).__camera.originalPostMessage = original
    Worker.prototype.postMessage = function (message, options) {
      if (message.type === 'WARP_AND_FILTER') throw new Error('Simulated image processing failure')
      return original.call(this, message, options as any)
    }
  })
  await page.getByRole('button', { name: 'Keep & scan next', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Your photo is still here')
  await expect(page.getByAltText('Captured document before cropping')).toBeVisible()
  await expect(page.getByText('1 page kept', { exact: true })).toHaveCount(0)
  await page.evaluate(() => {
    Worker.prototype.postMessage = (window as any).__camera.originalPostMessage
  })
  await page.getByRole('button', { name: 'Keep & finish', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  await stoppedTracks(page)
})

test('large photo cropping uses the resized image coordinates', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { cvWorker } = await import('/src/core/workers/workerClient.ts')
    const canvas = document.createElement('canvas')
    canvas.width = 4800
    canvas.height = 2400
    const context = canvas.getContext('2d')!
    context.fillStyle = '#222'
    context.fillRect(0, 0, 4800, 2400)
    context.fillStyle = '#fafafa'
    context.fillRect(3000, 500, 1500, 1400)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'))
    const output = await cvWorker.warpAndFilter(blob, [{ x: 3000, y: 500 }, { x: 4499, y: 500 }, { x: 4499, y: 1899 }, { x: 3000, y: 1899 }], 'original')
    const img = await cvWorker.blobToImage(output.blob)
    canvas.width = output.width
    canvas.height = output.height
    context.drawImage(img, 0, 0)
    // The old bug sampled beyond the resized buffer and replaced the crop with white.
    return { width: output.width, height: output.height, pixel: Array.from(context.getImageData(output.width / 2, output.height / 2, 1, 1).data) }
  })
  expect(result.width).toBeGreaterThan(1100)
  expect(result.width).toBeLessThan(1300)
  expect(result.height).toBeGreaterThan(1000)
  expect(result.pixel[0]).toBeGreaterThan(240)
  expect(result.pixel[0]).toBeLessThan(254)
})
