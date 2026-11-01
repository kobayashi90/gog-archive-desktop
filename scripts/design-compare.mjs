// A/B design comparison: redesign site (:8399) vs the Electron app.
// Screenshots the game-detail modal + advanced-search dialog from both.
// Usage: node scripts/design-compare.mjs   (site server must be on :8399)
import { _electron as electron, chromium } from 'playwright'
import electronPath from 'electron'
import path from 'node:path'
import fs from 'node:fs'

const ROOT = '/home/lain/opencode/gog-archive-electron'
const SHOTS = '/tmp/opencode/design-shots'
const SLUG = 'the_witcher'

fs.rmSync(SHOTS, { recursive: true, force: true })
fs.mkdirSync(SHOTS, { recursive: true })

const scrollModalBottom = () => {
  const m = document.querySelector('.modal-content')
  if (m) m.scrollTop = m.scrollHeight
}

// ---------- site (redesign dev server) ----------
const browser = await chromium.launch()
try {
  const p = await browser.newPage({ viewport: { width: 1400, height: 850 } })
  await p.goto(`http://localhost:8399/game/${SLUG}`, { waitUntil: 'networkidle', timeout: 20000 })
  await p.waitForSelector('.modal-content', { timeout: 15000 })
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(800)
  await p.locator('.modal-content').screenshot({ path: path.join(SHOTS, 'site-modal.png') })
  await p.evaluate(scrollModalBottom)
  await p.waitForTimeout(300)
  await p.locator('.modal-content').screenshot({ path: path.join(SHOTS, 'site-modal-bottom.png') })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  await p.click('.adv-btn')
  await p.waitForSelector('.adv-pills', { timeout: 10000 })
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(600)
  await p.locator('.modal-content').screenshot({ path: path.join(SHOTS, 'site-adv.png') })
  console.log('[site] shots done')
} finally {
  await browser.close()
}

// ---------- app (electron, isolated XDG) ----------
const app = await electron.launch({
  executablePath: electronPath,
  args: [path.join(ROOT, 'electron', 'main.js')],
  env: { ...process.env, XDG_CONFIG_HOME: '/tmp/opencode/gog-compare-xdg' }
})
try {
  const p = await app.firstWindow()
  await p.waitForFunction(() => typeof window.gog !== 'undefined', null, { timeout: 30000 })
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(1000)

  await p.fill('#search', 'The Witcher: Enhanced')
  await p.waitForTimeout(2000)
  await p.click('.game-card:has-text("The Witcher: Enhanced Edition")')
  await p.waitForSelector('.modal-content', { timeout: 15000 })
  await p.waitForTimeout(1500)
  await p.locator('.modal-content').screenshot({ path: path.join(SHOTS, 'app-modal.png') })
  await p.evaluate(scrollModalBottom)
  await p.waitForTimeout(300)
  await p.locator('.modal-content').screenshot({ path: path.join(SHOTS, 'app-modal-bottom.png') })
  await p.keyboard.press('Escape')
  await p.waitForTimeout(400)
  await p.click('.adv-btn')
  await p.waitForSelector('.adv-pills', { timeout: 10000 })
  await p.waitForTimeout(800)
  await p.locator('.modal-content').screenshot({ path: path.join(SHOTS, 'app-adv.png') })
  console.log('[app] shots done')
} finally {
  await app.close()
}

console.log('DONE →', SHOTS)
