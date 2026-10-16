import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const content = JSON.parse(readFileSync('src/content/homepage.json', 'utf8')) as { heading: string; faqs: { q: string; a: string }[] }

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, route => route.abort())
})

test('the rendered homepage, initial HTML and FAQ schema use the same factual answers', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Upload Images', exact: true })).toBeEnabled()
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.locator('h1')).toHaveText(content.heading)
  const source = readFileSync('index.html', 'utf8')
  const initial = await page.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const graphs = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(script => JSON.parse(script.textContent!)['@graph'] ?? [])
    return {
      heading: document.querySelector('#seo-fallback h1')?.textContent,
      answers: [...document.querySelectorAll('.fallback-faq-answer')].map(answer => answer.textContent),
      questions: [...document.querySelectorAll('.fallback-faq strong')].map(question => question.textContent),
      schema: graphs.find(node => node['@type'] === 'FAQPage').mainEntity,
    }
  }, source)
  expect(initial.heading).toBe(content.heading)
  expect(initial.questions).toEqual(content.faqs.map(faq => faq.q))
  expect(initial.answers).toEqual(content.faqs.map(faq => faq.a))
  expect(initial.schema.map((question: any) => ({ q: question.name, a: question.acceptedAnswer.text }))).toEqual(content.faqs.map(({ q, a }) => ({ q, a })))
  await expect(page.locator('#faq .faq-question')).toHaveCount(content.faqs.length)
  for (const [index, faq] of content.faqs.entries()) {
    const button = page.locator('#faq').getByRole('button', { name: faq.q, exact: true })
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(`#faq-answer-${index} > p`).first()).toHaveText(faq.a)
  }
  expect(content.faqs.find(faq => faq.q.includes('OCR'))?.a).toContain('Yes.')
  expect(content.faqs.find(faq => faq.q.includes('OCR'))?.a).toContain('English')
  expect(content.faqs.find(faq => faq.q.includes('limit'))?.a).toContain('memory')
})

test('the initial HTML FAQ has a working anchor without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: { width: 390, height: 844 } })
  try {
    const page = await context.newPage()
    await page.route(/^https:\/\/(fonts\.(googleapis|gstatic)\.com|www\.googletagmanager\.com)\//, route => route.abort())
    await page.goto('/')
    await page.locator('.site-navigation').getByRole('link', { name: 'FAQ', exact: true }).click()
    await expect(page.locator('#faq')).toBeInViewport()
    await expect(page.locator('.fallback-faq-answer')).toHaveCount(content.faqs.length)
  } finally { await context.close() }
})
