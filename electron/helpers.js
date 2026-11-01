// Pure helpers shared by the Electron main process.
// Ports of the Rust utilities in src-tauri/src/torrent.rs (slug safety, dir stats,
// disk space) so behavior stays identical to the Tauri app.

import fs from 'node:fs'
import path from 'node:path'

// --- slug safety (exact parity with sanitize_slug in torrent.rs) ---

export function sanitizeSlug (slug) {
  if (typeof slug !== 'string' || slug.length === 0) throw new Error('Slug is empty')
  if (slug.includes('/') || slug.includes('\\') || slug.includes('..') || slug.includes('\0')) {
    throw new Error(`Invalid slug: '${slug}' — path traversal detected`)
  }
  if (!/^[0-9a-zA-Z_-]+$/.test(slug)) {
    throw new Error(`Invalid slug: '${slug}' — only alphanumeric, hyphens, and underscores allowed`)
  }
}

export function slugToTitle (slug) {
  return slug.replaceAll('_', ' ')
}

export function slugFromName (name) {
  return name.toLowerCase().replaceAll(' ', '_')
}

// --- path safety ---

export function assertUnderBase (target, base) {
  const canon = fs.realpathSync(target)
  const canonBase = fs.realpathSync(base)
  if (!canon.startsWith(canonBase)) {
    throw new Error(`Path ${canon} is outside base directory ${canonBase}`)
  }
}

// --- directory stats (symlinks skipped on purpose — no walk loops) ---

export function isDirectory (p) {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function dirSize (p) {
  let total = 0
  let entries
  try {
    entries = fs.readdirSync(p, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const child = path.join(p, e.name)
    if (e.isDirectory()) total += dirSize(child)
    else if (e.isFile()) {
      try { total += fs.statSync(child).size } catch { /* raced file */ }
    }
  }
  return total
}

export function dirFileCount (p) {
  let total = 0
  let entries
  try {
    entries = fs.readdirSync(p, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const child = path.join(p, e.name)
    if (e.isDirectory()) total += dirFileCount(child)
    else if (e.isFile()) total += 1
  }
  return total
}

// --- disk space (parity with free_disk_space: available bytes, i64::MAX fallback) ---

export function freeBytes (p) {
  try {
    const s = fs.statfsSync(p)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

// --- JSON persistence (atomic-ish: write tmp, rename) ---

export function loadJson (p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return fallback
  }
}

export function saveJson (p, data) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const tmp = `${p}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.renameSync(tmp, p)
    return true
  } catch (e) {
    console.error(`[helpers] failed to save ${p}:`, e)
    return false
  }
}

// --- formatting (main-process UI strings, e.g. tray tooltip) ---

export function formatBytes (bytes, decimals = 2) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`
}
