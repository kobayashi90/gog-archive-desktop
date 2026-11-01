// BitTorrent engine — aria2 backend (JSON-RPC to a locally spawned aria2c,
// see aria2.js). Feature parity with the previous webtorrent engine plus:
//
//   1. seed_ratio / seed_hours enforced (per-download aria2 options + the
//      same live check in process() as before)
//   2. interrupted downloads resume on restart (.queue.json re-add; aria2
//      verifies existing pieces on disk and continues)
//   3. completion events (download-progress) + seed-until-removed completion
//   4. retry of errored torrents (torrent_resume on an errored entry)
//   5. proxy_url actually works now (aria2 --all-proxy, hot-appliable)
//   6. num_seeds is real (aria2 reports seeders; webtorrent could not)
//
// Everything the renderer sees (IPC surface + status row shape) is unchanged.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Aria2 } from './aria2.js'
import {
  assertUnderBase, dirFileCount, dirSize, freeBytes, isDirectory,
  loadJson, sanitizeSlug, saveJson, slugToTitle
} from './helpers.js'

const LIBRARY_FILE = '.library.json'
const QUEUE_FILE = '.queue.json'
const DISK_MIN_FREE = 512 * 1024 * 1024
const META_TIMEOUT_MS = 30_000
const ADD_TIMEOUT_MSG = 'Timed out resolving magnet — no peers found. Try again later.'
const PREVIEW_TIMEOUT_MSG = 'Timed out resolving magnet — no peers found. Try again later or check if the torrent has seeders.'
const FREE_CACHE_MS = 5_000
const POLL_MS = 600

const STATUS_KEYS = [
  'gid', 'status', 'totalLength', 'completedLength', 'uploadLength',
  'downloadSpeed', 'uploadSpeed', 'connections', 'numSeeders', 'infoHash',
  'errorCode', 'errorMessage', 'dir', 'files', 'bittorrent'
]

const errMessage = e => (e instanceof Error ? e.message : String(e))
const toInt = v => Number.parseInt(v, 10) || 0

// --- minimal bencode decoder (for parsed .torrent metadata) ---------------
// Returns [value, nextOffset]. Byte strings decode to UTF-8 strings; we only
// ever read name/path/length from them, so binary fields (pieces) are unused.
function bdecode (buf, i = 0) {
  const c = buf[i]
  if (c === 0x69) { // 'i<int>e'
    const e = buf.indexOf(0x65, i)
    if (e < 0) throw new Error('bad bencode int')
    return [Number(buf.subarray(i + 1, e).toString()), e + 1]
  }
  if (c === 0x6c) { // 'l...e'
    const out = []
    i++
    while (buf[i] !== 0x65) {
      if (i >= buf.length) throw new Error('bad bencode list')
      const [v, ni] = bdecode(buf, i)
      out.push(v)
      i = ni
    }
    return [out, i + 1]
  }
  if (c === 0x64) { // 'd...e'
    const out = {}
    i++
    while (buf[i] !== 0x65) {
      if (i >= buf.length) throw new Error('bad bencode dict')
      const [k, ni] = bdecode(buf, i)
      const [v, ni2] = bdecode(buf, ni)
      out[k] = v
      i = ni2
    }
    return [out, i + 1]
  }
  if (c >= 0x30 && c <= 0x39) { // '<len>:<bytes>'
    const colon = buf.indexOf(0x3a, i)
    if (colon < 0) throw new Error('bad bencode string')
    const len = Number(buf.subarray(i, colon).toString())
    const start = colon + 1
    if (!Number.isInteger(len) || start + len > buf.length) throw new Error('bad bencode string length')
    return [buf.subarray(start, start + len).toString('utf8'), start + len]
  }
  throw new Error('bad bencode value')
}

/** Extract the app-shaped file list from raw .torrent bytes. */
function torrentFiles (buf) {
  const [root] = bdecode(buf, 0)
  const info = root && root.info
  if (!info || typeof info !== 'object') throw new Error('invalid torrent: missing info dict')
  if (Array.isArray(info.files)) {
    return info.files.map((f, i) => ({
      index: i,
      name: [info.name, ...(Array.isArray(f.path) ? f.path : [])].filter(Boolean).join('/'),
      size: Number(f.length) || 0
    }))
  }
  return [{ index: 0, name: String(info.name || ''), size: Number(info.length) || 0 }]
}

export class Engine {
  /**
   * @param {object} settings  merged settings (see settings.js)
   * @param {object} hooks     { onDone(status) } — fired once per completion
   */
  constructor (settings, hooks = {}) {
    this.hooks = hooks
    this.settings = settings

    // Rust quirk parity: persist paths are bound to the download dir as it
    // existed at startup; download_dir changes only move *new* downloads.
    this.persistDir = settings.download_dir
    this.basePath = settings.download_dir
    fs.mkdirSync(this.basePath, { recursive: true })

    this.slugByHash = new Map() // infoHash -> slug (active downloads)
    this.gidToSlug = new Map() // aria2 GID -> slug
    this.removedSlugs = [] // session list (library shows these)
    this.errorEntries = new Map() // slug -> { magnet, progress } — dead torrents
    this.state = new Map() // slug -> { done, doneAt, notified, lastProgress }
    this.previewCache = new Map() // magnet -> { files, torrentBuf, infoHash }
    this._metaChain = Promise.resolve() // serializes metadata fetches (shared scratch dir)
    this.doneQueue = [] // completion events for the main-process emitter
    this.freeCache = { t: 0, v: 0 }
    this._daemonReady = false

    this.persisted = this._loadLibrary() // slug -> infoHash (.library.json)
    this.queue = loadJson(path.join(this.persistDir, QUEUE_FILE), {}) // slug -> entry
    if (typeof this.queue !== 'object' || this.queue === null || Array.isArray(this.queue)) this.queue = {}

    this.aria2 = new Aria2({
      dht: settings.dht !== false,
      lsd: settings.lsd !== false,
      listenPort: settings.listen_port > 0 ? settings.listen_port : 0,
      maxPeers: settings.max_peers > 0 ? settings.max_peers : 0,
      downloadLimit: settings.download_rate_limit > 0 ? settings.download_rate_limit * 1024 : 0,
      uploadLimit: settings.upload_rate_limit > 0 ? settings.upload_rate_limit * 1024 : 0,
      proxyUrl: settings.proxy_url || '',
      fileAllocation: settings.file_allocation || 'falloc',
      maxTries: settings.max_tries ?? 0,
      retryWait: settings.retry_wait ?? 5,
      workingDir: this.persistDir
    })

    this.booted = this._boot()
  }

  async _boot () {
    await this.aria2.start()
    this._daemonReady = true
    this.applyLimits(this.settings) // re-apply as changeGlobalOption (parity)
    await this._restore()
  }

  /** Every public entrypoint waits for the daemon. */
  async _ready () {
    try {
      await this.booted
    } catch (err) {
      throw new Error(`Torrent engine unavailable: ${errMessage(err)}`)
    }
  }

  // --- persistence ---------------------------------------------------------

  _loadLibrary () {
    const p = path.join(this.persistDir, LIBRARY_FILE)
    const raw = loadJson(p, {})
    if (Array.isArray(raw)) {
      // Old Tauri format: ["slug1", "slug2"] → migrate to {slug: ""}
      const migrated = {}
      for (const slug of raw) if (typeof slug === 'string') migrated[slug] = ''
      saveJson(p, migrated)
      return migrated
    }
    if (raw && typeof raw === 'object') {
      const out = {}
      for (const [slug, hash] of Object.entries(raw)) out[slug] = typeof hash === 'string' ? hash : ''
      return out
    }
    return {}
  }

  _libraryPath () { return path.join(this.persistDir, LIBRARY_FILE) }
  _queuePath () { return path.join(this.persistDir, QUEUE_FILE) }

  _saveLibrary () { saveJson(this._libraryPath(), this.persisted) }
  _saveQueue () { saveJson(this._queuePath(), this.queue) }

  // --- startup restore (.queue.json) ---------------------------------------

  async _restore () {
    for (const [slug, entry] of Object.entries(this.queue)) {
      if (!entry || typeof entry !== 'object') continue
      try { sanitizeSlug(slug) } catch { continue }
      if (entry.done) continue // completed torrents stay library-only (Tauri parity)
      if (entry.error) {
        // don't auto-retry known-bad magnets at every boot — show them as
        // errored so the Queue Retry button is available
        this.errorEntries.set(slug, { magnet: entry.magnet || null, progress: entry.progress || 0 })
        continue
      }
      const magnet = entry.magnet || (entry.hash ? `magnet:?xt=urn:btih:${entry.hash}` : null)
      if (!magnet) continue
      try {
        const slugPath = path.join(this.basePath, slug)
        fs.mkdirSync(slugPath, { recursive: true })
        // _persistTorrent wrote <infohash>.torrent next to the data:
        // re-adding the file skips the magnet metadata phase entirely
        const metaFile = entry.hash ? path.join(slugPath, `${entry.hash.toLowerCase()}.torrent`) : null
        const src = metaFile && fs.existsSync(metaFile) ? metaFile : magnet
        const gid = await this._submit(src, this._addOptions(slugPath, { paused: !!entry.paused }))
        this._persistTorrent(src, slugPath) // resolved from a magnet → keep the copy
        this._register(slug, gid, { magnet, done: false, paused: !!entry.paused, hash: entry.hash })
      } catch (err) {
        console.error(`[engine] restore of "${slug}" failed:`, errMessage(err))
        // surface as errored (Queue gets a Retry button) — a gid-less entry
        // is invisible in statusAll, and a stalled swarm at boot lands here
        this._markError(slug, errMessage(err), entry.progress || 0)
      }
    }
  }

  // --- aria2 plumbing ------------------------------------------------------

  /** Per-download aria2 options for a download living in `dir`. */
  _addOptions (dir, { paused = false, selectedFiles = null } = {}) {
    const s = this.settings
    const opts = {
      dir,
      // aria2's default seed ratio is 1.0, and its options have no
      // "unlimited" spelling: 0.0 reads as "limit already satisfied" and
      // stops seeding right after completion (measured!). The app semantics
      // are "seed until removed" when both settings are 0 — pass an
      // effectively infinite limit instead (~2 years of seeding).
      'seed-ratio': s.seed_ratio > 0 ? String(s.seed_ratio) : '999999',
      'seed-time': s.seed_hours > 0 ? String(s.seed_hours * 60) : '999999'
      // no bt-save-metadata: it only matters for magnet input, and _submit
      // never hands aria2 raw magnets (metadata is resolved to bytes first).
      // On addTorrent input aria2 saves sha1(input-bytes).torrent anyway
      // (measured — option-independent); _submit deletes that misnamed
      // duplicate and _persistTorrent writes the real-infohash copy
      // _restore looks up.
    }
    if (paused) opts.pause = 'true'
    if (Array.isArray(selectedFiles) && selectedFiles.length) {
      // aria2 file indices are 1-based; the app's are 0-based (Tauri parity)
      opts['select-file'] = selectedFiles.map(i => i + 1).join(',')
    }
    return opts
  }

  /**
   * Resolve a submit source (Buffer | local .torrent path | magnet URI) to
   * .torrent bytes. Never hand aria2 a raw magnet: aria2.addUri(magnet)
   * returns the METADATA download's GID — it completes at info-dict size
   * (~12 kB) while the payload runs unmanaged under a second GID, so the
   * engine would see instant 100% and finalize a folder of holes (measured
   * on RimWorld: returned gid total=11550 vs real download total=569151832
   * under a different gid). Deliberately does NOT await _ready(): _restore
   * runs inside _boot and awaiting booted from there deadlocks.
   */
  async _resolveSrc (src) {
    if (Buffer.isBuffer(src)) return src
    let isFile = false
    try { isFile = fs.existsSync(src) && fs.statSync(src).isFile() } catch { isFile = false }
    if (isFile) return fs.readFileSync(src)
    if (typeof src === 'string' && src.startsWith('magnet:')) {
      const cached = this.previewCache.get(src)
      if (cached?.torrentBuf) return cached.torrentBuf
      return (await this._fetchMeta(src)).torrentBuf
    }
    return src // non-magnet URI → legacy direct download via addUri
  }

  /** Submit a resolved source → aria2 GID (torrent bytes; addUri fallback). */
  async _submit (src, options) {
    const resolved = await this._resolveSrc(src)
    if (Buffer.isBuffer(resolved)) {
      // aria2 RPC carries torrent data base64-encoded (a raw Buffer would
      // JSON-serialize as {"type":"Buffer",...} and aria2 would reject it)
      const gid = await this.aria2.call('aria2.addTorrent', [resolved.toString('base64'), [], options])
      await this._dropAria2StrayTorrent(resolved, options?.dir)
      return gid
    }
    return this.aria2.call('aria2.addUri', [[resolved], options])
  }

  /**
   * aria2 unconditionally saves sha1(input-bytes).torrent next to the payload
   * on addTorrent input (measured — bt-save-metadata does not govern it).
   * That misnamed duplicate can never match _restore's <real infohash> lookup,
   * so delete it: _persistTorrent keeps the correctly-named copy. Retries
   * briefly in case the write lands just after the RPC returns.
   */
  async _dropAria2StrayTorrent (buf, dir) {
    if (!dir) return
    const stray = path.join(dir, `${crypto.createHash('sha1').update(buf).digest('hex')}.torrent`)
    for (let i = 0; i < 10; i++) {
      try {
        await fs.promises.unlink(stray)
        return
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`[engine] failed to remove aria2's duplicate torrent:`, errMessage(err))
          return
        }
        await new Promise(r => setTimeout(r, 100)) // not written yet — retry
      }
    }
  }

  /**
   * Persist <infohash>.torrent next to the payload so _restore can re-add
   * without a swarm. The metadata-only fetch saves the file under the REAL
   * infohash (measured: matches magnet btih + sha1(info)), which is exactly
   * what _restore looks up via entry.hash — so write the cached copy there.
   * aria2's own payload-mode bt-save-metadata is no help: it names the file
   * sha1(.torrent bytes) (measured), which restore can never match.
   */
  _persistTorrent (src, dir) {
    const meta = this.previewCache.get(src)
    if (!meta?.torrentBuf || !meta.infoHash) return
    try {
      fs.writeFileSync(path.join(dir, `${meta.infoHash.toLowerCase()}.torrent`), meta.torrentBuf)
    } catch (err) {
      console.error(`[engine] failed to persist .torrent for "${src}":`, errMessage(err))
    }
  }

  _register (slug, gid, { magnet, done = false, paused = false, hash = '' } = {}) {
    this.gidToSlug.set(gid, slug)
    const prev = this.state.get(slug)
    this.state.set(slug, prev || {
      done: !!done,
      doneAt: done ? Date.now() : null,
      notified: !!done,
      lastProgress: 0
    })
    const entry = this.queue[slug] || {}
    entry.magnet = magnet
    entry.gid = gid
    entry.done = !!done
    entry.paused = !!paused
    if (hash) entry.hash = hash
    this.queue[slug] = entry
    this._saveQueue()
  }

  _forgetGid (gid) {
    const slug = this.gidToSlug.get(gid)
    if (slug && this.queue[slug]?.gid === gid) delete this.queue[slug].gid
    this.gidToSlug.delete(gid)
  }

  /** Remove a download from aria2's list (and its result record). */
  async _dropAria2 (gid) {
    if (!gid) return
    try { await this.aria2.call('aria2.remove', [gid]) } catch { /* stopped/complete already */ }
    try { await this.aria2.call('aria2.removeDownloadResult', [gid]) } catch { /* unknown */ }
  }

  /**
   * Submit + wait for torrent metadata (files listed), like the webtorrent
   * engine's waitReady. Rejects with the same messages on error/timeout and
   * cleans the download up on failure.
   */
  async _addWithMetaWait (src, options) {
    // resolve to .torrent bytes first (magnet → metadata fetch) — errors
    // surface unwrapped here, actual submit failures as "Failed to add torrent"
    const resolved = await this._resolveSrc(src)
    let gid
    try {
      gid = await this._submit(resolved, options)
    } catch (err) {
      throw new Error(`Failed to add torrent: ${errMessage(err)}`)
    }
    const deadline = Date.now() + META_TIMEOUT_MS
    for (;;) {
      let st
      try {
        st = await this.aria2.call('aria2.tellStatus', [gid, ['status', 'totalLength', 'errorCode', 'errorMessage']])
      } catch (err) {
        await this._dropAria2(gid)
        throw new Error(`Failed to add torrent: ${errMessage(err)}`)
      }
      if (st.status === 'error') {
        await this._dropAria2(gid)
        throw new Error(st.errorMessage || `aria2 error ${st.errorCode}`)
      }
      if (toInt(st.totalLength) > 0) return gid // metadata resolved
      if (Date.now() > deadline) {
        await this._dropAria2(gid)
        throw new Error(ADD_TIMEOUT_MSG)
      }
      await new Promise(r => setTimeout(r, POLL_MS))
    }
  }

  _markError (slug, msg, progress = 0) {
    console.error(`[engine] download error (${slug}):`, msg)
    const entry = this.queue[slug]
    if (entry) {
      entry.error = msg
      entry.progress = progress
      entry.done = false
      const gid = entry.gid
      delete entry.gid
      this._saveQueue()
      if (gid) {
        this.gidToSlug.delete(gid)
        this._dropAria2(gid).catch(() => {})
      }
    }
    this.errorEntries.set(slug, { magnet: entry?.magnet || null, progress })
    if (entry?.hash) this.slugByHash.delete(entry.hash)
    this.state.delete(slug)
  }

  // --- public commands -----------------------------------------------------

  /** preview_magnet: list files without downloading (metadata only) */
  async preview (magnet) {
    await this._ready()
    const cached = this.previewCache.get(magnet)
    if (cached) return { files: cached.files, free_bytes: this.freeSpace() }

    // local .torrent file: the metadata is right there — parse it directly
    let localFile = false
    try { localFile = fs.existsSync(magnet) && fs.statSync(magnet).isFile() } catch { localFile = false }
    if (localFile) {
      let buf
      try { buf = fs.readFileSync(magnet) } catch (err) {
        throw new Error(`Failed to preview torrent: ${errMessage(err)}`)
      }
      const files = torrentFiles(buf) // throws on malformed input
      this.previewCache.set(magnet, { files, torrentBuf: buf, infoHash: null })
      return { files, free_bytes: this.freeSpace() }
    }

    // Magnet: aria2's bt-metadata-only mode fetches the metadata and stops —
    // shared with _resolveSrc so preview and add do the same fetch (and the
    // cache keys line up, whichever runs first)
    const meta = await this._fetchMeta(magnet)
    return { files: meta.files, free_bytes: this.freeSpace() }
  }

  /**
   * Fetch a magnet's metadata (bt-metadata-only — no payload is ever written)
   * into the scratch dir, parse the saved <infohash>.torrent, cache it.
   * Serialized: every fetch shares that one scratch dir, so concurrent
   * callers must not clobber it. Does NOT await _ready() — see _resolveSrc.
   */
  _fetchMeta (magnet) {
    const run = this._metaChain.then(() => this._fetchMetaNow(magnet))
    this._metaChain = run.then(() => {}, () => {})
    return run
  }

  async _fetchMetaNow (magnet) {
    // bt-save-metadata drops the resulting <infohash>.torrent into the
    // scratch dir, which we parse for the real file list (getFiles during
    // metadata-only shows a [METADATA] stub, not the payload files).
    // Resolve state never touches the user's downloads: everything happens
    // in a scratch dir that is wiped afterwards.
    const pdir = path.join(this.persistDir, '.aria2-preview')
    fs.rmSync(pdir, { recursive: true, force: true })
    fs.mkdirSync(pdir, { recursive: true })
    let gid
    try {
      try {
        gid = await this.aria2.call('aria2.addUri', [[magnet], {
          dir: pdir, 'bt-metadata-only': 'true', 'bt-save-metadata': 'true'
        }])
      } catch (err) {
        throw new Error(`Failed to resolve torrent metadata: ${errMessage(err)}`)
      }
      const deadline = Date.now() + META_TIMEOUT_MS
      for (;;) {
        const st = await this.aria2.call('aria2.tellStatus', [gid, ['status', 'errorMessage', 'errorCode']])
        if (st.status === 'error') throw new Error(st.errorMessage || 'aria2 metadata fetch failed')
        if (st.status === 'complete') break // metadata fetched
        if (Date.now() > deadline) throw new Error(PREVIEW_TIMEOUT_MSG)
        await new Promise(r => setTimeout(r, POLL_MS))
      }
      // bt-save-metadata names the file after the torrent's infohash —
      // authoritative (tellStatus' infoHash during metadata-only mode hashes
      // the metadata FILE, not the torrent's info dict — measured!)
      const saved = fs.readdirSync(pdir).find(f => f.endsWith('.torrent'))
      if (!saved) throw new Error(PREVIEW_TIMEOUT_MSG)
      const buf = fs.readFileSync(path.join(pdir, saved))
      const files = torrentFiles(buf)
      const meta = { files, torrentBuf: buf, infoHash: saved.replace(/\.torrent$/i, '') }
      this.previewCache.set(magnet, meta)
      return meta
    } finally {
      await this._dropAria2(gid)
      fs.rmSync(pdir, { recursive: true, force: true }) // no litter, ever
    }
  }

  /** add_magnet — blocks until metadata resolves (Tauri parity, 30s timeout) */
  async add (magnet, slug, selectedFiles) {
    await this._ready()
    sanitizeSlug(slug)
    const existing = this.queue[slug]
    if (existing && existing.gid && !existing.done) {
      throw new Error('This torrent is already in the download queue.')
    }
    const slugPath = path.join(this.basePath, slug)
    fs.mkdirSync(slugPath, { recursive: true })
    assertUnderBase(slugPath, this.basePath)

    const free = this.freeSpace()
    if (free < DISK_MIN_FREE) {
      throw new Error(`Very low disk space: only ${(free / (1024 ** 3)).toFixed(1)} GB available. Free up space and try again.`)
    }

    const selection = Array.isArray(selectedFiles) ? selectedFiles.filter(i => Number.isInteger(i) && i >= 0) : []
    // _addWithMetaWait resolves the magnet to .torrent bytes itself (a raw
    // magnet's aria2 GID would only be the metadata download — see
    // _resolveSrc) and caches the metadata; persist that copy afterwards so
    // _restore can re-add without a swarm
    const gid = await this._addWithMetaWait(magnet, this._addOptions(slugPath, { selectedFiles: selection }))
    this._persistTorrent(magnet, slugPath)
    this._register(slug, gid, { magnet, done: false, paused: false })

    // selective download: only apply when a proper subset is chosen
    if (selection.length) {
      try {
        const files = await this.aria2.call('aria2.getFiles', [gid])
        if (files.length && selection.length < files.length) {
          await this.aria2.call('aria2.changeOption', [gid, { 'select-file': selection.map(i => i + 1).join(',') }])
        }
      } catch (err) {
        console.error(`[engine] select-file apply failed (${slug}):`, errMessage(err))
      }
    }
    return null
  }

  async remove (slug) {
    await this._ready()
    sanitizeSlug(slug)
    const entry = this.queue[slug]
    if (entry) {
      await this._dropAria2(entry.gid)
      if (entry.hash) {
        this.slugByHash.delete(entry.hash)
        this.persisted[slug] = this.persisted[slug] // kept: library parity
      }
      // Rust: removed_slugs only records torrents that were active
      if (!this.removedSlugs.includes(slug)) this.removedSlugs.push(slug)
      // persisted entry is KEPT so the library still lists it (Rust parity)
    }
    delete this.queue[slug]
    this.errorEntries.delete(slug)
    this.state.delete(slug)
    for (const [gid, s] of this.gidToSlug) if (s === slug) this.gidToSlug.delete(gid)
    this._saveQueue()
    this._saveLibrary()
    return null
  }

  async pause (slug) {
    await this._ready()
    sanitizeSlug(slug)
    const entry = this.queue[slug]
    if (entry?.gid) {
      try { await this.aria2.call('aria2.pause', [entry.gid]) } catch { /* complete/stopped */ }
    }
    if (entry) { entry.paused = true; this._saveQueue() }
    return null
  }

  async resume (slug) {
    await this._ready()
    sanitizeSlug(slug)
    // errored entries: resume = retry (re-add from the queue record)
    const dead = this.errorEntries.get(slug)
    if (dead && !this.queue[slug]?.gid) {
      this.errorEntries.delete(slug)
      const entry = this.queue[slug] || {}
      delete entry.error
      entry.done = false
      entry.paused = false
      this.queue[slug] = entry
      this._saveQueue()
      const magnet = dead.magnet || entry.magnet || (entry.hash ? `magnet:?xt=urn:btih:${entry.hash}` : null)
      if (magnet) {
        const slugPath = path.join(this.basePath, slug)
        fs.mkdirSync(slugPath, { recursive: true })
        try {
          const metaFile = entry.hash ? path.join(slugPath, `${entry.hash.toLowerCase()}.torrent`) : null
          const src = metaFile && fs.existsSync(metaFile) ? metaFile : magnet
          const gid = await this._addWithMetaWait(src, this._addOptions(slugPath))
          this._persistTorrent(src, slugPath) // resolved from a magnet → keep the copy
          this._register(slug, gid, { magnet, done: false, paused: false, hash: entry.hash })
        } catch (err) {
          console.error(`[engine] retry of "${slug}" failed:`, errMessage(err))
        }
      }
      return null
    }
    const entry = this.queue[slug]
    if (entry) {
      if (entry.gid) {
        try {
          await this.aria2.call('aria2.unpause', [entry.gid])
        } catch {
          // GID gone (result purged / daemon restart): re-add from the record
          const magnet = entry.magnet || (entry.hash ? `magnet:?xt=urn:btih:${entry.hash}` : null)
          if (magnet) {
            const slugPath = path.join(this.basePath, slug)
            fs.mkdirSync(slugPath, { recursive: true })
            const metaFile = entry.hash ? path.join(slugPath, `${entry.hash.toLowerCase()}.torrent`) : null
            const src = metaFile && fs.existsSync(metaFile) ? metaFile : magnet
            const gid = await this._addWithMetaWait(src, this._addOptions(slugPath))
            this._persistTorrent(src, slugPath) // resolved from a magnet → keep the copy
            this._register(slug, gid, { magnet, done: false, paused: false, hash: entry.hash })
          }
        }
      }
      entry.paused = false
      this._saveQueue()
    }
    return null
  }

  // --- status --------------------------------------------------------------

  freeSpace () {
    const now = Date.now()
    if (now - this.freeCache.t < FREE_CACHE_MS) return this.freeCache.v
    const v = freeBytes(this.basePath)
    this.freeCache = { t: now, v }
    return v
  }

  async statusAll () {
    await this._ready()
    const now = Date.now()
    const free = this.freeSpace()
    const out = []
    const finalize = [] // stopped-complete slugs to retire this tick

    const [active, waiting, stopped] = await this.aria2.batch([
      ['aria2.tellActive', [STATUS_KEYS]],
      ['aria2.tellWaiting', [0, 1000, STATUS_KEYS]],
      ['aria2.tellStopped', [0, 256, STATUS_KEYS]]
    ])

    const emit = dl => {
      const slug = this.gidToSlug.get(dl.gid)
      if (!slug) return // preview/foreign downloads are invisible
      const entry = this.queue[slug]
      if (!entry) return
      const st = this.state.get(slug) || { done: false, doneAt: null, notified: false, lastProgress: 0 }

      // commit infoHash once known
      if (dl.infoHash && entry.hash !== dl.infoHash) {
        entry.hash = dl.infoHash
        this.slugByHash.set(dl.infoHash, slug)
        this._saveQueue()
        this.persisted[slug] = dl.infoHash
        this._saveLibrary()
      }

      const total = toInt(dl.totalLength)
      const downloaded = toInt(dl.completedLength)
      const progress = total > 0 ? Math.min(1, downloaded / total) : st.lastProgress
      st.lastProgress = progress

      let state
      if (dl.status === 'paused') state = 'paused'
      else if (dl.status === 'waiting') state = 'queued'
      else if (total === 0) state = 'queued' // magnet metadata phase (pre-file-list)
      else if (downloaded >= total) state = 'seeding'
      else state = 'downloading'

      if (state === 'seeding' && !st.doneAt) st.doneAt = now
      const seedingSecs = state === 'seeding' && st.doneAt ? Math.max(0, Math.floor((now - st.doneAt) / 1000)) : 0

      const dlRate = toInt(dl.downloadSpeed)
      const remaining = Math.max(0, total - downloaded)
      const eta = dlRate > 0 && remaining > 0 ? Math.floor(remaining / dlRate) : 0

      out.push({
        info_hash: dl.infoHash || entry.hash || '',
        name: slugToTitle(dl.bittorrent?.info?.name || slug),
        slug,
        title: '', // filled by enrichment
        image: null,
        progress,
        state,
        download_rate: dlRate,
        upload_rate: toInt(dl.uploadSpeed),
        total_download: downloaded,
        total_upload: toInt(dl.uploadLength),
        total_size: total,
        num_peers: toInt(dl.connections),
        num_seeds: toInt(dl.numSeeders),
        eta,
        seeding_secs: seedingSecs,
        save_path: dl.dir || path.join(this.basePath, slug),
        verified: false, // filled by enrichment (size-ratio rule)
        free_bytes: free
      })
    }

    for (const dl of active) emit(dl)
    for (const dl of waiting) emit(dl)
    for (const dl of stopped) {
      const slug = this.gidToSlug.get(dl.gid)
      if (!slug) continue
      if (dl.status === 'error') {
        const entry = this.queue[slug]
        const st = this.state.get(slug)
        this._markError(slug, dl.errorMessage || `aria2 error ${dl.errorCode}`, st?.lastProgress ?? entry?.progress ?? 0)
        continue // phantom row below
      }
      if (dl.status === 'complete') {
        // aria2 stopped seeding on its own (seed limits hit) — surface one
        // final 'seeding' row so process() fires the completion event
        emit({ ...dl, status: 'active' })
        finalize.push(slug)
        continue
      }
      emit(dl) // 'removed' shouldn't reach us; keep it visible anyway
    }

    // phantom statuses for dead torrents so Queue can show Retry
    for (const [slug, entry] of this.errorEntries) {
      if (this.queue[slug]?.gid) continue
      out.push({
        info_hash: (this.queue[slug]?.hash) || '',
        name: slugToTitle(slug),
        slug,
        title: '',
        image: null,
        progress: entry.progress || 0,
        state: 'error',
        download_rate: 0,
        upload_rate: 0,
        total_download: 0,
        total_upload: 0,
        total_size: 0,
        num_peers: 0,
        num_seeds: 0,
        eta: 0,
        seeding_secs: 0,
        save_path: path.join(this.basePath, slug),
        verified: false,
        free_bytes: free
      })
    }

    this._finalize = finalize // consumed by process() the same tick
    return out
  }

  /**
   * Per-tick bookkeeping: completion events (once per slug) + seed limits.
   * Call after enrichment. Returns statuses with removed entries filtered out.
   */
  process (statuses, settings) {
    const removed = []
    const finalize = this._finalize || []
    this._finalize = []
    for (const s of statuses) {
      const st = this.state.get(s.slug)
      if (s.state === 'seeding' && st && !st.notified) {
        st.notified = true
        st.done = true
        st.doneAt = Date.now()
        const entry = this.queue[s.slug]
        if (entry) { entry.done = true; delete entry.error; this._saveQueue() }
        // queued for the emitter — survives seed-limit removal this same tick
        this.doneQueue.push({ done: true, name: s.title || s.name, slug: s.slug })
      }
      const hitLimits = s.state === 'seeding' && settings && (
        (settings.seed_ratio > 0 && s.total_size > 0 && s.total_upload >= s.total_size * settings.seed_ratio) ||
        (settings.seed_hours > 0 && s.seeding_secs >= settings.seed_hours * 3600)
      )
      if (hitLimits || finalize.includes(s.slug)) {
        s.__removed = true
        removed.push(s.slug)
        this.remove(s.slug).catch(err => console.error('[engine] seed-limit remove failed:', errMessage(err)))
      }
    }
    for (const slug of removed) this.errorEntries.delete(slug)
    return statuses.filter(s => !s.__removed)
  }

  // --- library -------------------------------------------------------------

  library () {
    const out = []
    const seen = new Set()
    const entryFor = slug => {
      const p = path.join(this.basePath, slug)
      const dir = isDirectory(p)
      return {
        slug,
        title: slugToTitle(slug),
        image: null,
        size: dir ? dirSize(p) : 0,
        developer: null,
        genre: null,
        file_count: dir ? dirFileCount(p) : 0,
        total_size: null
      }
    }

    for (const slug of Object.keys(this.queue)) {
      try { sanitizeSlug(slug) } catch { continue }
      seen.add(slug)
      out.push(entryFor(slug))
    }
    for (const slug of this.removedSlugs) {
      try { sanitizeSlug(slug) } catch { continue }
      if (seen.has(slug)) continue
      seen.add(slug)
      out.push(entryFor(slug))
    }
    for (const slug of Object.keys(this.persisted)) {
      try { sanitizeSlug(slug) } catch { continue }
      if (seen.has(slug)) continue
      if (!isDirectory(path.join(this.basePath, slug))) continue
      seen.add(slug)
      out.push(entryFor(slug))
    }
    out.sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
    return out
  }

  async libraryDelete (slug) {
    await this._ready()
    sanitizeSlug(slug)
    const entry = this.queue[slug]
    if (entry) await this._dropAria2(entry.gid)
    this.removedSlugs = this.removedSlugs.filter(s => s !== slug)
    delete this.persisted[slug]
    this._saveLibrary()
    delete this.queue[slug]
    this.errorEntries.delete(slug)
    this.state.delete(slug)
    this._saveQueue()

    const slugPath = path.join(this.basePath, slug)
    if (isDirectory(slugPath)) {
      assertUnderBase(slugPath, this.basePath)
      fs.rmSync(slugPath, { recursive: true, force: true })
    } else if (isDirectory(this.basePath)) {
      // fuzzy: downloaded dirs sometimes differ from the slug
      const target = slug.replaceAll('_', ' ').toLowerCase()
      for (const name of fs.readdirSync(this.basePath)) {
        const n = name.toLowerCase()
        if (!(n === target || n.includes(target) || target.includes(n))) continue
        try { sanitizeSlug(name.replaceAll(' ', '_')) } catch { continue }
        const p = path.join(this.basePath, name)
        if (!isDirectory(p)) continue
        assertUnderBase(p, this.basePath)
        fs.rmSync(p, { recursive: true, force: true })
        break
      }
    }
    return null
  }

  downloadDirExists (slug) {
    sanitizeSlug(slug)
    return isDirectory(path.join(this.basePath, slug))
  }

  async deleteDownloadDir (slug) {
    sanitizeSlug(slug)
    const p = path.join(this.basePath, slug)
    try {
      assertUnderBase(p, this.basePath)
    } catch (err) {
      // Rust check_path_under_base canonicalizes first: missing dir → raw io error
      if (err?.code === 'ENOENT') throw new Error('No such file or directory (os error 2)')
      throw err
    }
    if (isDirectory(p)) fs.rmSync(p, { recursive: true, force: true })
    return null
  }

  getSavePath (slug) {
    sanitizeSlug(slug)
    const direct = path.join(this.basePath, slug)
    if (isDirectory(direct)) return direct

    // fuzzy match against actual dirs (Tauri L-4 fallback)
    const spaced = slug.replaceAll('_', ' ')
    const d2 = path.join(this.basePath, spaced)
    if (isDirectory(d2)) return d2

    if (!isDirectory(this.basePath)) return null
    const target = spaced.toLowerCase()
    for (const name of fs.readdirSync(this.basePath)) {
      const n = name.toLowerCase()
      if (n !== target && !n.includes(target) && !target.includes(n)) continue
      try { sanitizeSlug(name.replaceAll(' ', '_')) } catch { continue }
      const p = path.join(this.basePath, name)
      if (isDirectory(p)) return p
    }
    return null
  }

  // --- configuration -------------------------------------------------------

  applyLimits (settings) {
    this.settings = settings
    // settings are kB/s; aria2 takes bytes/s; 0 = unlimited
    const dl = settings.download_rate_limit > 0 ? settings.download_rate_limit * 1024 : 0
    const up = settings.upload_rate_limit > 0 ? settings.upload_rate_limit * 1024 : 0
    if (!this._daemonReady || this.aria2.exited) return // boot applies after start
    this.aria2.call('aria2.changeGlobalOption', [{
      'max-overall-download-limit': String(dl),
      'max-overall-upload-limit': String(up),
      'all-proxy': settings.proxy_url || ''
    }]).catch(err => console.error('[engine] failed to apply rate limits:', errMessage(err)))
    // Options that used to be read only at spawn time: aria2 accepts them at
    // runtime as well (verified against changeGlobalOption on 1.37), so DHT,
    // LSD, listen port, peer cap and retry/allocation settings now apply on
    // save instead of waiting for a restart. Sent as a separate call so a
    // rejection can never take the rate-limit application down with it.
    const opts = {
      'enable-dht': String(settings.dht !== false),
      'bt-enable-lpd': String(settings.lsd !== false),
      'file-allocation': settings.file_allocation || 'falloc',
      'max-tries': String(settings.max_tries ?? 0),
      'retry-wait': String(settings.retry_wait ?? 5)
    }
    if (settings.listen_port > 0) opts['listen-port'] = String(settings.listen_port)
    if (settings.max_peers > 0) opts['bt-max-peers'] = String(settings.max_peers)
    this.aria2.call('aria2.changeGlobalOption', [opts])
      .catch(err => console.error('[engine] failed to apply advanced options:', errMessage(err)))
  }

  setBasePath (dir) {
    this.basePath = dir
    this.freeCache = { t: 0, v: 0 }
  }

  hasActiveTorrents () {
    return Object.values(this.queue).some(e => e && !e.done)
  }

  async shutdown () {
    try { await this.booted } catch { /* daemon never came up */ }
    const t = new Promise(resolve => setTimeout(resolve, 4000)) // don't hang the quit path
    await Promise.race([this.aria2.shutdown(), t])
  }
}
