// Temp: design-parity screenshots — app (isolated electron) vs live site.
// Usage: node scripts/shot-design.mjs
import { _electron as electron } from 'playwright'
import { chromium } from 'playwright'
import electronPath from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = '/tmp/opencode/design-shots'
const XDG = '/tmp/opencode/gog-shot-xdg'
const QUERY = 'stellaris'

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
fs.rmSync(XDG, { recursive: true, force: true })
fs.mkdirSync(path.join(XDG, 'gog-archive'), { recursive: true })
fs.writeFileSync(path.join(XDG, 'gog-archive', 'config.json'),
  JSON.stringify({ download_dir: '/tmp/opencode/gog-shot-dl' }))

async function shootDialog(page, tag) {
  // wait for cover image (if any) to finish loading
  await page.waitForTimeout(600)
  await page.evaluate(async () => {
    await Promise.all([...document.images].filter(i => !i.complete).map(i => new Promise(r => { i.onload = i.onerror = r })))
  })
  const box = page.locator('.modal-content')
  await box.screenshot({ path: path.join(OUT, `${tag}-modal-top.png`) })
  // scroll the dialog's inner scroll to the bottom for the files/links section
  await page.evaluate(() => { const m = document.querySelector('.modal-content'); if (m) m.scrollTop = m.scrollHeight })
  await page.waitForTimeout(300)
  await box.screenshot({ path: path.join(OUT, `${tag}-modal-bottom.png`) })
}

// ---------- app (electron) ----------
{
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(ROOT, 'electron', 'main.js')],
    env: { ...process.env, XDG_CONFIG_HOME: XDG }
  })
  const errors = []
  try {
    const page = await app.firstWindow()
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', e => errors.push(String(e)))
    await page.waitForFunction(() => typeof window.gog !== 'undefined')
    await page.waitForTimeout(1200)

    // detail modal
    await page.fill('#search', QUERY)
    await page.waitForSelector('.game-card', { timeout: 20000 })
    await page.waitForTimeout(800)
    await page.click('.game-card')
    await page.waitForSelector('.modal-content.detail', { timeout: 10000 })
    await shootDialog(page, 'app-detail')
    await page.keyboard.press('Escape')
    await page.waitForSelector('.modal-content', { state: 'detached', timeout: 5000 })

    // adv dialog
    await page.click('.adv-btn')
    await page.waitForSelector('.adv-footer', { timeout: 10000 })
    await page.waitForTimeout(1800)
    await page.locator('.modal-content').screenshot({ path: path.join(OUT, 'app-adv.png') })
    // chip demo: select a genre pill so chips+active pills are visible
    await page.click('.adv-pill')
    await page.waitForTimeout(250)
    await page.locator('.modal-content').screenshot({ path: path.join(OUT, 'app-adv-active.png') })
    console.log('[app] console errors:', errors.length ? errors : 'none')
  } finally {
    await app.close()
  }
}

// ---------- live site (chromium) ----------
{
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
    await page.goto('https://gog.squid.wtf/', { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('.game-card', { timeout: 30000 })
    await page.fill('#search', QUERY)
    await page.waitForFunction(q => {
      const c = document.querySelector('.game-card .card-title, .game-card')
      return c && document.querySelectorAll('.game-card').length > 0
    }, QUERY, { timeout: 20000 })
    await page.waitForTimeout(800)
    await page.click('.game-card')
    await page.waitForSelector('.modal-content.detail', { timeout: 10000 })
    await shootDialog(page, 'site-detail')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    await page.click('.adv-btn')
    await page.waitForSelector('.adv-footer', { timeout: 10000 })
    await page.waitForTimeout(500)
    await page.locator('.modal-content').screenshot({ path: path.join(OUT, 'site-adv.png') })
    await page.click('.adv-pill')
    await page.waitForTimeout(250)
    await page.locator('.modal-content').screenshot({ path: path.join(OUT, 'site-adv-active.png') })
  } finally {
    await browser.close()
  }
}

console.log('SHOTS OK →', OUT)
