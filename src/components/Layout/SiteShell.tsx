import header from './site-header.html?raw'
import footer from './site-footer.html?raw'
import { renderSiteHeader } from './siteShell.mjs'

// Trusted local templates are also rendered into the public HTML pages at build time.
export function SiteHeader() {
  return <div className="site-shell-fragment" dangerouslySetInnerHTML={{ __html: renderSiteHeader(header, '/', false) }} />
}

export function SiteFooter() {
  return <div className="site-shell-fragment" dangerouslySetInnerHTML={{ __html: footer }} />
}
