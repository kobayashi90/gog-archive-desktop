// E2E for the aria2 engine — full lifecycle against a LOCAL tracker + local
// webtorrent seeders (no internet dependency for the transfer itself).
//
// Phase A (magnet flow, rate-limited): preview → add → mid-download pause →
//   app restart → restore(paused) → resume → completion → byte integrity →
//   seed-until-removed (seed_ratio=0/seed_hours=0 must NOT auto-remove).
// Phase B (torrent-file flow): multi-file add with selectedFiles [0,2] →
//   only selected files on disk → tiny seed_hours → auto seed-limit removal
//   (row disappears, slug lands in library).
// Phase C (cold-add GID regression): torrent_add with NO prior preview →
//   the tracked GID must be the PAYLOAD download (total_size = real size,
//   not the ~info-dict metadata size — aria2's addUri(magnet) returns the
//   metadata GID and the payload runs under a second, unmanaged gid); then
//   restart with the persisted <hash>.torrent deleted → restore must resolve
//   the magnet itself (and not deadlock the boot) → completion → integrity.
//
// Run: node scripts/e2e-aria2.mjs
import { _electron as electron } from 'playwright'
import electronPath from 'electron'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import WebTorrent from 'webtorrent'

const ROOT = '/home/lain/opencode/gog-archive-electron'
const TRACKER_PORT = 17420
const ANNOUNCE = `http://127.0.0.1:${TRACKER_PORT}/announce`
const XDG_A = '/tmp/opencode/gog-e2e-a-xdg'
const DL_A = '/tmp/opencode/gog-e2e-a-dl'
const XDG_B = '/tmp/opencode/gog-e2e-b-xdg'
const DL_B = '/tmp/opencode/gog-e2e-b-dl'
const XDG_C = '/tmp/opencode/gog-e2e-c-xdg'
const DL_C = '/tmp/opencode/gog-e2e-c-dl'
const SRC_DIR = '/tmp/opencode/gog-e2e-src'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const require = createRequire(path.join(ROOT, 'package.json'))
function loadPkg (name) {
  const dir = fs.readdirSync(path.join(ROOT, 'node_modules', '.pnpm')).find(d => d.startsWith(name + '@'))
  return require(path.join(ROOT, 'node_modules', '.pnpm', dir, 'node_modules', name))
}
// transitive dep with an import-only exports map — import the file directly
async function loadServer () {
  const dir = fs.readdirSync(path.join(ROOT, 'node_modules', '.pnpm')).find(d => d.startsWith('bittorrent-tracker@'))
  const p = path.join(ROOT, 'node_modules', '.pnpm', dir, 'node_modules', 'bittorrent-tracker', 'server.js')
  return (await import(p)).default
}
async function until (fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timeout waiting for: ${label}`)
    await sleep(400)
  }
}

// --- fixtures --------------------------------------------------------------
fs.rmSync(XDG_A, { recursive: true, force: true })
fs.rmSync(XDG_B, { recursive: true, force: true })
fs.rmSync(XDG_C, { recursive: true, force: true })
fs.rmSync(DL_A, { recursive: true, force: true })
fs.rmSync(DL_B, { recursive: true, force: true })
fs.rmSync(DL_C, { recursive: true, force: true })
fs.rmSync(SRC_DIR, { recursive: true, force: true })
fs.mkdirSync(path.join(XDG_A, 'gog-archive'), { recursive: true })
fs.mkdirSync(path.join(XDG_B, 'gog-archive'), { recursive: true })
fs.mkdirSync(path.join(XDG_C, 'gog-archive'), { recursive: true })
fs.mkdirSync(SRC_DIR, { recursive: true })
// Phase A: crawl at 100 kB/s so the mid-download pause is catchable
fs.writeFileSync(path.join(XDG_A, 'gog-archive', 'config.json'),
  JSON.stringify({ download_dir: DL_A, download_rate_limit: 100, dht: false, lsd: false }))
// Phase B: full speed, auto-stop seeding after ~18 s (0.005 h)
fs.writeFileSync(path.join(XDG_B, 'gog-archive', 'config.json'),
  JSON.stringify({ download_dir: DL_B, dht: false, lsd: false, seed_hours: 0.005 }))
// Phase C: cold add (no preview) — crawl at 100 kB/s so quitting
// mid-download (step 2) is catchable instead of finishing in one poll
fs.writeFileSync(path.join(XDG_C, 'gog-archive', 'config.json'),
  JSON.stringify({ download_dir: DL_C, download_rate_limit: 100, dht: false, lsd: false }))

const SIZE = 4 * 1024 * 1024
const payload = Buffer.alloc(SIZE)
for (let i = 0; i < SIZE; i++) payload[i] = (i * 31 + 7) & 0xff
payload.write('MZ', 0) // EXE magic — Phase C asserts real bytes, not falloc holes
fs.writeFileSync(path.join(SRC_DIR, 'payload.bin'), payload)

const multi = {}
for (const n of ['a', 'b', 'c']) {
  multi[n] = Buffer.alloc(1024 * 1024, n.charCodeAt(0))
  fs.writeFileSync(path.join(SRC_DIR, `${n}.bin`), multi[n])
}
const ctMod = loadPkg('create-torrent')
const createTorrent = ctMod.createTorrent || ctMod.default || ctMod
const multiTorrent = path.join(SRC_DIR, 'e2e-multi.torrent')
await new Promise((res, rej) =>
  createTorrent([path.join(SRC_DIR, 'a.bin'), path.join(SRC_DIR, 'b.bin'), path.join(SRC_DIR, 'c.bin')],
    { announce: [ANNOUNCE], name: 'e2e-multi' },
    (e, t) => e ? rej(e) : (fs.writeFileSync(multiTorrent, t), res())))

// --- local tracker + seeders ----------------------------------------------
const Server = await loadServer()
const tracker = new Server({ udp: false, ws: false })
await new Promise((res, rej) => {
  tracker.once('listening', res)
  tracker.once('error', rej)
  tracker.listen(TRACKER_PORT, '127.0.0.1')
})
console.log(`[e2e] tracker on :${TRACKER_PORT}`)

const seeder = new WebTorrent()
// webtorrent's seed callback is (torrent) — NOT (err, torrent)
const seededA = await new Promise(res =>
  seeder.seed(path.join(SRC_DIR, 'payload.bin'), { announce: [ANNOUNCE] }, t => res(t)))
const seededB = await new Promise(res =>
  seeder.seed([path.join(SRC_DIR, 'a.bin'), path.join(SRC_DIR, 'b.bin'), path.join(SRC_DIR, 'c.bin')],
    { announce: [ANNOUNCE], name: 'e2e-multi' }, t => res(t)))
const MAGNET_A = `magnet:?xt=urn:btih:${seededA.infoHash}&tr=${encodeURIComponent(ANNOUNCE)}`
console.log(`[e2e] seeders up (A=${seededA.infoHash} B=${seededB.infoHash})`)

// --- app driver ------------------------------------------------------------
async function launch (xdg) {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(ROOT, 'electron', 'main.js')],
    env: { ...process.env, XDG_CONFIG_HOME: xdg }
  })
  const page = await app.firstWindow()
  // surface main-process output ([engine]/[aria2] diagnostics)
  const proc = app.process()
  proc.stdout?.on('data', d => process.stderr.write(`[main] ${d}`))
  proc.stderr?.on('data', d => process.stderr.write(`[main] ${d}`))
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(String(e)))
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => typeof window.gog !== 'undefined')
  return { app, page, errors }
}
const inv = (page, cmd, args) => page.evaluate(([c, a]) => window.gog.invoke(c, a), [cmd, args])
async function unwrap (page, cmd, args) {
  const r = await inv(page, cmd, args)
  if (!r.ok) throw new Error(`${cmd}: ${r.e}`)
  return r.v
}
const statuses = page => unwrap(page, 'torrent_status_all')
const rowOf = (sts, slug) => sts.find(s => s.slug === slug)
function noConsoleErrors (errors) {
  const real = errors.filter(e => !/favicon|Download the React DevTools/i.test(e))
  assert.equal(real.length, 0, `console errors: ${real.join(' | ')}`)
}

// ============ Phase A ============
let { app, page, errors } = await launch(XDG_A)
console.log('[e2e] phase A: app launched')

// 1. preview resolves metadata + lists the file, writes NO payload
let files = (await unwrap(page, 'torrent_preview', { magnet: MAGNET_A })).files
assert.equal(files.length, 1, 'preview: one file')
assert.equal(files[0].size, SIZE, 'preview: correct size')
console.log(`[e2e] preview OK: ${files[0].name} (${files[0].size} B)`)
const strays = fs.existsSync(DL_A)
  ? fs.readdirSync(DL_A).filter(f => { try { return fs.statSync(path.join(DL_A, f)).isFile() && fs.statSync(path.join(DL_A, f)).size > 0 } catch { return false } })
  : []
assert.equal(strays.length, 0, `preview wrote payload files: ${strays}`)

// 2. add (magnet) — blocks until metadata resolves
assert.equal(await unwrap(page, 'torrent_add', { magnet: MAGNET_A, slug: 'e2e-game' }), null)
console.log('[e2e] add OK')

// 3. download starts, peers/seeds are real
const first = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-game')
  return s && s.state === 'downloading' && s.progress > 0.02 ? s : null
}, 45_000, 'download progress')
assert.ok(first.num_peers >= 1, `expected >=1 peer, got ${first.num_peers}`)
assert.equal(Math.round(first.total_size), SIZE, 'total_size = selected bytes')
console.log(`[e2e] downloading: p=${first.progress.toFixed(3)} peers=${first.num_peers} seeds=${first.num_seeds} rate=${first.download_rate} B/s`)
const p1 = first.progress

// 4. pause freezes progress
assert.equal(await unwrap(page, 'torrent_pause', { slug: 'e2e-game' }), null)
const paused = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-game')
  return s && s.state === 'paused' ? s : null
}, 10_000, 'paused state')
await sleep(1500)
const stillPaused = rowOf(await statuses(page), 'e2e-game')
assert.ok(Math.abs(stillPaused.progress - paused.progress) < 0.001, 'progress frozen while paused')
console.log(`[e2e] paused at p=${paused.progress.toFixed(3)} (frozen)`)

// 5. quit — aria2 must die with the app (stop-with-process)
await app.close()
await sleep(1200)
let aria2Left = ''
try { aria2Left = execSync('pgrep -x aria2c || true').toString().trim() } catch { aria2Left = '' }
assert.equal(aria2Left, '', `aria2c outlived the app: ${aria2Left}`)
console.log('[e2e] app closed, no orphan aria2c')

// 6. relaunch → restore as paused with data intact
;({ app, page, errors } = await launch(XDG_A))
const restored = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-game')
  return s && s.state === 'paused' ? s : null
}, 30_000, 'restored paused row')
console.log(`[e2e] restored: p=${restored.progress.toFixed(3)} (was ${p1.toFixed(3)})`)
assert.ok(restored.progress >= p1 - 0.08, `restore lost progress: ${restored.progress} vs ${p1}`)

// 7. resume continues (does not restart from zero) and completes
assert.equal(await unwrap(page, 'torrent_resume', { slug: 'e2e-game' }), null)
const resumed = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-game')
  return s && s.state === 'downloading' ? s : null
}, 15_000, 'resume -> downloading')
console.log(`[e2e] resumed: p=${resumed.progress.toFixed(3)} total_download=${resumed.total_download} B`)
assert.ok(resumed.total_download >= p1 * 0.9 * SIZE - 200 * 1024,
  `resume re-downloaded from scratch: total_download=${resumed.total_download} (p1=${p1})`)

const done = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-game')
  return s && s.state === 'seeding' && s.progress >= 0.999 ? s : null
}, 120_000, 'completion (seeding)')
console.log(`[e2e] complete: upload=${done.upload_rate} B/s seeds=${done.num_seeds}`)

// 8. byte integrity
const got = fs.readFileSync(path.join(DL_A, 'e2e-game', 'payload.bin'))
assert.equal(got.length, SIZE, 'final size')
assert.equal(sha(got), sha(payload), 'final bytes')

// 9. seed_ratio=0 + seed_hours=0 → keeps seeding (until removed manually)
await sleep(4000)
const stillSeeding = rowOf(await statuses(page), 'e2e-game')
assert.equal(stillSeeding?.state, 'seeding', 'seed-until-removed: must still be listed')
console.log('[e2e] seed-until-removed OK (still seeding after 4 s)')
noConsoleErrors(errors)
await app.close()
console.log('[e2e] PHASE A PASSED')

// ============ Phase B ============
;({ app, page, errors } = await launch(XDG_B))
console.log('[e2e] phase B: app launched')

// 1. preview from a local .torrent file (covers addTorrent path too)
files = (await unwrap(page, 'torrent_preview', { magnet: multiTorrent })).files
assert.equal(files.length, 3, 'preview: three files')
assert.deepEqual(files.map(f => f.name).sort(), ['e2e-multi/a.bin', 'e2e-multi/b.bin', 'e2e-multi/c.bin'].sort(),
  `preview names: ${JSON.stringify(files.map(f => f.name))}`)
console.log(`[e2e] preview (file) OK: ${files.map(f => f.name).join(', ')}`)

// 2. add with selectedFiles [0, 2] → b.bin must never appear
assert.equal(await unwrap(page, 'torrent_add', {
  magnet: multiTorrent, slug: 'e2e-select', selectedFiles: [0, 2]
}), null)
const selDone = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-select')
  return s && s.state === 'seeding' && s.progress >= 0.999 ? s : null
}, 60_000, 'select-file completion')
assert.equal(Math.round(selDone.total_size), 2 * 1024 * 1024, 'total_size = selected subset only')
const selDir = path.join(DL_B, 'e2e-select')
const names = fs.readdirSync(path.join(selDir, 'e2e-multi'))
assert.ok(names.includes('a.bin') && names.includes('c.bin'), `selected files on disk: ${names}`)
assert.ok(!names.includes('b.bin'), `unselected file leaked: ${names}`)
assert.equal(fs.statSync(path.join(selDir, 'e2e-multi', 'a.bin')).size, 1024 * 1024, 'a.bin size')
console.log(`[e2e] select-file OK: ${names.join(', ')}`)

// 3. tiny seed_hours → auto stop → row removed, slug in library
const gone = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-select')
  const lib = await unwrap(page, 'torrent_library')
  return (!s && lib.some(e => e.slug === 'e2e-select')) ? lib : null
}, 45_000, 'seed-limit removal + library entry')
console.log(`[e2e] seed-limit auto-removal OK (library: ${gone.map(e => e.slug).join(', ')})`)
assert.ok(fs.existsSync(path.join(selDir, 'e2e-multi', 'a.bin')), 'files kept after seed-limit removal')
noConsoleErrors(errors)
await app.close()
console.log('[e2e] PHASE B PASSED')

// ============ Phase C ============
;({ app, page, errors } = await launch(XDG_C))
console.log('[e2e] phase C: app launched (cold-add GID regression)')

// 1. torrent_add with NO prior preview — the path that used to hand aria2 a
//    raw magnet, whose returned GID is only the metadata download
assert.equal(await unwrap(page, 'torrent_add', { magnet: MAGNET_A, slug: 'e2e-cold' }), null)
const cold = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-cold')
  return s && s.state !== 'error' ? s : null
}, 15_000, 'cold-add row (tracked payload gid)')
assert.equal(Math.round(cold.total_size), SIZE,
  `cold add tracks the PAYLOAD download, not the metadata: total_size=${cold.total_size} (metadata would be ~info-dict size, ${SIZE} expected)`)
assert.ok(cold.progress < 1, `cold add must not be instantly 100%: progress=${cold.progress}`)
console.log(`[e2e] cold add OK: total_size=${cold.total_size} p=${cold.progress.toFixed(3)} state=${cold.state}`)

// 2. let real bytes flow, then quit mid-download
const coldProgress = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-cold')
  return s && s.progress >= 0.05 ? s : null
}, 30_000, 'cold-add progress')
assert.ok(coldProgress.download_rate > 0, `expected active transfer, rate=${coldProgress.download_rate}`)
await app.close()
await sleep(800)

// 3. delete the persisted <hash>.torrent so restore CANNOT reuse it —
//    the queue entry must resolve the magnet itself at boot
const slugDirC = path.join(DL_C, 'e2e-cold')
const persisted = fs.readdirSync(slugDirC).filter(f => f.endsWith('.torrent'))
assert.ok(persisted.length > 0, 'add() persisted <hash>.torrent for restore')
for (const f of persisted) fs.unlinkSync(path.join(slugDirC, f))
console.log(`[e2e] deleted persisted metadata: ${persisted.join(', ')} — restore must re-resolve`)

// 4. relaunch → restore resolves the magnet at boot (a _ready() deadlock
//    here would hang torrent_status_all and time out this wait)
;({ app, page, errors } = await launch(XDG_C))
const restoredC = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-cold')
  return s && s.state !== 'error' ? s : null
}, 30_000, 'restore-without-.torrent row (metadata resolved inside boot)')
assert.equal(Math.round(restoredC.total_size), SIZE,
  `restore also tracks the payload gid: total_size=${restoredC.total_size}`)
assert.ok(restoredC.progress >= coldProgress.progress - 0.15,
  `restore lost progress: ${restoredC.progress} vs ${coldProgress.progress}`)
console.log(`[e2e] restore (no .torrent) OK: p=${restoredC.progress.toFixed(3)} state=${restoredC.state}`)

// 5. completion + byte integrity (sha + EXE magic + no zero-filled holes)
const doneC = await until(async () => {
  const s = rowOf(await statuses(page), 'e2e-cold')
  return s && s.state === 'seeding' && s.progress >= 0.999 ? s : null
}, 120_000, 'phase C completion (seeding)')
assert.equal(Math.round(doneC.total_size), SIZE, 'final total_size')
const gotC = fs.readFileSync(path.join(slugDirC, 'payload.bin'))
assert.equal(gotC.length, SIZE, 'final size')
assert.equal(sha(gotC), sha(payload), 'final bytes')
assert.equal(gotC.subarray(0, 2).toString('latin1'), 'MZ', 'EXE magic present (real data, not falloc holes)')
const nonZero = gotC.reduce((n, b) => n + (b ? 1 : 0), 0)
assert.ok(nonZero > SIZE * 0.9, `file is ${((nonZero / SIZE) * 100).toFixed(1)}% non-zero — looks hole-filled`)
console.log(`[e2e] phase C integrity OK (sha match, MZ magic, ${((nonZero / SIZE) * 100).toFixed(1)}% non-zero)`)
noConsoleErrors(errors)
await app.close()
console.log('[e2e] PHASE C PASSED')

// --- teardown --------------------------------------------------------------
for (const t of [seededA, seededB]) await new Promise(r => t.destroy(r))
await new Promise(r => seeder.destroy(r))
await new Promise(r => tracker.close(r))
try { execSync('pgrep -x aria2c && exit 1 || exit 0', { stdio: 'ignore' }) } catch { throw new Error('orphan aria2c after teardown') }
console.log('E2E ALL PASSED')
