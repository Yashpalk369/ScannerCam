import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
const { coverRectangle, curveOffset } = await loadTs(
  '../src/core/image/edits.ts',
)
test('redaction expands fractional boundaries to cover every touched pixel and clips to the page', () => {
  assert.deepEqual(
    coverRectangle(
      { x: 0.101, y: 0.205, width: 0.204, height: 0.104 },
      100,
      200,
    ),
    { x: 10, y: 41, width: 21, height: 21 },
  )
  assert.deepEqual(
    coverRectangle({ x: 0.9, y: 0.9, width: 0.3, height: 0.5 }, 100, 200),
    { x: 90, y: 180, width: 10, height: 20 },
  )
  assert.throws(() =>
    coverRectangle({ x: 1, y: 0, width: 0, height: 0.2 }, 100, 200),
  )
})
test('curve correction holds edges fixed, moves the middle, and supports either direction', () => {
  assert.equal(curveOffset(0, 0.1, 1000), 0)
  assert.equal(curveOffset(1, 0.1, 1000), 0)
  assert.equal(curveOffset(0.5, 0.1, 1000), 100)
  assert.equal(curveOffset(0.5, -0.1, 1000), -100)
})
