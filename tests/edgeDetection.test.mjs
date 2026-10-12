import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTs } from './load-ts.mjs'

const { detectDocumentQuad } = await loadTs('../src/core/cv/edgeDetection.ts')

function fixture(width, height, quad, options = {}) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = quad && quad.every((p, i) => {
        const q = quad[(i + 1) % 4]
        return (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x) >= 0
      })
      let lum = inside ? options.paper ?? 235 : options.background ?? 55
      if (inside && options.text && y % 22 < 3 && x > width * 0.35 && x < width * 0.65) lum = 20
      if (options.clutter && Math.hypot(x - 28, y - 28) < 18) lum = 250
      data.set([lum, lum, lum, 255], (y * width + x) * 4)
    }
  }
  return { data, width, height }
}

function nearQuad(actual, expected, tolerance = 7) {
  assert.ok(actual, 'Document was not detected')
  for (const corner of expected) {
    assert.ok(actual.some(p => Math.hypot(p.x - corner.x, p.y - corner.y) <= tolerance), `Missing corner ${JSON.stringify(corner)}: ${JSON.stringify(actual)}`)
  }
}

test('detects a perspective page even with separate desk clutter', () => {
  const quad = [{ x: 95, y: 50 }, { x: 320, y: 75 }, { x: 290, y: 340 }, { x: 80, y: 320 }]
  nearQuad(detectDocumentQuad(fixture(400, 400, quad, { clutter: true, text: true })), quad)
})

test('detects a low-contrast page with dark internal text', () => {
  const quad = [{ x: 60, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 350 }, { x: 60, y: 350 }]
  nearQuad(detectDocumentQuad(fixture(400, 400, quad, { paper: 145, background: 100, text: true })), quad)
})

test('keeps four distinct corners on a page rotated 45 degrees', () => {
  const quad = [{ x: 100, y: 20 }, { x: 180, y: 100 }, { x: 100, y: 180 }, { x: 20, y: 100 }]
  nearQuad(detectDocumentQuad(fixture(200, 200, quad)), quad)
})

test('preserves coordinates on wide images without stretching the detector', () => {
  const quad = [{ x: 40, y: 10 }, { x: 460, y: 10 }, { x: 460, y: 90 }, { x: 40, y: 90 }]
  nearQuad(detectDocumentQuad(fixture(500, 100, quad)), quad)
})

test('does not invent document borders on blank scenes or tiny images', () => {
  assert.equal(detectDocumentQuad(fixture(400, 300, null)), null)
  assert.equal(detectDocumentQuad(fixture(2, 2, null)), null)
})
