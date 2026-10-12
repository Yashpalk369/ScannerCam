import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const source = readFileSync(new URL('../src/core/cv/filters.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
}).outputText
const { applyFilterToImageData } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

function image(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4)
  }
  return { data, width, height }
}

test('Original preserves every color and alpha value, including soft edges', () => {
  const scan = image(20, 20, (x, y) => [100 + x * 2 + y % 3 * 10, 80 + x * 3, 150, 200])
  const before = new Uint8ClampedArray(scan.data)
  applyFilterToImageData(scan, 'original')
  assert.deepEqual(scan.data, before)
})

test('Magic Color keeps blank paper bright instead of making it dark gray', () => {
  for (const brightness of [180, 220, 240, 255]) {
    const scan = image(80, 80, () => [brightness, brightness, brightness, 255])
    applyFilterToImageData(scan, 'magic')
    assert.ok(scan.data[0] >= 240, `Paper at ${brightness} became ${scan.data[0]}`)
  }
})

test('Magic Color preserves faint ink on a page with sparse text', () => {
  const scan = image(100, 100, (x, y) => {
    const value = y === 50 && x >= 30 && x < 60 ? 200 : 230
    return [value, value, value, 255]
  })
  applyFilterToImageData(scan, 'magic')
  const paper = scan.data[(40 * 100 + 40) * 4]
  const ink = scan.data[(50 * 100 + 40) * 4]
  assert.ok(paper >= 240, `Paper became ${paper}`)
  assert.ok(ink > 120, `Faint ink was crushed to ${ink}`)
  assert.ok(paper - ink >= 20, 'Faint text lost its contrast')
})

test('Magic Color does not introduce block seams across smooth lighting', () => {
  const scan = image(320, 320, x => {
    const value = Math.round(140 + x * 80 / 319)
    return [value, value, value, 255]
  })
  applyFilterToImageData(scan, 'magic')
  for (let x = 2; x < 318; x++) {
    const index = (160 * 320 + x) * 4
    assert.ok(Math.abs(scan.data[index] - scan.data[index - 4]) <= 3, `Visible seam at x=${x}`)
  }
})

test('Magic Color preserves colored marks and transparency on small images', () => {
  for (const size of [1, 3, 21]) {
    const scan = image(size, size, () => [45, 90, 160, 128])
    applyFilterToImageData(scan, 'magic')
    for (let i = 0; i < scan.data.length; i += 4) {
      assert.ok(scan.data[i + 2] > scan.data[i + 1] && scan.data[i + 1] > scan.data[i])
      assert.equal(scan.data[i + 3], 128)
    }
  }
})
