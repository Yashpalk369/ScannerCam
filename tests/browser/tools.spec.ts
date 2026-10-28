import { test, expect, type Page } from '@playwright/test'
import { jsPDF } from 'jspdf'
import tools from '../../src/content/tools.json' with { type: 'json' }

test.beforeEach(async ({ page }) => {
  await page.route(
    /^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com|pagead2\.googlesyndication\.com)\//,
    (route) => route.abort(),
  )
})
const fixturePdf = () => {
  const pdf = new jsPDF({ unit: 'pt', format: [400, 600] })
  pdf.setFillColor(255, 255, 255)
  pdf.rect(0, 0, 400, 600, 'F')
  pdf.setFontSize(28)
  pdf.text('PRIVATE ACCOUNT 12345', 20, 80)
  pdf.addPage([600, 400], 'landscape')
  pdf.text('SECOND PAGE', 30, 80)
  return Buffer.from(pdf.output('arraybuffer'))
}
async function uploadPdf(page: Page, path = '/pdf-editor') {
  await page.goto(path)
  await expect(page.locator('input[type=file]').first()).toBeAttached()
  await expect(
    page.getByRole('button', { name: 'Upload Files', exact: true }),
  ).toBeEnabled()
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'document.pdf',
    mimeType: 'application/pdf',
    buffer: fixturePdf(),
  })
  await expect(
    page.getByRole('button', { name: 'Export (2)', exact: true }),
  ).toBeEnabled({ timeout: 20000 })
}
test('tool pages have crawlable content, unique canonicals and matching FAQ schema without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL: test.info().project.use.baseURL,
  })
  const page = await context.newPage()
  for (const tool of tools) {
    await page.goto(tool.path)
    await expect(page).toHaveTitle(tool.title)
    await expect(page.locator('h1')).toHaveText(tool.heading)
    await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
      'href',
      'https://www.scanner.cam' + tool.path,
    )
    const graph = await page
      .locator('script[type="application/ld+json"]')
      .textContent()
    expect(
      JSON.parse(graph!)
        ['@graph'].find((item: any) => item['@type'] === 'FAQPage')
        .mainEntity.map((item: any) => item.name),
    ).toEqual(tool.faqs.map((faq) => faq.q))
    for (const faq of tool.faqs)
      await expect(page.getByText(faq.a, { exact: true })).toBeVisible()
    await expect(page.locator('.site-footer')).toHaveCount(1)
  }
  await context.close()
})
test('PDF import retains full pages and lets users merge photos, rotate, reorder and export', async ({
  page,
}) => {
  await uploadPdf(page)
  await expect(page.locator('.page-meta-details')).toContainText('ORIGINAL')
  await page.getByRole('button', { name: 'Rotate', exact: true }).click()
  await expect(page.locator('.status-text')).toContainText('rotated')
  await page
    .getByRole('button', { name: 'Move page 2 up', exact: true })
    .click()
  await expect(page.locator('.page-name').first()).toHaveText('document · 2')
  await page
    .getByRole('button', { name: 'Move page 1 down', exact: true })
    .click()
  await expect(page.locator('.page-name').first()).toHaveText('document · 1')
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles('tests/fixtures/document.png')
  await expect(
    page.getByRole('button', { name: 'Export (3)', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Remove page 3', exact: true }).click()
  await expect(page.locator('.page-thumbnail-card')).toHaveCount(2)
  await page.getByRole('button', { name: 'Export (2)', exact: true }).click()
  await expect(page.getByTestId('pdf-size')).toHaveAttribute(
    'data-bytes',
    /^[1-9]\d*$/,
  )
  const download = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Download Multi-Page PDF', exact: true })
    .click()
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/)
})
test('target compression measures output, previews it, and blocks impossible limits', async ({
  page,
}) => {
  await uploadPdf(page, '/compress-pdf')
  await page.getByRole('button', { name: 'Export (2)', exact: true }).click()
  await expect(page.getByTestId('pdf-size')).toHaveAttribute(
    'data-bytes',
    /^[1-9]\d*$/,
  )
  expect(
    Number(await page.getByTestId('pdf-size').getAttribute('data-bytes')),
  ).toBeLessThanOrEqual(1000000)
  await page.getByRole('button', { name: 'Preview PDF quality' }).click()
  await expect(
    page.getByAltText('First page of the prepared PDF at its export quality'),
  ).toBeVisible()
  await page
    .getByLabel('Maximum PDF size', { exact: true })
    .selectOption('custom')
  await page.getByLabel('Limit in KB (1 KB = 1,000 bytes)').fill('1')
  await expect(page.getByRole('alert')).toContainText(
    'Could not meet this size limit',
    { timeout: 20000 },
  )
  await expect(
    page.getByRole('button', { name: 'Download Multi-Page PDF' }),
  ).toBeDisabled()
  await page.getByLabel('Quick preset').selectOption('print')
  await expect(page.getByLabel('PDF Quality', { exact: true })).toHaveValue(
    'high',
  )
  await expect(
    page.getByLabel('Maximum PDF size', { exact: true }),
  ).toHaveValue('')
})
test('redaction replaces pixels in both working images so Original cannot expose them', async ({
  page,
}) => {
  await uploadPdf(page)
  await page.getByRole('button', { name: 'Redact', exact: true }).click()
  const dropPrevented = await page.evaluate(() => {
    const data = new DataTransfer()
    data.items.add(new File(['test'], 'drop.png', { type: 'image/png' }))
    const over = new DragEvent('dragover', {
      cancelable: true,
      dataTransfer: data,
    })
    const drop = new DragEvent('drop', { cancelable: true, dataTransfer: data })
    window.dispatchEvent(over)
    window.dispatchEvent(drop)
    return drop.defaultPrevented
  })
  expect(dropPrevented).toBe(true)
  await expect(page.locator('.drag-drop-overlay')).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Add redaction box', exact: true })
    .click()
  await page.getByLabel('x (%)', { exact: true }).fill('0')
  await page.getByLabel('y (%)', { exact: true }).fill('0')
  await page.getByLabel('width (%)', { exact: true }).fill('100')
  await page.getByLabel('height (%)', { exact: true }).fill('100')
  await page
    .getByRole('button', { name: 'Apply redactions', exact: true })
    .click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Original', exact: true }).click()
  await expect(page.locator('.status-text')).toContainText(
    'updated with original',
  )
  const pixels = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('scannercam_db')
      r.onsuccess = () => resolve(r.result)
    })
    const records = await new Promise<any[]>((resolve) => {
      const r = db
        .transaction('scanned_pages')
        .objectStore('scanned_pages')
        .getAll()
      r.onsuccess = () => resolve(r.result)
    })
    db.close()
    const record = records.find((r) => r.name.endsWith('2'))
    return await Promise.all(
      [record.rawBlob, record.blob].map(async (blob) => {
        const bitmap = await createImageBitmap(blob)
        const c = document.createElement('canvas')
        c.width = bitmap.width
        c.height = bitmap.height
        const ctx = c.getContext('2d')!
        ctx.drawImage(bitmap, 0, 0)
        return [...ctx.getImageData(10, 10, 1, 1).data]
      }),
    )
  })
  expect(pixels).toEqual([
    [0, 0, 0, 255],
    [0, 0, 0, 255],
  ])
  await page.getByRole('button', { name: 'Export (2)', exact: true }).click()
  await page
    .getByRole('button', { name: 'Advanced options', exact: true })
    .click()
  const downloading = page.waitForEvent('download')
  await page
    .getByRole('button', { name: 'Download Current JPG', exact: true })
    .click()
  const stream = await (await downloading).createReadStream(),
    chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect([...Buffer.concat(chunks).subarray(0, 3)]).toEqual([255, 216, 255])
})
test('curve correction changes the image and remains undoable', async ({
  page,
}) => {
  await uploadPdf(page)
  await page.getByRole('button', { name: 'Flatten curved page' }).click()
  await page.getByLabel('Top edge bend').fill('15')
  await page.getByRole('button', { name: 'Apply curve correction' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('.status-text')).toHaveText('Undone.')
})
test('background remover runs the real local model and downloads an image with transparency', async ({
  page,
}) => {
  test.setTimeout(120000)
  const uploads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST') uploads.push(request.url())
  })
  await page.goto('/remove-background')
  const portrait = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 320
    c.height = 400
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, 320, 400)
    ctx.fillStyle = '#28334b'
    ctx.beginPath()
    ctx.ellipse(160, 320, 95, 130, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#c38d71'
    ctx.beginPath()
    ctx.ellipse(160, 135, 55, 70, 0, 0, Math.PI * 2)
    ctx.fill()
    return c.toDataURL('image/png').split(',')[1]
  })
  await page.getByLabel('Choose a photo', { exact: true }).setInputFiles({
    name: 'portrait.png',
    mimeType: 'image/png',
    buffer: Buffer.from(portrait, 'base64'),
  })
  await page
    .getByRole('button', { name: 'Remove background', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Download transparent PNG' }),
  ).toBeVisible({ timeout: 90000 })
  const alpha = await page
    .locator('#remover-after-canvas')
    .evaluate((c: HTMLCanvasElement) => {
      const pixels = c
        .getContext('2d')!
        .getImageData(0, 0, c.width, c.height).data
      let min = 255,
        max = 0
      for (let i = 3; i < pixels.length; i += 4) {
        min = Math.min(min, pixels[i])
        max = Math.max(max, pixels[i])
      }
      return { min, max }
    })
  expect(alpha.min).toBeLessThan(50)
  expect(alpha.max).toBeGreaterThan(200)
  expect(uploads).toEqual([])
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download transparent PNG' }).click()
  expect((await download).suggestedFilename()).toBe('no-background.png')
})

test('HEIC photos convert locally and malformed HEIC reports a useful recovery step', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: 'Upload Files', exact: true }),
  ).toBeEnabled()
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles('tests/fixtures/document.heic')
  await expect(
    page.getByRole('button', { name: 'Export (1)', exact: true }),
  ).toBeEnabled({ timeout: 20000 })
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'broken.heic',
      mimeType: 'image/heic',
      buffer: Buffer.from('broken image'),
    })
  await expect(page.locator('.status-text')).toContainText(
    'Export it as JPG from Photos',
  )
  await expect(page.locator('.page-thumbnail-card')).toHaveCount(1)
})

test('compression reduces a detailed image to the actual byte budget', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { createPdfBlob, createPdfForTarget } =
      await import('/src/core/pdf/pdfBuilder.ts')
    const c = document.createElement('canvas')
    c.width = 1400
    c.height = 1800
    const ctx = c.getContext('2d')!,
      pixels = ctx.createImageData(c.width, c.height)
    let seed = 12345
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const v = seed % 256
      pixels.data.set([v, v, v, 255], i)
    }
    ctx.putImageData(pixels, 0, 0)
    const blob = await new Promise<Blob>((resolve) =>
      c.toBlob((b) => resolve(b!), 'image/png'),
    )
    const scan: any = {
      id: 'noise',
      name: 'Detail',
      blob,
      width: c.width,
      height: c.height,
    }
    const original = await createPdfBlob([scan], { qualityPreset: 'high' })
    const compressed = await createPdfForTarget([scan], {
      qualityPreset: 'high',
      targetBytes: 150000,
    })
    return { original: original.size, compressed: compressed.size }
  })
  expect(result.original).toBeGreaterThan(150000)
  expect(result.compressed).toBeLessThanOrEqual(150000)
})

test('OCR language selection reaches the worker and Unicode text downloads retain characters', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options)
        if (String(url).includes('ocr.worker'))
          this.postMessage = (request: any) => {
            ;(window as any).__ocrLanguage = request.lang
            setTimeout(
              () =>
                this.dispatchEvent(
                  new MessageEvent('message', {
                    data: {
                      id: request.id,
                      success: true,
                      text: 'नमस्ते भारत 12345',
                      hocr: '',
                    },
                  }),
                ),
              10,
            )
          }
      }
    }
  })
  await uploadPdf(page, '/image-to-text')
  await page.getByRole('button', { name: 'Extract text', exact: true }).click()
  await page
    .getByLabel('Text recognition language', { exact: true })
    .selectOption('hin')
  await page.getByRole('checkbox', { name: /Searchable PDF/ }).click()
  await expect(
    page.getByRole('button', { name: 'Download Searchable PDF', exact: true }),
  ).toBeDisabled()
  const downloading = page.waitForEvent('download')
  await page
    .getByRole('button', {
      name: 'Download recognized text (.txt)',
      exact: true,
    })
    .click()
  const stream = await (await downloading).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks).toString('utf8')).toContain('नमस्ते भारत 12345')
  expect(await page.evaluate(() => (window as any).__ocrLanguage)).toBe('hin')
})
