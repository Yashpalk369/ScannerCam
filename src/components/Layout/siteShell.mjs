// Shared by the React shell and the static-page generator. Inputs are local templates.
export function renderSiteHeader(template, pagePath = '/', brandHeading = pagePath === '/') {
  const header = template
    .replace('{{SCANNER_CURRENT}}', pagePath === '/' ? ' aria-current="page"' : '')
    .replace('{{GUIDES_CURRENT}}', pagePath.startsWith('/blog') ? ' aria-current="page"' : '')
  return brandHeading
    ? header.replace('<span class="brand-name">Scanner<span>.cam</span></span>', '<h1 class="brand-name">Scanner<span>.cam</span></h1>')
    : header
}
