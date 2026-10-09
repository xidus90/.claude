import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyCache, loadCache, saveCache } from '../cli/cache.ts'
import { emptyState } from '../cli/transcript.ts'
import { tempDir } from './helpers.ts'

test('starts empty when the file is missing, unreadable or of another version', () => {
  const dir = tempDir()
  assert.deepEqual(loadCache(join(dir, 'none.json')), emptyCache())
  writeFileSync(join(dir, 'bad.json'), '{')
  assert.deepEqual(loadCache(join(dir, 'bad.json')), emptyCache())
  writeFileSync(join(dir, 'old.json'), JSON.stringify({ version: 0, files: {}, metas: {}, leads: {} }))
  assert.deepEqual(loadCache(join(dir, 'old.json')), emptyCache())
  writeFileSync(join(dir, 'v1.json'), JSON.stringify({ version: 1, files: { 'a.jsonl': emptyState() }, metas: {}, leads: { s1: 'lead.jsonl' } }))
  assert.deepEqual(loadCache(join(dir, 'v1.json')), emptyCache())
  writeFileSync(join(dir, 'part.json'), JSON.stringify({ version: 2, files: {} }))
  assert.deepEqual(loadCache(join(dir, 'part.json')), emptyCache())
  writeFileSync(join(dir, 'noleads.json'), JSON.stringify({ version: 2, files: {}, metas: {} }))
  assert.deepEqual(loadCache(join(dir, 'noleads.json')), emptyCache())
})

test('saves into a new folder and loads back what it saved, leaving no temp file', () => {
  const dir = join(tempDir(), 'agent-panel')
  const path = join(dir, 's1.json')
  const cache = { ...emptyCache(), files: { 'a.jsonl': emptyState() }, metas: { 'a.meta.json': { name: 'impl-T1' } }, leads: { s1: 'lead.jsonl' } }
  saveCache(path, cache)
  assert.deepEqual(loadCache(path), cache)
  assert.deepEqual(readdirSync(dir), ['s1.json'])
})
