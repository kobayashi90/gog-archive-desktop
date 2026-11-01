// aria2 daemon manager + minimal JSON-RPC client.
//
// The engine spawns a local aria2c (bundled in the app resources at
// bin/aria2c; the dev tree has it at <root>/bin/aria2c, with a system-PATH
// fallback) with JSON-RPC enabled on a random localhost port and talks to it
// over HTTP with a per-instance secret token. aria2 is tied to this process
// via --stop-with-process so it can never outlive the app (even on a crash).

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url)) // electron/
const RPC_TIMEOUT_MS = 5000
const STARTUP_TIMEOUT_MS = 12_000

function resolveBinary () {
  const candidates = []
  if (process.resourcesPath) {
    // packaged: extraResources maps bin/ -> <resources>/bin/
    candidates.push(path.join(process.resourcesPath, 'bin', 'aria2c'))
  }
  candidates.push(path.join(ROOT, '..', 'bin', 'aria2c')) // dev tree
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c } catch { /* keep looking */ }
  }
  return 'aria2c' // last resort: system PATH (dev machines with pacman aria2)
}

function freePort () {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

export class Aria2 {
  /**
   * @param {object} opts
   *   dht, lsd          booleans (spawn-time)
   *   listenPort        BT listen port, 0 = aria2 default
   *   maxPeers          bt-max-per-torrent cap, 0 = aria2 default
   *   rateLimit         bytes/s overall cap for BOTH directions? no —
   *   downloadLimit     bytes/s overall download cap (0 = unlimited)
   *   uploadLimit       bytes/s overall upload cap (0 = unlimited)
   *   proxyUrl          all-proxy URL ('' = none)
   *   workingDir        cwd for the child (persist dir)
   */
  constructor (opts = {}) {
    this.opts = opts
    this.binary = resolveBinary()
    this.secret = crypto.randomBytes(16).toString('hex')
    this.port = 0
    this.child = null
    this.nextId = 1
    this.exited = false
  }

  async start () {
    this.port = await freePort()
    const o = this.opts
    const args = [
      '--enable-rpc=true',
      '--rpc-listen-all=false',
      `--rpc-listen-port=${this.port}`,
      `--rpc-secret=${this.secret}`,
      '--console-log-level=warn',
      `--file-allocation=${o.fileAllocation || 'falloc'}`,
      `--max-tries=${o.maxTries ?? 0}`, // 0 = retry forever…
      `--retry-wait=${o.retryWait ?? 5}`, // …but N s apart, not hot-looping
      `--stop-with-process=${process.pid}`,
      `--enable-dht=${o.dht !== false}`,
      `--bt-enable-lpd=${o.lsd !== false}`, // aria2 calls LSD "LPD"
      `--max-overall-download-limit=${o.downloadLimit > 0 ? o.downloadLimit : 0}`,
      `--max-overall-upload-limit=${o.uploadLimit > 0 ? o.uploadLimit : 0}`
    ]
    if (o.listenPort > 0) args.push(`--listen-port=${o.listenPort}`)
    if (o.maxPeers > 0) args.push(`--bt-max-peers=${o.maxPeers}`)
    if (o.proxyUrl) args.push(`--all-proxy=${o.proxyUrl}`)

    this.child = spawn(this.binary, args, {
      cwd: o.workingDir,
      stdio: ['ignore', 'ignore', 'pipe']
    })
    this.child.on('exit', () => { this.exited = true })
    this.child.stderr?.on('data', buf => {
      for (const line of buf.toString().split('\n')) {
        if (line.trim()) console.error('[aria2]', line.trim())
      }
    })

    const deadline = Date.now() + STARTUP_TIMEOUT_MS
    for (;;) {
      if (this.exited) throw new Error('aria2 daemon exited during startup')
      try {
        const v = await this.call('aria2.getVersion')
        console.log(`[aria2] daemon up on port ${this.port} (aria2 ${v.version})`)
        return
      } catch (err) {
        if (Date.now() > deadline) {
          throw new Error(`aria2 daemon did not become ready: ${err.message}`)
        }
        await new Promise(r => setTimeout(r, 200))
      }
    }
  }

  // Serialize RPC: the main tick and IPC status requests can overlap, and
  // concurrent posts to aria2's HTTP endpoint produced mismatched batch
  // responses (measured: a batch answered with the PREVIOUS batch's ids).
  // aria2 answers locally in <1 ms, so the queue costs nothing.
  _postLocked (body) {
    this._rpcChain ??= Promise.resolve()
    const run = this._rpcChain.then(() => this._post(body))
    this._rpcChain = run.catch(() => {})
    return run
  }

  _post (body) {
    return new Promise((resolve, reject) => {
      if (this.exited) return reject(new Error('aria2 daemon is not running'))
      const req = http.request({
        host: '127.0.0.1',
        port: this.port,
        path: '/jsonrpc',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // never reuse sockets: a keep-alive connection can hand a later
        // request a stale buffered response when requests overlap
        agent: false,
        timeout: RPC_TIMEOUT_MS
      }, res => {
        let data = ''
        res.on('data', c => { data += c })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { reject(new Error(`aria2 RPC: bad response (${res.statusCode})`)) }
        })
      })
      req.on('timeout', () => { req.destroy(new Error('aria2 RPC timed out')) })
      req.on('error', reject)
      req.end(JSON.stringify(body))
    })
  }

  /** Single RPC call. `params` are WITHOUT the token — it is prepended. */
  async call (method, params = []) {
    const id = this.nextId++
    const res = await this._postLocked({
      jsonrpc: '2.0', id: String(id), method,
      params: [`token:${this.secret}`, ...params]
    })
    if (res.error) throw new Error(`aria2 ${method}: ${res.error.message} (${res.error.code})`)
    return res.result
  }

  /** Batch several calls into one HTTP round-trip. → array of results (throws on first error). */
  async batch (calls) {
    // capture the id range NOW: nextId advances while we await, and looking
    // it up afterwards would compare against ids allocated by other RPCs
    // (measured: correct responses rejected as "missing entry")
    const firstId = this.nextId
    const body = calls.map(([method, params = []], i) => ({
      jsonrpc: '2.0', id: String(firstId + i), method,
      params: [`token:${this.secret}`, ...params]
    }))
    this.nextId += calls.length
    const res = await this._postLocked(body)
    if (!Array.isArray(res)) throw new Error('aria2 batch: expected array response')
    const byId = new Map(res.map(r => [r.id, r]))
    return calls.map((_, i) => {
      const r = byId.get(String(firstId + i))
      if (!r) {
        console.error('[aria2] batch mismatch — expected ids:',
          calls.map((_, j) => String(firstId + j)),
          'received:', JSON.stringify(res))
        throw new Error('aria2 batch: missing response entry')
      }
      if (r.error) throw new Error(`aria2 batch: ${r.error.message} (${r.error.code})`)
      return r.result
    })
  }

  async shutdown () {
    try {
      if (!this.exited) await this.call('aria2.shutdown')
    } catch { /* fall through to kill */ }
    if (this.child && !this.exited) {
      await new Promise(resolve => {
        const t = setTimeout(() => { try { this.child.kill('SIGKILL') } catch {}; resolve() }, 2000)
        this.child.once('exit', () => { clearTimeout(t); resolve() })
      })
    }
  }

  kill () {
    try { this.child?.kill('SIGKILL') } catch { /* already gone */ }
  }
}
