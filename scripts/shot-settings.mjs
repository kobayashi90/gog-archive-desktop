// One-off: screenshot the Settings tab to eyeball the new Advanced fields.
import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const XDG = '/tmp/opencode/gog-shot-xdg'
fs.rmSync(XDG, { recursive: true, force: true })
fs.mkdirSync(path.join(XDG, 'gog-archive'), { recursive: true })
fs.writeFileSync(path.join(XDG, 'gog-archive', 'config.json'),
  JSON.stringify({ download_dir: '/tmp/opencode/gog-shot-dl' }))

const app = await electron.launch({
  executablePath: electronPath,
  args: [path.join(ROOT, 'electron', 'main.js')],
  env: { ...process.env, XDG_CONFIG_HOME: XDG }
})

try {
  const page = await app.firstWindow()
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.gog !== 'undefined')
  await page.waitForTimeout(1200)
  await page.click('text=Settings')
  await page.waitForTimeout(500)
  await page.screenshot({ path: '/tmp/opencode/settings-new.png' })
  // functional roundtrip: change the three new fields, save, read config back
  await page.selectOption('select', 'prealloc')
  await page.locator('label:has-text("Download retries") input').fill('7')
  await page.locator('label:has-text("Retry wait") input').fill('12')
  await page.click('text=Save Settings')
  await page.waitForTimeout(600)
  const cfg = JSON.parse(fs.readFileSync(path.join(XDG, 'gog-archive', 'config.json'), 'utf8'))
  console.log('saved:', JSON.stringify({
    file_allocation: cfg.file_allocation,
    max_tries: cfg.max_tries,
    retry_wait: cfg.retry_wait
  }))
  console.log(cfg.file_allocation === 'prealloc' && cfg.max_tries === 7 && cfg.retry_wait === 12
    ? 'ROUNDTRIP OK' : 'ROUNDTRIP FAIL')
  console.log('console errors:', errors.length ? errors : 'none')
  console.log('shot ok')
} finally {
  await app.close()
}
