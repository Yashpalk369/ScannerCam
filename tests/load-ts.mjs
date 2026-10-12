import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const ts = createRequire(import.meta.url)('typescript')
const cache = new Map()

// Load the actual pure TypeScript modules without introducing a test bundler.
function moduleUrl(url) {
  if (cache.has(url.href)) return cache.get(url.href)
  const source = readFileSync(url, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from ['"](\.[^'"]+)['"]/g, (_, path) => {
    const dependency = new URL(path.endsWith('.ts') ? path : `${path}.ts`, url)
    return `from '${moduleUrl(dependency)}'`
  })
  const encoded = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  cache.set(url.href, encoded)
  return encoded
}

export function loadTs(path) {
  return import(moduleUrl(new URL(path, import.meta.url)))
}
