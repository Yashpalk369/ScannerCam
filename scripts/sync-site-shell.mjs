import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { renderSiteHeader } from '../src/components/Layout/siteShell.mjs'
import { syncHomepage } from './sync-homepage.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const header = readFileSync(resolve(root, 'src/components/Layout/site-header.html'), 'utf8').trim()
const footer = readFileSync(resolve(root, 'src/components/Layout/site-footer.html'), 'utf8').trim()
const files = ['index.html', ...['public', 'public/blog'].flatMap(directory => readdirSync(resolve(root, directory)).filter(name => name.endsWith('.html')).map(name => `${directory}/${name}`))]
for (const name of files) {
  const path = resolve(root, name)
  const original = readFileSync(path, 'utf8')
  const pagePath = name === 'index.html' ? '/' : name.replace(/^public/, '').replace(/\/index\.html$/, '').replace(/\.html$/, '')
  let next = original
  if (name === 'index.html') {
    // The initial HTML already has its own SEO heading below the app placeholder.
    next = next.replace(/<header class="(?:header-pre|site-header)">[\s\S]*?<\/header>/, renderSiteHeader(header, '/', false))
  } else {
    next = next.replace(/<header class="site-header">[\s\S]*?<\/header>/, renderSiteHeader(header, pagePath))
    next = next.replace(/<footer class="site-footer(?: app-footer)?">[\s\S]*?<\/footer>/, footer)
  }
  if (!next.includes('href="/site-shell.css"')) next = next.replace('</head>', '<link rel="stylesheet" href="/site-shell.css">\n</head>')
  if (next !== original) writeFileSync(path, next)
}
syncHomepage(root)
