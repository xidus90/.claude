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
  writeFileSync(join(dir, 'part.json'), JSON.stringify({ version: 4, files: {} }))
  assert.deepEqual(loadCache(join(dir, 'part.json')), emptyCache())
  writeFileSync(join(dir, 'noleads.json'), JSON.stringify({ version: 4, files: {}, metas: {} }))
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
// Root passes every permission check, so a denied folder only denies anyone else.
const UNPRIVILEGED = process.platform === 'win32' || process.getuid?.() === 0 ? { skip: 'needs a denied folder and a user it binds' } : {}

function victimIn(dir: string): string {
  const victim = join(dir, 'victim.txt')
  writeFileSync(victim, 'precious')
  return victim
}

test('does not write through a link planted at a predictable temp name, and still saves', () => {
  const victim = victimIn(tempDir())
  const dir = join(tempDir(), 'agent-panel')
  mkdirSync(dir)
  const path = join(dir, 's1.json')
  const cache = { ...emptyCache(), leads: { s1: 'lead.jsonl' } }
  linkSync(victim, `${path}.${process.pid}.tmp`)
  saveCache(path, cache)
  assert.equal(readFileSync(victim, 'utf8'), 'precious')
  assert.deepEqual(loadCache(path), cache)
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

test('names the temp file with a fresh random id on every save', () => {
  const dir = join(tempDir(), 'agent-panel')
  // A folder at the target makes the final rename fail, so each save leaves its temp file to be counted.
  mkdirSync(join(dir, 's1.json'), { recursive: true })
  for (let i = 0; i < 2; i++) assert.throws(() => saveCache(join(dir, 's1.json'), emptyCache()))
  const temps = readdirSync(dir).filter((name) => name !== 's1.json')
  assert.equal(temps.length, 2)
  for (const name of temps) assert.match(name, /^s1\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/)
})

test('saves nothing and reads nothing where a file sits at the folder path', () => {
  const root = tempDir()
  writeFileSync(join(root, 'agent-panel'), 'not a folder')
  const path = join(root, 'agent-panel', 's1.json')
  saveCache(path, emptyCache())
  assert.deepEqual(loadCache(path), emptyCache())
  assert.equal(readFileSync(join(root, 'agent-panel'), 'utf8'), 'not a folder')
})

test('saves nothing and reads nothing where a link to nowhere sits at the folder path', () => {
  const root = tempDir()
  symlinkSync(join(root, 'gone'), join(root, 'agent-panel'), 'junction')
  const path = join(root, 'agent-panel', 's1.json')
  saveCache(path, emptyCache())
  assert.deepEqual(loadCache(path), emptyCache())
  assert.deepEqual(readdirSync(root), ['agent-panel'])
})

test('reports a folder whose parent leads nowhere, since nothing sits at the folder path itself', () => {
  const root = tempDir()
  symlinkSync(join(root, 'gone'), join(root, 'parent'), 'junction')
  assert.throws(() => saveCache(join(root, 'parent', 'agent-panel', 's1.json'), emptyCache()), { code: 'ENOENT' })
})

test('reports a failure to create the folder other than a non-folder at its path', () => {
  // A null byte makes mkdir fail with an error that says nothing about the path being taken.
  assert.throws(() => saveCache(join(tempDir(), 'a\0b', 's1.json'), emptyCache()), { code: 'ERR_INVALID_ARG_VALUE' })
  assert.deepEqual(loadCache(join(tempDir(), 'a\0b', 's1.json')), emptyCache())
})

test('reports a folder it is not allowed to create', UNPRIVILEGED, () => {
  const parent = tempDir()
  chmodSync(parent, 0o500)
  try {
    assert.throws(() => saveCache(join(parent, 'agent-panel', 's1.json'), emptyCache()), { code: 'EACCES' })
  } finally {
    chmodSync(parent, 0o700)
  }
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
