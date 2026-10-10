import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyCache, isPrivateDir, loadCache, saveCache } from '../cli/cache.ts'
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

const POSIX = process.platform === 'win32' ? { skip: 'needs POSIX owners and modes' } : {}

function victimIn(dir: string): string {
  const victim = join(dir, 'victim.txt')
  writeFileSync(victim, 'precious')
  return victim
}

test('does not write through a link planted at the temp name of an earlier version', () => {
  const victim = victimIn(tempDir())
  const dir = join(tempDir(), 'agent-panel')
  mkdirSync(dir)
  const path = join(dir, 's1.json')
  linkSync(victim, `${path}.${process.pid}.tmp`)
  saveCache(path, emptyCache())
  assert.equal(readFileSync(victim, 'utf8'), 'precious')
  assert.deepEqual(loadCache(path), emptyCache())
})

test('creates the temp file exclusively, so an existing name is never written to', () => {
  const victim = victimIn(tempDir())
  const dir = join(tempDir(), 'agent-panel')
  mkdirSync(dir)
  const path = join(dir, 's1.json')
  linkSync(victim, `${path}.fixed.tmp`)
  assert.throws(() => saveCache(path, emptyCache(), () => 'fixed'), { code: 'EEXIST' })
  assert.equal(readFileSync(victim, 'utf8'), 'precious')
})

test('names the temp file differently on every save', () => {
  const dir = join(tempDir(), 'agent-panel')
  const names: string[] = []
  const suffix = () => {
    const name = `n${names.length}`
    names.push(name)
    return name
  }
  saveCache(join(dir, 's1.json'), emptyCache(), suffix)
  saveCache(join(dir, 's1.json'), emptyCache(), suffix)
  assert.deepEqual(names, ['n0', 'n1'])
  assert.deepEqual(readdirSync(dir), ['s1.json'])
})

test('neither saves into nor loads from a folder that is a link', () => {
  const target = tempDir()
  const link = join(tempDir(), 'agent-panel')
  symlinkSync(target, link, 'junction')
  saveCache(join(link, 's1.json'), emptyCache())
  assert.deepEqual(readdirSync(target), [])
  writeFileSync(join(target, 's1.json'), JSON.stringify({ ...emptyCache(), leads: { s1: 'planted.jsonl' } }))
  assert.deepEqual(loadCache(join(link, 's1.json')), emptyCache())
})

test('a folder is private when it is a real folder of the current user that others cannot write to', () => {
  const folder = (uid: number, mode: number, isDirectory = true) => ({ isDirectory: () => isDirectory, uid, mode })
  assert.equal(isPrivateDir(folder(1000, 0o40700), 1000), true)
  assert.equal(isPrivateDir(folder(1000, 0o40755), 1000), true)
  assert.equal(isPrivateDir(folder(0, 0o40700), 1000), false)
  assert.equal(isPrivateDir(folder(1000, 0o40770), 1000), false)
  assert.equal(isPrivateDir(folder(1000, 0o40702), 1000), false)
  assert.equal(isPrivateDir(folder(1000, 0o40777), 1000), false)
  assert.equal(isPrivateDir(folder(1000, 0o120777, false), 1000), false)
  // Windows has no owner ids, and its mode bits say nothing about who may write.
  assert.equal(isPrivateDir(folder(0, 0o40777), undefined), true)
  assert.equal(isPrivateDir(folder(0, 0o40777, false), undefined), false)
})

test('creates the folder and the cache file readable by its owner only', POSIX, () => {
  const dir = join(tempDir(), 'agent-panel')
  saveCache(join(dir, 's1.json'), emptyCache())
  assert.equal(statSync(dir).mode & 0o777, 0o700)
  assert.equal(statSync(join(dir, 's1.json')).mode & 0o777, 0o600)
})

test('neither saves into nor loads from a folder others can write to', POSIX, () => {
  const dir = join(tempDir(), 'agent-panel')
  mkdirSync(dir)
  writeFileSync(join(dir, 's1.json'), JSON.stringify({ ...emptyCache(), leads: { s1: 'planted.jsonl' } }))
  chmodSync(dir, 0o777)
  saveCache(join(dir, 's2.json'), emptyCache())
  assert.deepEqual(readdirSync(dir), ['s1.json'])
  assert.deepEqual(loadCache(join(dir, 's1.json')), emptyCache())
  chmodSync(dir, 0o770)
  assert.deepEqual(loadCache(join(dir, 's1.json')), emptyCache())
})
