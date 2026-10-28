import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

export function syncHomepage(root) {
  const { heading, faqs } = JSON.parse(readFileSync(resolve(root, 'src/content/homepage.json'), 'utf8'))
  const path = resolve(root, 'index.html')
  const original = readFileSync(path, 'utf8')
  let next = original.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (script, start, body, end) => {
    const data = JSON.parse(body)
    const faq = data['@graph']?.find(node => node['@type'] === 'FAQPage')
    if (!faq) return script
    faq.mainEntity = faqs.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
    return `${start}\n${JSON.stringify(data, null, 2).replaceAll('<', '\\u003c')}\n${end}`
  })
  next = next.replace(/(<div id="seo-fallback">\s*<h1>)[\s\S]*?(<\/h1>)/, `$1${escapeHtml(heading)}$2`)
  const tools = JSON.parse(readFileSync(resolve(root, 'src/content/tools.json'), 'utf8')).filter(tool => tool.path !== '/tools')
  const toolLinks = tools.map(tool => `<li><a href="${escapeHtml(tool.path)}">${escapeHtml(tool.heading)}</a><p>${escapeHtml(tool.description)}</p></li>`).join('\n')
  const toolBlock = `<!-- homepage-tools-start -->\n        <h2>More free tools</h2>\n        <p>Simple tools for your documents and images, right in your browser.</p>\n        <ul class="guide-cards">${toolLinks}</ul>\n        <p><a href="/tools">View all tools →</a></p>\n        <!-- homepage-tools-end -->`
  if (!next.includes('<!-- homepage-tools-start -->') || !next.includes('<!-- homepage-tools-end -->')) throw new Error('Could not locate the homepage tools fallback.')
  next = next.replace(/<!-- homepage-tools-start -->[\s\S]*?<!-- homepage-tools-end -->/, toolBlock)
  const content = faqs.map(({ q, a, links = [] }) => `<div class="fallback-faq"><p><strong>${escapeHtml(q)}</strong></p><p class="fallback-faq-answer">${escapeHtml(a)}</p>${links.length ? `<p>Learn more: ${links.map(link => `<a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`).join(' · ')}</p>` : ''}</div>`).join('\n')
  const start = next.search(/        <h2(?: id="faq")?>Frequently asked questions<\/h2>/)
  const end = next.indexOf('      </div>\n    </div>\n    <script type="module"', start)
  if (start < 0 || end < 0) throw new Error('Could not locate the homepage FAQ fallback.')
  next = next.slice(0, start) + `        <h2 id="faq">Frequently asked questions</h2>\n${content}\n` + next.slice(end)
  if (next !== original) writeFileSync(path, next)
}
