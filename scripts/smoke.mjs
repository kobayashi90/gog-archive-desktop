// Smoke test: boot the production Electron app headful, exercise the IPC
// surface, verify fonts/theme, and screenshot every tab.
// Run: node scripts/smoke.mjs   (needs a display session)
import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'smoke-shots')
const XDG = '/tmp/opencode/gog-smoke-xdg'

fs.rmSync(SHOTS, { recursive: true, force: true })
fs.mkdirSync(SHOTS, { recursive: true })
fs.rmSync(XDG, { recursive: true, force: true })
// isolate the persist dir too: engine persistence lives IN the download dir
// (Rust parity), so without this smoke would read the real ~/Downloads queue
fs.mkdirSync(path.join(XDG, 'gog-archive'), { recursive: true })
fs.writeFileSync(path.join(XDG, 'gog-archive', 'config.json'),
  JSON.stringify({ download_dir: '/tmp/opencode/gog-smoke-dl' }))

const app = await electron.launch({
  executablePath: electronPath,
  args: [path.join(ROOT, 'electron', 'main.js')],
  env: { ...process.env, XDG_CONFIG_HOME: XDG }
})

const consoleErrors = []
const unwrap = r => { if (!r.ok) throw new Error(r.e); return r.v }

try {
  const page = await app.firstWindow()
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => consoleErrors.push(String(e)))

  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.gog !== 'undefined')
  await page.waitForTimeout(1200)

  // --- IPC surface ---------------------------------------------------------
  const settings = await page.evaluate(() => window.gog.invoke('get_settings').then(r => r.ok ? r.v : Promise.reject(r.e)))
  console.log('settings.download_dir =', settings.download_dir)
  assert.equal(typeof settings.max_peers, 'number')

  const saved = await page.evaluate(max => window.gog.invoke('save_settings', { settings: { max_peers: max } }).then(r => r.ok ? r.v : Promise.reject(r.e)), 250)
  assert.equal(saved, null)
  const s2 = await page.evaluate(() => window.gog.invoke('get_settings').then(r => r.v))
  assert.equal(s2.max_peers, 250, 'save_settings roundtrip')

  const st = await page.evaluate(() => window.gog.invoke('torrent_status_all').then(r => r.v))
  assert.ok(Array.isArray(st) && st.length === 0, 'empty status list')

  const lib = await page.evaluate(() => window.gog.invoke('torrent_library').then(r => r.v))
  assert.ok(Array.isArray(lib), 'library returns array')

  const filters = await page.evaluate(() => window.gog.invoke('get_filters').then(r => r.v))
  console.log('filters.genres =', Array.isArray(filters.genres) ? filters.genres.length + ' genres' : 'MISSING')

  // --- theme / fonts -------------------------------------------------------
  const fonts = await page.evaluate(async () => {
    // force-load both faces (check() alone returns false for unused faces)
    await Promise.all([
      document.fonts.load('400 14px Inter'),
      document.fonts.load('600 20px "Bricolage Grotesque"')
    ])
    return {
      inter: document.fonts.check('400 14px Inter'),
      bricolage: document.fonts.check('600 20px "Bricolage Grotesque"'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
    }
  })
  console.log('fonts/theme:', JSON.stringify(fonts))
  assert.ok(fonts.inter && fonts.bricolage, 'fonts loaded')
  assert.equal(fonts.bg, '#08080a')

  // --- screenshots of every tab -------------------------------------------
  await page.screenshot({ path: path.join(SHOTS, 'browse.png') })
  for (const label of ['Downloads', 'Library', 'Settings']) {
    await page.click(`.nav-tab:has-text("${label}")`)
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(SHOTS, `${label.toLowerCase()}.png`) })
  }

  // --- error triage --------------------------------------------------------
  const real = consoleErrors.filter(e => !/favicon|Download the React DevTools/i.test(e))
  if (real.length) {
    console.log('CONSOLE ERRORS:')
    for (const e of real) console.log(' -', e)
  } else {
    console.log('console errors: none')
  }
  assert.equal(real.length, 0, 'no console errors')

  console.log('SMOKE OK')
} finally {
  await app.close()
}
