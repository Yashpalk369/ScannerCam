import { readFileSync } from 'node:fs'
import tools from '../src/content/tools.json' with { type: 'json' }
import { renderSiteHeader } from '../src/components/Layout/siteShell.mjs'
const escape = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
export { tools }
export function renderToolHtml(html, tool) {
  const url = `https://www.scanner.cam${tool.path}`
  html = html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escape(tool.title)}</title>`)
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
    .replace(/<meta name="keywords"[^>]*>/, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/(<link rel="canonical" href=")[^"]+/, `$1${url}`)
  html = html.replace(
    /<meta (name|property)="([^"]+)" content="[^"]*"\s*\/?>/g,
    (tag, attr, key) => {
      const value = ['title', 'og:title', 'twitter:title'].includes(key)
        ? tool.title
        : ['description', 'og:description', 'twitter:description'].includes(key)
          ? tool.description
          : ['og:url', 'twitter:url'].includes(key)
            ? url
            : null
      return value ? `<meta ${attr}="${key}" content="${escape(value)}">` : tag
    },
  )
  const graph = [
    {
      '@type': 'WebPage',
      '@id': `${url}#page`,
      url,
      name: tool.heading,
      description: tool.description,
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: 'https://www.scanner.cam/',
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Tools',
          item: 'https://www.scanner.cam/tools',
        },
        ...(tool.path === '/tools'
          ? []
          : [
              {
                '@type': 'ListItem',
                position: 3,
                name: tool.heading,
                item: url,
              },
            ]),
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: tool.faqs.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ]
  if (tool.path !== '/tools')
    graph.push({
      '@type': 'WebApplication',
      name: tool.heading,
      url,
      description: tool.description,
      applicationCategory:
        tool.workspace === 'scanner'
          ? 'ProductivityApplication'
          : 'MultimediaApplication',
      operatingSystem: 'Web browser',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    })
  html = html.replace(
    '</head>',
    `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replaceAll('<', '\\u003c')}</script></head>`,
  )
  const header = readFileSync(
    new URL('../src/components/Layout/site-header.html', import.meta.url),
    'utf8',
  )
  const footer = readFileSync(
    new URL('../src/components/Layout/site-footer.html', import.meta.url),
    'utf8',
  )
  // A small first-paint shell prevents the static SEO article flashing before React loads.
  // The original text stays available to crawlers and to visitors without JavaScript.
  html = html.replace('<head>', `<head><script>document.documentElement.classList.add('tool-js');setTimeout(function(){var loading=document.querySelector('[data-tool-loading]');if(loading){document.documentElement.classList.remove('tool-js');var error=document.querySelector('[data-tool-error]');if(error)error.hidden=false}},15000)</script><style>.tool-loading{display:none}.tool-js .tool-loading{display:block}.tool-js .tool-static-fallback{display:none}.tool-loading{margin:24px 0;padding:44px 24px;border:1px solid #dbe4ed;border-radius:18px;background:#fff;text-align:center;color:#475569}.tool-loading-indicator{width:38px;height:38px;margin:0 auto 16px;border:4px solid #d1fae5;border-top-color:#047857;border-radius:50%;animation:tool-spin 1s linear infinite}@keyframes tool-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.tool-loading-indicator{animation:none}}</style>`)
  const links = [{ path: '/', heading: 'Document scanner' }, ...tools.filter((t) => t.path !== tool.path)].map((t) => `<p><a href="${t.path}">${escape(t.heading)}</a></p>`).join('')
  const fallback = `<div class="tool-static-fallback"><noscript><p>The interactive tool needs JavaScript enabled.</p></noscript><p data-tool-error hidden role="alert">The tool could not load. Check your connection and refresh the page.</p><nav aria-label="Tools">${links}</nav><h2>How to use this tool</h2><ol>${tool.steps.map((s) => `<li>${escape(s)}</li>`).join('')}</ol><h2>Frequently asked questions</h2>${tool.faqs.map(({ q, a }) => `<h3>${escape(q)}</h3><p>${escape(a)}</p>`).join('')}</div>`
  const content = `${renderSiteHeader(header, tool.path, false)}<main style="max-width:960px;margin:auto;padding:32px 20px"><h1>${escape(tool.heading)}</h1><p>${escape(tool.intro)}</p><div class="tool-loading" data-tool-loading role="status"><div class="tool-loading-indicator" aria-hidden="true"></div>Loading tool…</div>${fallback}</main>${footer}`
  const start = html.indexOf('<div id="app">')
  const end = html.indexOf('<script type="module"', start)
  // Built Vite HTML moves module scripts into head; use the final app closing tag instead.
  const bodyEnd = html.lastIndexOf('</body>')
  return (
    html.slice(0, start) +
    `<div id="app">${content}</div>\n` +
    (end >= 0 ? html.slice(end) : html.slice(bodyEnd))
  )
}
