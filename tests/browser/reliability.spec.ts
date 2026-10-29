import { test, expect, type Page } from '@playwright/test'
import { inflateSync } from 'node:zlib'

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, route => route.abort())
})

async function image(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  return Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 800; canvas.height = 1100
    const context = canvas.getContext('2d')!
    context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 1100)
    context.fillStyle = '#222'; context.font = '44px sans-serif'
    context.fillText('SCANNER TEST DOCUMENT', 60, 150)
    return canvas.toDataURL('image/png').split(',')[1]
  }), 'base64')
}

async function upload(page: Page, count = 1) {
  const buffer = await image(page)
  await page.locator('input[type=file]').first().setInputFiles(Array.from({ length: count }, (_, i) => ({ name: `${i}.png`, mimeType: 'image/png', buffer })))
  await expect(page.getByRole('button', { name: `Export (${count})`, exact: true })).toBeEnabled()
}

async function record(page: Page) {
  return page.evaluate(async () => {
    const { scanDb } = await import('/src/core/storage/scanDb.ts')
    const [scan] = await scanDb.loadAllPages()
    if (!scan) return null
    URL.revokeObjectURL(scan.previewUrl)
    return { quad: scan.quad, width: scan.width, height: scan.height, rawWidth: scan.rawWidth, rawHeight: scan.rawHeight }
  })
}

test('a corrupt image does not discard valid images before or after it', async ({ page }) => {
  const buffer = await image(page)
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'first.png', mimeType: 'image/png', buffer },
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') },
    { name: 'last.png', mimeType: 'image/png', buffer },
  ])
  await expect(page.getByRole('button', { name: 'Export (2)', exact: true })).toBeEnabled()
  await expect(page.locator('.status-text')).toContainText('1 image could not be read')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Export (2)', exact: true })).toBeEnabled()
})

test('restored scans start a new undo history without an empty-session undo', async ({ page }) => {
  await upload(page)
  await expect.poll(() => record(page)).not.toBeNull()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Gray', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
})

test('rotating a cropped scan preserves its selected document boundary', async ({ page }) => {
  await upload(page)
  await expect.poll(() => record(page)).not.toBeNull()
  await page.evaluate(async () => {
    const { scanDb } = await import('/src/core/storage/scanDb.ts')
    const { cvWorker } = await import('/src/core/workers/workerClient.ts')
    const [scan] = await scanDb.loadAllPages()
    scan.quad = [{ x: 100, y: 180 }, { x: 650, y: 130 }, { x: 690, y: 950 }, { x: 80, y: 900 }]
    Object.assign(scan, await cvWorker.warpAndFilter(scan.rawBlob, scan.quad, scan.filter))
    await scanDb.saveAllPages([scan])
  })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  const before = (await record(page))!
  await page.getByRole('button', { name: /Rotate/, exact: false }).click()
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  await expect.poll(async () => (await record(page))?.rawWidth).toBe(before.rawHeight)
  const after = (await record(page))!
  expect(after.quad).toEqual([before.quad[3], before.quad[0], before.quad[1], before.quad[2]].map(p => ({ x: before.rawHeight - 1 - p.y, y: p.x })))
  expect(Math.abs(after.width - before.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(after.height - before.width)).toBeLessThanOrEqual(1)
})

async function mockOcr(page: Page, mode: 'crash' | 'pending' | 'success') {
  await page.addInitScript(mode => {
    const NativeWorker = window.Worker
    let attempts = 0
    class OcrWorker {
      onmessage: ((event: unknown) => void) | null = null
      onerror: ((event: unknown) => void) | null = null
      terminate() { (window as any).__ocrTerminated = true }
      postMessage(request: any) {
        attempts++
        if (mode === 'pending') return
        setTimeout(() => {
          if (mode === 'crash' && attempts === 1) this.onerror?.(new ErrorEvent('error', { message: 'worker crashed' }))
          else this.onmessage?.({ data: { id: request.id, success: true, text: 'SEARCHABLE TEST TEXT', hocr: '<span class="ocrx_word" title="bbox 10 10 100 40">SEARCHABLE</span>' } })
        }, 50)
      }
    }
    window.Worker = new Proxy(NativeWorker, { construct(target, args) { return String(args[0]).includes('ocr.worker') ? new OcrWorker() : Reflect.construct(target, args) } })
  }, mode)
}

async function openSearchableExport(page: Page) {
  await page.getByRole('button', { name: 'Export (1)', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced options', exact: true }).click()
  await page.getByRole('checkbox', { name: /Searchable PDF/ }).click()
}

test('an OCR crash shows an actionable error and a retry can succeed', async ({ page }) => {
  await mockOcr(page, 'crash')
  await upload(page)
  await openSearchableExport(page)
  let downloaded = false
  page.on('download', () => { downloaded = true })
  await page.getByRole('button', { name: 'Download Searchable PDF', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('OCR failed')
  expect(downloaded).toBe(false)
  await expect(page.getByRole('button', { name: 'Download Searchable PDF', exact: true })).toBeEnabled()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Searchable PDF', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
})

test('escaping during OCR cancels work without downloading a file afterwards', async ({ page }) => {
  await mockOcr(page, 'pending')
  await upload(page)
  await openSearchableExport(page)
  let downloaded = false
  page.on('download', () => { downloaded = true })
  await page.getByRole('button', { name: 'Download Searchable PDF', exact: true }).click()
  await expect(page.locator('.export-progress-row')).toContainText('OCR:')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).__ocrTerminated)).toBe(true)
  expect(downloaded).toBe(false)
})

test('changing pages leaves crop mode instead of applying another page’s corners', async ({ page }) => {
  await upload(page, 2)
  await page.getByRole('button', { name: 'Edit Corners', exact: true }).click()
  await expect(page.locator('canvas[aria-label="Document crop editor"]')).toBeVisible()
  await page.getByRole('button', { name: 'Select page 1: Page 1', exact: true }).click()
  await expect(page.locator('canvas[aria-label="Scanned document preview"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply Perspective', exact: true })).toHaveCount(0)
})

test('Ctrl+Shift+Z restores the undone change with an uppercase shortcut key', async ({ page }) => {
  await upload(page)
  await page.getByRole('button', { name: 'Gray', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeEnabled()
  await page.keyboard.press('Control+Shift+Z')
  await expect(page.getByRole('button', { name: 'Redo', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Gray', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('unsupported files show upload guidance without creating an empty scan', async ({ page }) => {
  await image(page)
  await page.locator('input[type=file]').first().setInputFiles({ name: 'document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') })
  await expect(page.locator('.status-text')).toContainText('Invalid PDF structure')
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0)
})

test('transparent PNG paper stays white in JPG processing', async ({ page }) => {
  await image(page)
  const pixel = await page.evaluate(async () => {
    const { cvWorker } = await import('/src/core/workers/workerClient.ts')
    const pixels = new ImageData(100, 100)
    const blob = await cvWorker.imageDataToBlob(pixels)
    const image = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 100
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    image.close()
    return [...context.getImageData(50, 50, 1, 1).data]
  })
  expect(pixel).toEqual([255, 255, 255, 255])
})

test('searchable PDFs use invisible text rendering instead of painting white text over scans', async ({ page }) => {
  await upload(page)
  const bytes = await page.evaluate(async () => {
    const { scanDb } = await import('/src/core/storage/scanDb.ts')
    const { createPdfBlob } = await import('/src/core/pdf/pdfBuilder.ts')
    const pages = await scanDb.loadAllPages()
    try {
      return [...new Uint8Array(await (await createPdfBlob(pages, { searchable: true, ocrWords: [[{ text: 'SEARCHABLE', x0: 10, y0: 10, x1: 100, y1: 40 }]] })).arrayBuffer())]
    } finally { pages.forEach(page => URL.revokeObjectURL(page.previewUrl)) }
  })
  const pdf = Buffer.from(bytes).toString('latin1')
  const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    try { return inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1') } catch { return '' }
  }).join('\n')
  expect(streams).toContain('(SEARCHABLE)')
  expect(streams).toMatch(/\b3 Tr\b/)
})

test('storage-quota failures stay visible while scans can still be exported', async ({ page }) => {
  const buffer = await image(page)
  await expect(page.getByRole('button', { name: 'Upload Files', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction
    Object.defineProperty(IDBDatabase.prototype, 'transaction', { value: function (...args: any[]) {
      if (args[1] === 'readwrite') throw new DOMException('Storage quota reached', 'QuotaExceededError')
      return Reflect.apply(transaction, this, args)
    } })
  })
  await page.locator('input[type=file]').first().setInputFiles({ name: 'scan.png', mimeType: 'image/png', buffer })
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  await expect(page.locator('.scanner-storage-warning')).toContainText('could not be saved')
  await page.getByRole('button', { name: 'Export (1)', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Multi-Page PDF', exact: true }).click()
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
  await expect(page.locator('.scanner-storage-warning')).toContainText('Download them before closing')
})

test('unavailable browser storage keeps scanning usable and warns about recovery', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: { open() { throw new DOMException('Storage unavailable', 'SecurityError') } } })
  })
  await upload(page)
  await expect(page.locator('.scanner-storage-warning')).toContainText('Saved scans could not be restored')
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
})

test('a failed clear retains the pages and reports the failure instead of claiming removal', async ({ page }) => {
  await upload(page)
  await expect.poll(() => record(page)).not.toBeNull()
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction
    Object.defineProperty(IDBDatabase.prototype, 'transaction', { value: function (...args: any[]) {
      if (args[1] === 'readwrite') throw new DOMException('Storage unavailable', 'SecurityError')
      return Reflect.apply(transaction, this, args)
    } })
  })
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Clear all pages', exact: true }).click()
  await expect(page.locator('.scanner-storage-warning')).toContainText('Your pages are unchanged')
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  expect(await record(page)).not.toBeNull()
})

test('confirmed clear removes the saved session and its undo history', async ({ page }) => {
  await upload(page, 2)
  await expect.poll(() => record(page)).not.toBeNull()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Clear all pages', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Upload Files', exact: true })).toBeEnabled()
  expect(await record(page)).toBeNull()
})

test('another tab cannot silently overwrite or clear a newer saved session', async ({ context, page }) => {
  const buffer = await image(page)
  await page.locator('input[type=file]').first().setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer })
  await expect(page.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  const savedCount = () => page.evaluate(async () => { const { scanDb } = await import('/src/core/storage/scanDb.ts'); const pages = await scanDb.loadAllPages(); pages.forEach(p => URL.revokeObjectURL(p.previewUrl)); return pages.length })
  await expect.poll(savedCount).toBe(1)
  const other = await context.newPage()
  await other.goto('/')
  await expect(other.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  await page.locator('input[type=file]').first().setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer })
  await expect(page.getByRole('button', { name: 'Export (2)', exact: true })).toBeEnabled()
  await expect.poll(savedCount).toBe(2)
  await other.getByRole('button', { name: 'Rotate', exact: true }).click()
  await expect(other.locator('.scanner-storage-warning')).toContainText('changed in another tab')
  await expect(other.getByRole('button', { name: 'Export (1)', exact: true })).toBeEnabled()
  other.once('dialog', dialog => dialog.accept())
  await other.getByRole('button', { name: 'Clear all pages', exact: true }).click()
  await expect(other.locator('.scanner-storage-warning')).toContainText('changed in another tab')
  expect(await savedCount()).toBe(2)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Export (2)', exact: true })).toBeEnabled()
  await other.close()
})
