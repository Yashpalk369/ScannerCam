import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const paths = [...readFileSync('public/sitemap.xml', 'utf8').matchAll(/<loc>(.*?)<\/loc>/g)].map(match => new URL(match[1]).pathname)

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, route => route.abort())
})

async function branding(page: Page) {
  return page.evaluate(() => {
    const selectors = ['.site-header', '.site-header-inner', '.site-header .brand-icon', '.site-header .brand-name', '.site-header .brand-tagline', '.site-navigation', '.site-footer-inner', '.site-footer .brand-icon', '.site-footer .brand-name']
    return Object.fromEntries(selectors.map(selector => {
      const element = document.querySelector<HTMLElement>(selector)!
      const css = getComputedStyle(element)
      return [selector, { font: css.fontFamily, size: css.fontSize, weight: css.fontWeight, lineHeight: css.lineHeight, color: css.color, background: css.backgroundColor, display: css.display, margin: css.margin, padding: css.padding, height: element.getBoundingClientRect().height, width: selector === '.site-navigation' ? undefined : element.getBoundingClientRect().width }]
    }))
  })
}

test('all pages share the same header, logo, typography and footer on mobile and desktop', async ({ page }) => {
  test.setTimeout(90000)
  for (const width of [390, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeEnabled()
    const expected = await branding(page)
    const footer = await page.locator('.site-footer').innerText()
    for (const path of paths.filter(path => path !== '/')) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('.site-header')).toHaveCount(1)
      await expect(page.locator('.site-footer')).toHaveCount(1)
      expect(await branding(page), `${path} at ${width}px`).toEqual(expected)
      expect(await page.locator('.site-footer').innerText(), path).toBe(footer)
      await expect(page.locator('.site-navigation').getByRole('link', { name: 'Guides', exact: true })).toBeVisible()
      await expect(page.locator('.site-navigation').getByRole('link', { name: 'FAQ', exact: true })).toBeVisible()
    }
  }
})

test('navigation between scanner, guides, an article and a company page keeps branding consistent', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeEnabled()
  await expect(page.locator('.site-navigation a[aria-current=page]')).toHaveCount(0)
  const before = await branding(page)
  await page.locator('.site-navigation').getByRole('link', { name: 'Guides', exact: true }).click()
  await expect(page).toHaveURL(/\/blog$/)
  await expect(page.locator('.site-navigation a[aria-current=page]')).toHaveText('Guides')
  await page.locator('.card').first().click()
  await expect(page).toHaveURL(/\/blog\/how-to-scan-documents-iphone-without-app$/)
  expect(await branding(page)).toEqual(before)
  await page.locator('.site-footer').getByRole('link', { name: 'About', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'About Scanner.cam', exact: true })).toBeVisible()
  expect(await branding(page)).toEqual(before)
  await page.locator('.site-header').getByRole('link', { name: 'Scanner.cam home', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeEnabled()
  expect(await branding(page)).toEqual(before)
})
