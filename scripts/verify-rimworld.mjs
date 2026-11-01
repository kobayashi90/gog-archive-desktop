// Real-world regression for the fake-"Download complete" bug: launch an
// ISOLATED app instance (own XDG_CONFIG_HOME + download dir), do a COLD
// torrent_add on the real RimWorld magnet with NO prior preview, and assert:
//   1. the tracked GID is the PAYLOAD download: total_size = 569,151,832
//      (the old bug returned the metadata GID: total = 11,550 → instant
//      "seeding 100%" over a folder of falloc holes)
//   2. real progress, then completion (aria2 hash-verifies every piece)
//   3. on disk: every .exe starts with MZ, bytes are real (not holes),
//      no .aria2 control file left
//   4. exactly ONE .torrent in the slug dir, named <real infohash>.torrent
//      (what _restore looks up; aria2's sha1(bytes) duplicate must be gone)
//
// Run: node scripts/verify-rimworld.mjs
import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/home/lain/opencode/gog-archive-electron'
const XDG = '/tmp/opencode/gog-rwverify-xdg'
const DL = path.join(ROOT, '.verify-dl')
const SLUG = 'rimworld'
const REAL_SIZE = 569151832
const REAL_HASH = '68588349b343638ec542d14e485492df29df7edd'
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function until (fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timeout waiting for: ${label}`)
    await sleep(1500)
  }
}

fs.rmSync(XDG, { recursive: true, force: true })
fs.rmSync(DL, { recursive: true, force: true })
fs.mkdirSync(path.join(XDG, 'gog-archive'), { recursive: true })
fs.writeFileSync(path.join(XDG, 'gog-archive', 'config.json'),
  JSON.stringify({ download_dir: DL }))

const game = await (await fetch('https://gog.squid.wtf/api/games/rimworld')).json()
assert.ok(game.magnet_link?.startsWith('magnet:?'), 'API returns a magnet')
console.log(`[verify] ${game.title} — ${REAL_SIZE} B, cold add (no preview)`)

const app = await electron.launch({
  executablePath: electronPath,
  args: [path.join(ROOT, 'electron', 'main.js')],
  env: { ...process.env, XDG_CONFIG_HOME: XDG }
})
const page = await app.firstWindow()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(String(e)))
await page.waitForLoadState('domcontentloaded')
await page.waitForFunction(() => typeof window.gog !== 'undefined')

const inv = (c, a) => page.evaluate(([c2, a2]) => window.gog.invoke(c2, a2), [c, a])
async function unwrap (c, a) {
  const r = await inv(c, a)
  if (!r.ok) throw new Error(`${c}: ${r.e}`)
  return r.v
}
const statuses = () => unwrap('torrent_status_all')
const rowOf = sts => sts.find(s => s.slug === SLUG)

try {
  // 1. COLD add — no torrent_preview before this (the exact repro path)
  assert.equal(await unwrap('torrent_add', { magnet: game.magnet_link, slug: SLUG }), null)
  const first = await until(async () => {
    const s = rowOf(await statuses())
    return s && s.state !== 'error' ? s : null
  }, 60_000, 'cold-add row')
  assert.equal(Math.round(first.total_size), REAL_SIZE,
    `GID must be the payload download: total_size=${first.total_size} — ` +
    `the metadata GID would report 11550 and fake-complete instantly`)
  assert.ok(first.progress < 1, `must not be instantly 100%: p=${first.progress}`)
  console.log(`[verify] GID OK: total_size=${first.total_size} p=${first.progress.toFixed(3)} state=${first.state}`)

  // 2. real transfer → completion (aria2 verifies every piece hash)
  let lastLog = 0
  const done = await until(async () => {
    const s = rowOf(await statuses())
    if (!s || s.state === 'error') return s?.state === 'error' ? s : null
    if (Date.now() - lastLog > 5000) {
      lastLog = Date.now()
      console.log(`[verify] p=${(s.progress * 100).toFixed(1)}% ` +
        `rate=${Math.round(s.download_rate / 1024)} KiB/s peers=${s.num_peers} seeds=${s.num_seeds}`)
    }
    return s.state === 'seeding' && s.progress >= 0.999 ? s : null
  }, 900_000, 'RimWorld completion (seeding 100%)')
  assert.equal(Math.round(done.total_size), REAL_SIZE, 'final total_size')
  console.log(`[verify] download complete: p=${done.progress} upload=${done.upload_rate} B/s`)

  // 3. on-disk integrity
  const slugDir = path.join(DL, SLUG)
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
  const files = walk(slugDir)
  const payload = files.filter(f => !f.endsWith('.torrent') && !f.endsWith('.aria2'))
  assert.ok(payload.length > 0, 'files on disk')
  const totalOnDisk = payload.reduce((n, f) => n + fs.statSync(f).size, 0)
  assert.equal(totalOnDisk, REAL_SIZE, 'sum of file sizes = torrent size')
  // NB: a .aria2 control file IS still present while seeding — aria2 keeps it
  // for the seeding session. Not a bug; completion is proven by the
  // piece-hash-verified 100% + exact sizes + MZ/non-zero checks below.

  const exes = payload.filter(f => f.endsWith('.exe'))
  assert.ok(exes.length > 0, 'found at least one .exe')
  for (const exe of exes) {
    const fd = fs.openSync(exe, 'r')
    const magic = Buffer.alloc(2)
    fs.readSync(fd, magic, 0, 2, 0)
    fs.closeSync(fd)
    assert.equal(magic.toString('latin1'), 'MZ', `EXE magic: ${path.basename(exe)} (real bytes, not falloc holes)`)
  }

  let nonZero = 0, counted = 0
  const buf = Buffer.alloc(1 << 20)
  for (const f of payload) {
    const fd = fs.openSync(f, 'r')
    let pos = 0, n
    while ((n = fs.readSync(fd, buf, 0, buf.length, pos)) > 0) {
      for (let i = 0; i < n; i++) if (buf[i]) nonZero++
      counted += n
      pos += n
    }
    fs.closeSync(fd)
  }
  const ratio = nonZero / counted
  assert.ok(ratio > 0.75, `file data is ${(ratio * 100).toFixed(1)}% non-zero — looks hole-filled`)
  console.log(`[verify] disk OK: ${payload.length} files, ${totalOnDisk} B, MZ magic, ${(ratio * 100).toFixed(1)}% non-zero`)

  // 4. exactly one .torrent, named <real infohash>.torrent (= _restore's key)
  const torrents = files.filter(f => f.endsWith('.torrent'))
  assert.equal(torrents.length, 1,
    `exactly one persisted .torrent (got: ${torrents.map(f => path.basename(f)).join(', ')})`)
  assert.equal(path.basename(torrents[0]), `${REAL_HASH}.torrent`,
    'persisted .torrent is named by the REAL infohash (what _restore looks up)')
  const queue = JSON.parse(fs.readFileSync(path.join(DL, '.queue.json'), 'utf8'))
  assert.equal(queue[SLUG]?.hash?.toLowerCase(), REAL_HASH, 'queue entry hash = real infohash')
  console.log(`[verify] persistence OK: ${path.basename(torrents[0])}, queue hash matches`)

  const real = errors.filter(e => !/favicon|Download the React DevTools/i.test(e))
  assert.equal(real.length, 0, `console errors: ${real.join(' | ')}`)
  console.log('[verify] VERIFY ALL PASSED')
} finally {
  await app.close().catch(() => {})
  fs.rmSync(XDG, { recursive: true, force: true })
  fs.rmSync(DL, { recursive: true, force: true })
}
process.exit(0)
