import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
const { inspectImageForMetadataRemoval } = await loadTs('../src/core/image/metadataRemoval.ts')
const signature = [137, 80, 78, 71, 13, 10, 26, 10]
const chunk = type => [0, 0, 0, 0, ...Buffer.from(type), 0, 0, 0, 0]
test('metadata removal accepts JPEG and a still PNG but rejects animation and malformed files', () => {
  assert.equal(inspectImageForMetadataRemoval(Uint8Array.from([255, 216, 255, 217])), 'jpeg')
  assert.equal(inspectImageForMetadataRemoval(Uint8Array.from([...signature, ...chunk('IEND')])), 'png')
  assert.throws(() => inspectImageForMetadataRemoval(Uint8Array.from([...signature, ...chunk('acTL'), ...chunk('IEND')])), /Animated PNG/)
  assert.throws(() => inspectImageForMetadataRemoval(Uint8Array.from([...signature, 0, 0, 0, 4, 73, 68, 65, 84])), /incomplete/)
  assert.throws(() => inspectImageForMetadataRemoval(Uint8Array.from([0, 1, 2])), /JPEG or PNG/)
})
