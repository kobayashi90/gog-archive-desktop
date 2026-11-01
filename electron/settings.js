// Settings persistence — same location as the Tauri app:
//   <config_dir>/gog-archive/config.json   (Linux: ~/.config/gog-archive/config.json)
// Existing Tauri installs carry over untouched.

import path from 'node:path'
import { loadJson, saveJson } from './helpers.js'

// New in v2.0: seed_ratio / seed_hours — enforced by the engine (the Tauri
// versions of similar fields were stored but never applied).
//   seed_ratio: stop seeding at this upload ratio (0 = seed indefinitely)
//   seed_hours: stop seeding after N hours of being complete (0 = no limit)
export function defaultSettings (downloadsDir) {
  return {
    download_dir: downloadsDir,
    dht: true,
    lsd: true,
    accent_color: '#4fc3f7', // legacy field, kept for config compatibility
    download_rate_limit: 0, // kB/s, 0 = unlimited
    upload_rate_limit: 0, // kB/s, 0 = unlimited
    proxy_url: '', // applied via aria2 --all-proxy (hot-applied on save)
    max_peers: 0, // per-torrent connection cap, 0 = engine default
    listen_port: 0, // 0 = random
    file_allocation: 'falloc', // none | fastalloc | falloc | prealloc
    max_tries: 0, // 0 = retry forever
    retry_wait: 5, // seconds between retries
    notify_on_complete: true,
    skip_file_selector: false,
    seed_ratio: 0,
    seed_hours: 0
  }
}

export function settingsPath (configBase) {
  return path.join(configBase, 'gog-archive', 'config.json')
}

export function loadSettings (file, downloadsDir) {
  const defaults = defaultSettings(downloadsDir)
  const raw = loadJson(file, null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    saveJson(file, defaults)
    return { ...defaults }
  }
  // Merge so configs from older versions gain new fields with safe defaults.
  return { ...defaults, ...raw }
}

export function saveSettings (file, settings) {
  return saveJson(file, settings)
}
