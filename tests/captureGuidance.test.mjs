import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTs } from './load-ts.mjs'

const { EMPTY_STABILITY, updateCaptureStability, assessCaptureQuality, mapVideoQuad } = await loadTs('../src/core/cv/captureGuidance.ts')
const quad = [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }]
const shift = n => quad.map(p => ({ x: p.x + n, y: p.y }))

test('auto-capture needs sustained stability and cancels immediately on movement or lost edges', () => {
  let state = updateCaptureStability(EMPTY_STABILITY, quad, 100, true)
  state = updateCaptureStability(state, shift(2), 800, true)
  assert.equal(state.ready, false)
  state = updateCaptureStability(state, shift(2), 1100, true)
  assert.equal(state.ready, true)
  state = updateCaptureStability(state, shift(12), 1200, true)
  assert.equal(state.ready, false)
  assert.equal(updateCaptureStability(state, null, 1300, true).anchor, null)
})

test('slow continuous drift cannot trigger auto-capture', () => {
  let state = EMPTY_STABILITY
  for (let i = 0; i < 20; i++) {
    state = updateCaptureStability(state, shift(i * 2), i * 200, true)
    assert.equal(state.ready, false)
  }
})

test('poor image quality cancels a pending capture', () => {
  const state = updateCaptureStability(EMPTY_STABILITY, quad, 0, true)
  assert.equal(updateCaptureStability(state, quad, 1200, false).ready, false)
})

test('overlay follows the visible video on portrait and landscape screens', () => {
  const landscape = mapVideoQuad(quad, 100, 100, 200, 100)
  assert.deepEqual(landscape[0], { x: 60, y: 10 })
  const portrait = mapVideoQuad(quad, 100, 100, 100, 200)
  assert.deepEqual(portrait[0], { x: 10, y: 60 })
})

test('quality guidance distinguishes low light, soft detail, crisp text, and blank paper', () => {
  const image = pixel => {
    const data = new Uint8ClampedArray(100 * 100 * 4)
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) {
      const value = pixel(x, y)
      data.set([value, value, value, 255], (y * 100 + x) * 4)
    }
    return { data, width: 100, height: 100 }
  }
  assert.equal(assessCaptureQuality(image(() => 30), quad).lowLight, true)
  assert.equal(assessCaptureQuality(image(x => 80 + x), quad).blurry, true)
  assert.equal(assessCaptureQuality(image(x => x % 10 < 3 ? 30 : 230), quad).blurry, false)
  assert.deepEqual(assessCaptureQuality(image(() => 230), quad), { lowLight: false, blurry: false })
})
