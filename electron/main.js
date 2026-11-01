// GOG Archive Desktop — Electron main process.
// Ports the Tauri shell (src-tauri/src/lib.rs): frameless window, tray menu,
// 200 ms status emitter, close guard, settings bootstrap.

import {
  app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification,
  protocol, shell, Tray
} from 'electron'
import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiClient } from './api.js'
import { Engine } from './engine.js'
import { collectStatus, registerIpc } from './ipc.js'
import { loadSettings, settingsPath } from './settings.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const DEV = process.env.VITE_DEV === '1'
const DEV_URL = 'http://localhost:1420'

// app:// must be registered as a privileged scheme before app ready — it gives
// the renderer a real origin so the CSP 'self' works (file:// can't do this)
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // svelte injects <style> tags
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-src 'none'",
  "form-action 'none'"
].join('; ')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  boot()
}

function boot () {
  // --- shared singletons ----------------------------------------------------
  const configBase = app.getPath('appData') // Linux: ~/.config (Tauri dirs parity)
  const cfgPath = settingsPath(configBase)
  const defaultDownloads = path.join(app.getPath('home'), 'Downloads')
  const settings = loadSettings(cfgPath, defaultDownloads)
  if (!settings.download_dir) settings.download_dir = defaultDownloads

  const api = new ApiClient()
  const engine = new Engine(settings, {})
  registerIpc({ settings, settingsPath: cfgPath, engine, api })

  let win = null
  let tray = null
  let forceClose = false
  let quitting = false
  let viteChild = null
  let ticking = false
  let statusInterval = null

  // --- helpers --------------------------------------------------------------

  function fmtRate (bytes) {
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
    let i = 0
    let v = bytes
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(2)} ${units[i]}`
  }

  // tray tooltip — exact formats from lib.rs
  function tooltipFor (statuses) {
    const active = statuses.filter(s => s.state === 'downloading' || s.state === 'metadata' || s.state === 'checking')
    if (!active.length) return 'GOG Archive Desktop'
    const totalRate = active.reduce((a, s) => a + s.download_rate, 0)
    const rate = fmtRate(totalRate)
    if (active.length === 1) {
      const s = active[0]
      return `${s.title || s.name} — ${(s.progress * 100).toFixed(1)}% — ${rate}`
    }
    const avg = active.reduce((a, s) => a + s.progress, 0) / active.length
    return `${active.length} downloads — ${(avg * 100).toFixed(1)}% avg — ${rate}`
  }

  function showWindow () {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus() // replaces the kdotool windowactivate hack (todo M-5)
  }

  function drainDone () {
    if (!win || win.isDestroyed()) return
    for (const ev of engine.doneQueue.splice(0)) {
      win.webContents.send('download-progress', ev)
      if (settings.notify_on_complete && !win.isFocused()) {
        new Notification({ title: 'GOG Archive Desktop', body: `Download complete: ${ev.name}` }).show()
      }
    }
  }

  async function statusTick () {
    if (ticking || !win || win.isDestroyed()) return
    ticking = true
    try {
      const statuses = await collectStatus(engine, api, settings)
      if (win && !win.isDestroyed()) {
        win.webContents.send('torrent-status', statuses)
        tray?.setToolTip(tooltipFor(statuses))
      }
      drainDone()
    } catch (err) {
      console.error('[main] status tick failed:', err)
    } finally {
      ticking = false
    }
  }

  // --- protocol / dev server ------------------------------------------------

  function registerAppProtocol () {
    protocol.handle('app', async request => {
      let url
      try {
        url = new URL(request.url)
      } catch {
        return new Response('Bad request', { status: 400 })
      }
      const rel = path.normalize(decodeURIComponent(url.pathname))
      let file = path.join(DIST, rel)
      if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 })
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        if (path.extname(rel)) return new Response('Not found', { status: 404 })
        file = path.join(DIST, 'index.html') // SPA fallback
      }
      if (process.env.GOG_DEBUG_PROTOCOL) {
        console.log(`[protocol] ${request.method} ${request.url} -> ${file}`)
      }
      // NB: Electron main's global fetch is Chromium's and cannot read file://
      // URLs ("not implemented... yet") — read from disk directly instead.
      const body = fs.readFileSync(file)
      const headers = new Headers({
        'Content-Security-Policy': CSP,
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
      })
      return new Response(body, { status: 200, headers })
    })
  }

  function waitForPort (port, timeoutMs = 20_000) {
    const start = Date.now()
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const socket = net.connect(port, '127.0.0.1')
        const done = ok => {
          socket.removeAllListeners()
          socket.destroy()
          if (ok) resolve()
          else if (Date.now() - start > timeoutMs) reject(new Error(`dev server on :${port} did not start`))
          else setTimeout(attempt, 250)
        }
        socket.once('connect', () => done(true))
        socket.once('error', () => done(false))
      }
      attempt()
    })
  }

  // --- window ---------------------------------------------------------------

  function createWindow () {
    win = new BrowserWindow({
      width: 1400,
      height: 850,
      minWidth: 900,
      minHeight: 600,
      frame: false, // custom titlebar (decorations: false parity)
      backgroundColor: '#08080a',
      show: false, // wait for ready-to-show (no flash)
      title: 'GOG Archive Desktop',
      icon: path.join(__dirname, 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false
      }
    })

    win.once('ready-to-show', () => win?.show())

    // close guard (exact Tauri prompt)
    win.on('close', e => {
      if (forceClose || !engine.hasActiveTorrents()) return
      e.preventDefault()
      const { response } = dialog.showMessageBoxSync(win, {
        type: 'question',
        title: 'GOG Archive Desktop',
        message: 'You have active downloads. Quit anyway?',
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      })
      if (response === 0) {
        forceClose = true
        win.close()
      }
    })

    win.on('closed', () => { win = null })

    // block stray navigation/window opens (links go through open_url)
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {})
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      const allowed = DEV ? url.startsWith(DEV_URL) : url.startsWith('app://')
      if (!allowed) event.preventDefault()
    })

    if (DEV) win.loadURL(DEV_URL)
    else win.loadURL('app://bundle/index.html')
  }

  // --- tray (menu ids exactly as lib.rs) ------------------------------------

  function trayMenuClick (item) {
    const id = item.id
    if (id === 'quit') {
      // route through the close guard (Tauri's tray quit bypassed it — we don't)
      if (win && !win.isDestroyed()) win.close()
      else app.quit()
      return
    }
    if (id === 'show' || id === 'downloads' || id === 'settings') {
      win?.webContents.send('tray-action', id)
      showWindow()
      return
    }
    if (id === 'pause_all' || id === 'resume_all') {
      win?.webContents.send('tray-action', id)
    }
  }

  function createTray () {
    try {
      tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png')))
    } catch (err) {
      console.error('[main] tray unavailable:', err)
      return
    }
    tray.setToolTip('GOG Archive Desktop')
    const item = (id, label) => ({ id, label, click: trayMenuClick })
    tray.setContextMenu(Menu.buildFromTemplate([
      item('show', 'Open GOG Archive Desktop'),
      { type: 'separator' },
      item('downloads', 'Downloads'),
      item('settings', 'Settings'),
      { type: 'separator' },
      item('pause_all', 'Pause All'),
      item('resume_all', 'Resume All'),
      { type: 'separator' },
      item('quit', 'Quit')
    ]))
    tray.on('click', () => showWindow())
  }

  // --- lifecycle ------------------------------------------------------------

  function startDevServer () {
    // spawn vite directly (not through `pnpm exec`, whose wrapper swallows
    // the SIGTERM on quit and leaves an orphaned vite on :1420)
    viteChild = spawn('node', ['node_modules/vite/bin/vite.js'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env
    })
    viteChild.on('exit', code => {
      if (code && code !== 0 && !quitting) console.error(`[main] vite exited with code ${code}`)
    })
  }

  app.on('second-instance', () => showWindow())

  app.whenReady().then(async () => {
    // window controls (frameless titlebar + renderer tray path)
    ipcMain.handle('win-ctl', (_event, op) => {
      if (!win || win.isDestroyed()) return null
      switch (op) {
        case 'minimize': win.minimize(); break
        case 'unminimize': win.unminimize(); break
        case 'toggleMaximize': win.isMaximized() ? win.unmaximize() : win.maximize(); break
        case 'show': win.show(); break
        case 'setFocus': win.focus(); break
        case 'close': win.close(); break
      }
      return null
    })

    ipcMain.handle('pick-folder', async () => {
      const opts = { properties: ['openDirectory'] }
      const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (result.canceled || !result.filePaths.length) return null
      return result.filePaths[0]
    })

    if (DEV) {
      startDevServer()
      try {
        await waitForPort(1420)
      } catch (err) {
        console.error('[main]', err.message)
      }
    } else {
      if (!fs.existsSync(path.join(DIST, 'index.html'))) {
        dialog.showErrorBox('GOG Archive Desktop', 'Frontend build missing — run `pnpm build` first.')
        app.quit()
        return
      }
      registerAppProtocol()
    }

    createWindow()
    createTray()
    statusInterval = setInterval(statusTick, 200)
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', event => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    if (statusInterval) clearInterval(statusInterval)
    if (viteChild) { viteChild.kill('SIGTERM'); viteChild = null }
    // H-4: graceful engine shutdown, then hard-exit (skips remaining handlers)
    engine.shutdown().finally(() => app.exit(0))
  })
}
