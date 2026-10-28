import tools from '../../content/tools.json' with { type: 'json' }
// Shared by the React shell and the static-page generator. Inputs are local templates.
export function renderSiteHeader(template, pagePath = '/', brandHeading = pagePath === '/') {
  let header = template
    .replace('{{TOOLS_CURRENT}}', tools.some(tool => tool.path === pagePath) ? ' aria-current="page"' : '')
    .replace('{{GUIDES_CURRENT}}', pagePath.startsWith('/blog') ? ' aria-current="page"' : '')
  if (pagePath === '/') header = header.replace(/\s*<a class="site-open-scanner" href="\/">Open Scanner<\/a>/, '')
  return brandHeading
    ? header.replace('<span class="brand-name">Scanner<span>.cam</span></span>', '<h1 class="brand-name">Scanner<span>.cam</span></h1>')
    : header
}
