// Settings coverage guard: every coded setting must be reachable in the
// Settings menu, and the menu must never bind a key the backend ignores.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultSettings, loadSettings } from './settings.js'

// Legacy: still carried in the schema so old configs round-trip untouched,
// but nothing reads it anymore (the redesign fixed the accent at white), so
// it deliberately has no menu control — a color picker bound to a dead key
// would be a fake control.
const MENU_HIDDEN = ['accent_color']

const menuSource = fs.readFileSync(
  new URL('../src/lib/Settings.svelte', import.meta.url),
  'utf8'
)
const menuBindings = new Set(
  [...menuSource.matchAll(/\bs\.([a-z_]+)/g)].map(m => m[1])
)

test('every coded setting is shown in the settings menu', () => {
  const missing = Object.keys(defaultSettings('/tmp/x'))
    .filter(k => !MENU_HIDDEN.includes(k) && !menuBindings.has(k))
  assert.deepEqual(missing, [], `settings with no menu control: ${missing.join(', ')}`)
})

test('the menu binds no setting the schema does not define', () => {
  const known = new Set(Object.keys(defaultSettings('/tmp/x')))
  const unknown = [...menuBindings].filter(k => !known.has(k))
  assert.deepEqual(unknown, [], `menu controls for non-existent settings: ${unknown.join(', ')}`)
})

test('advanced settings carry the previous spawn-time defaults', () => {
  const d = defaultSettings('/tmp/x')
  assert.equal(d.file_allocation, 'falloc')
  assert.equal(d.max_tries, 0)
  assert.equal(d.retry_wait, 5)
})

test('legacy configs keep unknown keys and gain the new defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gog-settings-'))
  try {
    const file = path.join(dir, 'config.json')
    fs.writeFileSync(file, JSON.stringify({ download_dir: '/custom', accent_color: '#4fc3f7' }))
    const s = loadSettings(file, '/default-dl')
    assert.equal(s.download_dir, '/custom')
    assert.equal(s.accent_color, '#4fc3f7') // round-trips untouched
    assert.equal(s.file_allocation, 'falloc')
    assert.equal(s.max_tries, 0)
    assert.equal(s.retry_wait, 5)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
