import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
const { parsePageRange } = await loadTs('../src/core/pdf/pageRange.ts')
test('page selections support ordered ranges and avoid repeated pages', () => {
  assert.deepEqual(parsePageRange('3, 1-2, 2, 5', 5), [3, 1, 2, 5])
})
test('page selections reject empty, malformed, inverted and out-of-bounds values', () => {
  for (const value of ['', '1,', '0', '3-1', '2-6', '2.5', '1-999999999999999']) assert.throws(() => parsePageRange(value, 5))
})
