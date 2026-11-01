// Unit tests for electron/helpers.js — parity with the Rust utilities.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  sanitizeSlug, slugToTitle, slugFromName, assertUnderBase,
  isDirectory, dirSize, dirFileCount, freeBytes, loadJson, saveJson, formatBytes
} from './helpers.js'

test('sanitizeSlug accepts valid slugs', () => {
  sanitizeSlug('half_life_2')
  sanitizeSlug('game-name')
  sanitizeSlug('Game123')
  sanitizeSlug('_leading')
})

test('sanitizeSlug rejects traversal and bad chars', () => {
  assert.throws(() => sanitizeSlug(''), /Slug is empty/)
  assert.throws(() => sanitizeSlug(null), /Slug is empty/)
  assert.throws(() => sanitizeSlug('a/b'), /traversal/)
  assert.throws(() => sanitizeSlug('..'), /traversal/)
  assert.throws(() => sanitizeSlug('a..b'), /traversal/)
  assert.throws(() => sanitizeSlug('a\\b'), /traversal/)
  assert.throws(() => sanitizeSlug('a\0b'), /traversal/)
  assert.throws(() => sanitizeSlug('a b'), /only alphanumeric/)
  assert.throws(() => sanitizeSlug('a.b'), /only alphanumeric/)
})

test('slugToTitle / slugFromName', () => {
  assert.equal(slugToTitle('half_life_2'), 'half life 2')
  assert.equal(slugFromName('Half Life 2'), 'half_life_2')
})

test('assertUnderBase blocks escapes and allows inside paths', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gog-base-'))
  const inside = path.join(base, 'sub')
  fs.mkdirSync(inside)
  assert.doesNotThrow(() => assertUnderBase(inside, base))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'gog-out-'))
  assert.throws(() => assertUnderBase(outside, base), /outside base/)
  assert.throws(() => assertUnderBase(path.join(base, 'missing'), base), /ENOENT/)
})

test('isDirectory / dirSize / dirFileCount walk nested trees', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gog-tree-'))
  fs.mkdirSync(path.join(base, 'a', 'b'), { recursive: true })
  fs.writeFileSync(path.join(base, 'f1'), 'x'.repeat(100))
  fs.writeFileSync(path.join(base, 'a', 'f2'), 'y'.repeat(50))
  fs.writeFileSync(path.join(base, 'a', 'b', 'f3'), 'z'.repeat(25))
  assert.equal(isDirectory(base), true)
  assert.equal(isDirectory(path.join(base, 'f1')), false)
  assert.equal(isDirectory(path.join(base, 'nope')), false)
  assert.equal(dirSize(base), 175)
  assert.equal(dirFileCount(base), 3)
  assert.equal(dirSize(path.join(base, 'missing')), 0)
  assert.equal(dirFileCount(path.join(base, 'missing')), 0)
})

test('freeBytes returns a positive number', () => {
  const v = freeBytes(fs.mkdtempSync(path.join(os.tmpdir(), 'gog-free-')))
  assert.ok(v > 0)
})

test('saveJson / loadJson roundtrip; 2-space indent, no trailing newline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gog-json-'))
  const p = path.join(dir, 'nested', 'x.json')
  const data = { slug_a: { done: true, n: 1 }, slug_b: { done: false } }
  assert.equal(saveJson(p, data), true)
  const raw = fs.readFileSync(p, 'utf8')
  assert.equal(raw.endsWith('\n'), false) // Tauri to_string_pretty parity
  assert.ok(raw.includes('\n  "slug_a"')) // 2-space indent
  assert.deepEqual(loadJson(p, {}), data)
  assert.deepEqual(loadJson(path.join(dir, 'missing.json'), { d: 1 }), { d: 1 })
  fs.writeFileSync(path.join(dir, 'bad.json'), '{nope')
  assert.deepEqual(loadJson(path.join(dir, 'bad.json'), 'fb'), 'fb')
})

test('formatBytes', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(-5), '0 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(1536), '1.50 KB')
  assert.equal(formatBytes(1024 ** 3 * 2.5), '2.50 GB')
  assert.equal(formatBytes(NaN), '0 B')
})
