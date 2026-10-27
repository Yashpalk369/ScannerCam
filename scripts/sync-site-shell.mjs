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
    // Content generators may regenerate legacy shells. Reapply UI/markup fixes
    // without changing their article text, metadata, or structured data.
    next = next.replace(/^\.(?:site-header|brand(?:-icon|-name|-tag)?|site-nav|site-footer|footer-note|footer-bottom)(?=[{ .:])[^\n]*\n/gm, '')
      .replace('@media(max-width:640px){.site-nav a:not(.btn){display:none}}\n', '')
      .replace('@media(max-width:720px){.site-footer .wrap{grid-template-columns:1fr}article{', '@media(max-width:720px){article{')
      .replace('.crumbs a{color:var(--brand-dark);text-decoration:none}', '.crumbs a{color:var(--brand-dark);text-decoration:underline;text-underline-offset:2px}')
      .replace('.mid-cta span{font-size:.88rem;color:var(--muted)}', '.mid-cta span{font-size:.88rem;color:#475569}')
      .replace('.cta-card{background:linear-gradient(135deg,#059669,#047857)', '.cta-card{background:linear-gradient(135deg,#047857,#065f46)')
      .replace('.cta-card p{opacity:', '.cta-card p{color:#fff;opacity:')
      .replace('gap:.4rem;background:var(--brand);', 'gap:.4rem;background:var(--brand-dark);')
      .replace('.sticky-cta a{background:var(--brand);', '.sticky-cta a{background:var(--brand-dark);')
      .replace('<div class="sticky-cta">', '<div class="sticky-cta" role="region" aria-label="Quick scanner access">')
      .replace(/<p><a href="https:\/\/www\.scanner\.cam\/">\s*(<nav class="prevnext")/g, '$1')
      .replace(/ &nbsp;•&nbsp; <a href="https:\/\/www\.scanner\.cam\/">\s*(<nav class="prevnext")/g, '</p>\n$1')
      .replace('<nav class="prevnext">', '<nav class="prevnext" aria-label="Guide navigation">')
    if (name === 'public/blog/index.html') next = next.replaceAll('<h3>', '<h2>').replaceAll('</h3>', '</h2>').replace('.card h3{', '.card h2{')
    if (name === 'public/contact.html') next = next.replace('Use the contact address published on our official channels, and include', 'Email us at <a href="mailto:Hello@scanner.cam">Hello@scanner.cam</a>, and include')
    if (!next.includes('rel="icon"')) next = next.replace('<meta name="theme-color" content="#059669">', '<meta name="theme-color" content="#059669">\n<link rel="icon" type="image/svg+xml" href="/favicon.svg">')
    next = next.replace(/<table>([\s\S]*?)<\/table>/g, (table, content, offset) => /<div class="table-scroll"[^>]*>\s*$/.test(next.slice(0, offset)) ? table : `<div class="table-scroll" role="region" aria-label="Scanner comparison table" tabindex="0"><table>${content}</table></div>`)
    next = next.replace(/<header class="site-header">[\s\S]*?<\/header>/, renderSiteHeader(header, pagePath))
    next = next.replace(/<footer class="site-footer(?: app-footer)?">[\s\S]*?<\/footer>/, footer)
  }
  if (!next.includes('href="/site-shell.css"')) next = next.replace('</head>', '<link rel="stylesheet" href="/site-shell.css">\n</head>')
  if (!next.includes('pagead2.googlesyndication.com')) next = next.replace('</head>', '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4195398786095859" crossorigin="anonymous"></script>\n</head>')
  if (next !== original) writeFileSync(path, next)
}
syncHomepage(root)
