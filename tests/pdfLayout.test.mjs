import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTs } from './load-ts.mjs'

const { fitImage, idCardBoxes, rasterSize, formatFileSize } = await loadTs('../src/core/pdf/pdfLayout.ts')

test('fitting a scan preserves its aspect ratio and centers it within margins', () => {
  const result = fitImage(1000, 500, { x: 20, y: 20, width: 500, height: 700 })
  assert.deepEqual(result, { x: 20, y: 245, width: 500, height: 250 })
  assert.throws(() => fitImage(0, 500, { x: 0, y: 0, width: 100, height: 100 }))
})

test('ID card front and back have standard dimensions and fit on one A4 or Letter sheet', () => {
  for (const [width, height] of [[595.28, 841.89], [612, 792]]) {
    const boxes = idCardBoxes(width, height, 2, 40)
    assert.ok(Math.abs(boxes[0].width / 72 * 25.4 - 85.6) < 0.001)
    assert.ok(Math.abs(boxes[0].height / 72 * 25.4 - 54) < 0.001)
    assert.equal(boxes[0].x, boxes[1].x)
    assert.ok(boxes[0].y >= 40)
    assert.ok(boxes[1].y > boxes[0].y + boxes[0].height)
    assert.ok(boxes[1].y + boxes[1].height <= height - 40)
    assert.ok(Math.abs((boxes[0].y + boxes[1].y + boxes[1].height) / 2 - height / 2) < 0.001)
  }
})

test('front-only ID export is centered and does not stretch portrait images', () => {
  const [box] = idCardBoxes(595.28, 841.89, 1, 20)
  const image = fitImage(400, 600, box)
  assert.ok(Math.abs(image.width / image.height - 2 / 3) < 0.001)
  assert.ok(Math.abs(image.y + image.height / 2 - 841.89 / 2) < 0.001)
  assert.throws(() => idCardBoxes(595, 842, 3, 20))
})

test('PDF quality presets reduce resolution in order without upscaling small scans', () => {
  const box = { x: 0, y: 0, width: 540, height: 720 }
  assert.deepEqual(rasterSize(3000, 4000, box, 'small'), { width: 900, height: 1200 })
  assert.deepEqual(rasterSize(3000, 4000, box, 'balanced'), { width: 1350, height: 1800 })
  assert.deepEqual(rasterSize(3000, 4000, box, 'high'), { width: 2250, height: 3000 })
  assert.deepEqual(rasterSize(300, 400, box, 'high'), { width: 300, height: 400 })
})

test('size labels distinguish bytes, KB and MB', () => {
  assert.equal(formatFileSize(500), '500 B')
  assert.equal(formatFileSize(1024), '1.0 KB')
  assert.equal(formatFileSize(1024 * 1024), '1.00 MB')
})
