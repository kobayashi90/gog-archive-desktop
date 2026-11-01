// Dev-mode smoke: VITE_DEV=1 boots its own vite on :1420 and loads it.
// Verifies the dev page renders, then checks teardown kills the vite child.
import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = '/home/lain/opencode/gog-archive-electron'
const app = await electron.launch({
  executablePath: electronPath,
  args: [path.join(ROOT, 'electron', 'main.js')],
  env: { ...process.env, VITE_DEV: '1', XDG_CONFIG_HOME: '/tmp/opencode/gog-dev-smoke-xdg' }
})
try {
  const page = await app.firstWindow()
  await page.waitForFunction(() => typeof window.gog !== 'undefined', null, { timeout: 30000 })
  await page.waitForTimeout(2500)
  const st = await page.evaluate(() => ({
    url: location.href,
    bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
    cards: document.querySelectorAll('.card, .game-card').length
  }))
  console.log('DEV STATE:', JSON.stringify(st))
  if (!st.url.startsWith('http://localhost:1420')) throw new Error('not on vite URL: ' + st.url)
  if (st.bg !== '#08080a') throw new Error('theme not applied in dev')
  console.log('DEV SMOKE OK')
} finally {
  await app.close()
}
// teardown check: vite child must be gone
execSync('sleep 2')
try {
  execSync("curl -s -o /dev/null -m 2 http://localhost:1420/ && exit 1 || exit 0", { shell: '/bin/sh' })
  console.log('teardown: port 1420 down ✓')
} catch {
  throw new Error('stray vite left running after quit')
}
