// Run against `npm run preview`; install Playwright and its Chromium first.
// CODEX_PRIMARY_RUNTIME_NODE_MODULES may provide Playwright in managed environments.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? `${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright` : 'playwright')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] })
const output = process.env.BODY_SELECTION_ARTIFACTS ?? '/tmp/body-selection-artifacts'
await mkdir(output, { recursive: true })
try {
  for (const width of [320, 390, 500, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem('3bp-language', 'ko')
      localStorage.setItem('3bp-body-count', '6')
      localStorage.setItem('3bp-preset', 'hexaNested')
    })
    await page.goto(process.env.BODY_SELECTION_TEST_URL ?? 'http://127.0.0.1:4173/3BP/')
    const rail = page.locator('.body-tracking-button')
    const cards = page.locator('.body-card')
    await page.waitForFunction(() => document.querySelectorAll('.body-card').length === 6)
    const onlyOpen = async index => {
      await page.waitForFunction(index => {
        const cards = [...document.querySelectorAll('.body-card')]
        return cards.every((card, i) => card.open === (i === index))
      }, index)
    }
    console.log(`${width}px: loaded`)
    await rail.nth(0).click()
    await onlyOpen(0)
    await page.waitForFunction(() => document.querySelector('.tracked-body-detail')?.textContent.includes('진화 단계'))
    await rail.nth(1).click()
    await onlyOpen(1)
    await page.locator('.panel-toggle').click()
    await rail.nth(2).click()
    await onlyOpen(2)
    assert.equal(await page.locator('.panel-toggle').getAttribute('aria-expanded'), 'false')
    await page.locator('.panel-toggle').click()
    await onlyOpen(2)
    await cards.nth(2).locator('summary').click()
    await page.waitForFunction(() => !document.querySelectorAll('.body-card')[2].open)
    // Clicking the same rail entry still opens its information (tracking toggles off).
    await rail.nth(2).click()
    await onlyOpen(2)
    await rail.nth(2).click()
    await onlyOpen(2)
    console.log(`${width}px: selection/collapse passed`)
    await cards.nth(2).locator('.body-type-row select').selectOption('star')
    const stage = cards.nth(2).locator('.stellar-select-row select')
    await stage.selectOption('whiteDwarf')
    await page.waitForFunction(() => document.querySelector('.tracked-body-detail b')?.textContent === '백색왜성')
    for (const type of ['planet', 'moon']) {
      await cards.nth(2).locator('.body-type-row select').selectOption(type)
      const surface = cards.nth(2).locator('.surface-editor select').first()
      // Select a long preset to verify mobile wrapping.
      const preset = type === 'planet' ? 'gasGiantJupiterLike' : 'enceladusBrightIce'
      await surface.selectOption(preset)
      const expected = await surface.locator('option:checked').textContent()
      await page.waitForFunction(expected => document.querySelector('.tracked-body-detail b')?.textContent === expected, expected)
      const bounds = await page.locator('.tracked-body-detail').evaluate(el => {
        const rect = el.getBoundingClientRect()
        return { left: rect.left, right: rect.right, scroll: el.scrollWidth, client: el.clientWidth }
      })
      assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.scroll <= bounds.client + 1)
    }
    await page.locator('.panel-toggle').click()
    await page.screenshot({ path: `${output}/selected-moon-${width}.png` })
    await page.locator('.language-picker select').selectOption('en')
    await page.waitForFunction(() => document.querySelector('.tracked-body-detail b')?.textContent === 'Enceladus bright ice')
    assert.deepEqual(errors, [])
    await page.close()
    console.log(`body selection UI passed: ${width}px`)
  }
} catch (error) {
  for (const page of browser.contexts().flatMap(context => context.pages())) {
    await page.screenshot({ path: `${output}/failure.png` }).catch(() => {})
  }
  throw error
} finally {
  await browser.close()
}
