import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const site = 'https://www.scanner.cam'
const paths = [...readFileSync('public/sitemap.xml', 'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(match => new URL(match[1]).pathname)

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, route => route.abort())
})

test('every sitemap page has one branded footer, working images and no mobile overflow', async ({ page }) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const path of paths) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    const footer = page.locator(path === '/' ? '.app-footer' : '.site-footer')
    await expect(footer, path).toHaveCount(1)
    await expect(footer.locator('a[href*="/blog"]'), path).toHaveCount(0)
    await expect(page.locator('header .brand-icon img'), path).toHaveAttribute('src', '/favicon.svg')
    if (path !== '/') {
      await expect(footer.locator('.brand'), path).toHaveCount(1)
      await expect(footer.locator('.footer-note'), path).toHaveCount(1)
      await expect(page.locator('h1'), path).toHaveCount(1)
      expect(await page.locator('link[rel=canonical]').getAttribute('href')).toBe(site + path)
    }
    await expect.poll(() => page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), { message: `${path} images` }).toBe(true)
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), { message: `${path} at ${width}px` }).toBe(true)
    }
  }
  expect(errors).toEqual([])
})

test('all internal link destinations and fragments resolve to the intended pages', async ({ page, request }) => {
  test.setTimeout(90000)
  const targets = new Map<string, string>()
  for (const path of paths) {
    await page.goto(path, { waitUntil: 'domcontentloaded' })
    if (path === '/') await expect(page.locator('.app-footer')).toBeAttached()
    const hrefs = await page.locator('a[href]').evaluateAll(links => links.map(link => link.getAttribute('href')!))
    for (const href of hrefs) {
      const url = new URL(href, site + path)
      if (url.origin === site) targets.set(url.pathname + url.search + url.hash, path)
    }
  }
  for (const [target, source] of targets) {
    const url = new URL(target, site)
    const response = await request.get(url.pathname + url.search)
    expect(response.ok(), `${source} → ${target}`).toBe(true)
    const html = await response.text()
    if (url.pathname !== '/') {
      expect(html, target).toContain(`href="${site}${url.pathname.replace(/\/$/, '')}"`)
      expect(html, target).not.toContain('app-shell-pre')
    }
    if (url.hash) {
      await page.goto(target, { waitUntil: 'domcontentloaded' })
      await expect(page.locator(`[id="${decodeURIComponent(url.hash.slice(1))}"]`), target).toBeAttached()
    }
  }
  expect(targets.size).toBeGreaterThan(30)
})

test('footer navigation reaches company pages and FAQ controls work with the keyboard', async ({ page }) => {
  await page.goto('/')
  await page.locator('.app-footer').getByRole('link', { name: 'Terms', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Terms of Service', exact: true })).toBeVisible()
  await page.goto('/#faq')
  const question = page.locator('.faq-question').first()
  await expect(question).toBeInViewport()
  await question.focus()
  await question.press('Enter')
  await expect(question).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#faq-answer-0')).toBeVisible()
  await question.press('Space')
  await expect(question).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#faq-answer-0')).toHaveCount(0)
  await page.goto('/contact')
  await expect(page.getByRole('link', { name: 'Hello@scanner.cam', exact: true })).toHaveAttribute('href', 'mailto:Hello@scanner.cam')
})
