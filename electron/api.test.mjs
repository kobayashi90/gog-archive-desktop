// Unit tests for electron/api.js — param building + conversion parity (api.rs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSearchParams, computeFileInfo } from './api.js'

// --- buildSearchParams (gog.squid.wtf API contract) ---

test('default params: limit + page 1, no search, no sort override', () => {
  const p = buildSearchParams({ limit: 48, offset: 0 })
  assert.equal(p.get('limit'), '48')
  assert.equal(p.get('page'), '1')
  assert.equal(p.get('search'), null)
  assert.equal(p.get('sort'), null) // popularity_ranking is skipped
  assert.equal(p.get('order'), null)
})

test('page math: offset 96 / limit 48 → page 3; offset 48 → page 2', () => {
  assert.equal(buildSearchParams({ limit: 48, offset: 96 }).get('page'), '3')
  assert.equal(buildSearchParams({ limit: 48, offset: 48 }).get('page'), '2')
  assert.equal(buildSearchParams({ limit: 48, offset: 47 }).get('page'), '1')
  assert.equal(buildSearchParams({ limit: 48, offset: 0 }).get('page'), '1')
})

test('search param is set only when non-empty', () => {
  assert.equal(buildSearchParams({ query: 'witcher' }).get('search'), 'witcher')
  assert.equal(buildSearchParams({ query: '' }).get('search'), null)
})

test('list params: ONE ||-joined value per key; trimming; empties skipped', () => {
  const p = buildSearchParams({ genres: 'RPG|| Action ||', tags: 'Singleplayer' })
  assert.equal(p.get('genre'), 'RPG||Action')
  assert.equal(p.getAll('genre').length, 1) // repeated keys = first wins on the API
  assert.equal(p.get('tag'), 'Singleplayer')
})

test('array list params (component call shape) join with ||', () => {
  const p = buildSearchParams({ genres: ['Strategy', 'Role-playing'], tags: [] })
  assert.equal(p.get('genre'), 'Strategy||Role-playing')
  assert.equal(p.has('tag'), false)
})

test('null/undefined list params are skipped', () => {
  const p = buildSearchParams({ genres: null, tags: undefined, developers: '' })
  assert.equal(p.has('genre'), false)
  assert.equal(p.has('tag'), false)
  assert.equal(p.has('developer'), false)
})

test('sort: explicit non-default gets sort+order; empty sort skipped', () => {
  const p = buildSearchParams({ sort: 'title', order: 'DESC' })
  assert.equal(p.get('sort'), 'title')
  assert.equal(p.get('order'), 'DESC')
  assert.equal(buildSearchParams({ sort: '' }).get('sort'), null)
  assert.equal(buildSearchParams({ sort: 'popularity_ranking' }).get('sort'), null)
  assert.equal(buildSearchParams({ sort: 'title', order: '' }).get('order'), null)
})

// --- computeFileInfo (api.rs compute_file_info parity) ---

test('empty/invalid files map → (0, null)', () => {
  assert.deepEqual(computeFileInfo(null), { fileCount: 0, totalSize: null })
  assert.deepEqual(computeFileInfo({}), { fileCount: 0, totalSize: null })
  assert.deepEqual(computeFileInfo([]), { fileCount: 0, totalSize: null })
})

test('size parsing: GB/MB/KB/TB/bare units', () => {
  const r = computeFileInfo({
    dir: [
      { name: 'a', size: '1.5 GB' },
      { name: 'b', size: '200 MB' },
      { name: 'c', size: '512 KB' },
      { name: 'd', size: '1 TB' },
      { name: 'e', size: '100' }
    ]
  })
  assert.equal(r.fileCount, 5)
  assert.equal(r.totalSize, Math.floor(1.5 * 1024 ** 3 + 200 * 1024 ** 2 + 512 * 1024 + 1024 ** 4 + 100))
})

test('non-empty map → totalSize always Some (0 when no sizes)', () => {
  const r = computeFileInfo({ dir: [{ name: 'a', size: null }, { name: 'b' }] })
  assert.equal(r.fileCount, 2)
  assert.equal(r.totalSize, 0)
})

test('entries with missing size still count; nested lists concatenated', () => {
  const r = computeFileInfo({
    d1: [{ name: 'a', size: '10 MB' }],
    d2: [{ name: 'b', size: '5 MB' }, { name: 'c', size: null }]
  })
  assert.equal(r.fileCount, 3)
  assert.equal(r.totalSize, 15 * 1024 * 1024)
})

test('garbage sizes parse as 0, not NaN', () => {
  const r = computeFileInfo({ dir: [{ name: 'a', size: 'not-a-size' }] })
  assert.equal(r.totalSize, 0)
})
