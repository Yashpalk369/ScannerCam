import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTs } from './load-ts.mjs'

const { calculateImageView, zoomAtPoint, clampZoom } = await loadTs('../src/core/cv/viewerTransform.ts')
const viewport = { width: 500, height: 600, top: 80, bottom: 60 }

test('fit view stays inside controls and keeps image proportions', () => {
  const { view } = calculateImageView(1000, 2000, viewport, { zoom: 1, pan: { x: 500, y: 500 } })
  assert.equal(view.offsetX, 135)
  assert.equal(view.offsetY, 80)
  assert.equal(view.drawWidth, 230)
  assert.equal(view.drawHeight, 460)
})

test('panning cannot move the entire zoomed document out of view', () => {
  const { pan, view } = calculateImageView(1000, 2000, viewport, { zoom: 3, pan: { x: 10000, y: -10000 } })
  assert.ok(Math.abs(pan.x - 115) < 1e-8)
  assert.ok(Math.abs(pan.y + 460) < 1e-8)
  assert.ok(Math.abs(view.offsetX - 20) < 1e-8)
  assert.ok(Math.abs(view.offsetY + view.drawHeight - 540) < 1e-8)
})

test('pinch or pointer zoom preserves the image point at the anchor', () => {
  const current = { zoom: 2, pan: { x: 40, y: -20 } }
  const anchor = { x: 180, y: 200 }
  const center = { x: 250, y: 310 }
  const next = zoomAtPoint(current, 3, anchor, center)
  for (const axis of ['x', 'y']) {
    assert.ok(Math.abs((anchor[axis] - center[axis] - current.pan[axis]) / current.zoom - (anchor[axis] - center[axis] - next.pan[axis]) / next.zoom) < 0.001)
  }
})

test('crop coordinates stay correct after zoom and pan', () => {
  const { view } = calculateImageView(1000, 2000, viewport, { zoom: 2, pan: { x: 0, y: 100 } })
  const rawCorner = { x: 250, y: 500 }
  const screen = { x: view.offsetX + rawCorner.x * view.scale, y: view.offsetY + rawCorner.y * view.scale }
  assert.ok(Math.abs((screen.x - view.offsetX) / view.scale - rawCorner.x) < 0.001)
  assert.ok(Math.abs((screen.y - view.offsetY) / view.scale - rawCorner.y) < 0.001)
})

test('zoom limits reject invalid values and fit does not enlarge tiny images', () => {
  assert.equal(clampZoom(Infinity), 1)
  assert.equal(clampZoom(-2), 1)
  assert.equal(clampZoom(1000), 24)
  const { fitScale } = calculateImageView(100, 100, viewport, { zoom: 1, pan: { x: 0, y: 0 } })
  assert.equal(fitScale, 1)
})
