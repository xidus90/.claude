import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configsOf, listSessions } from '../cli/sessions.ts'
import { tempDir } from './helpers.ts'

const NOW = Date.parse('2026-10-10T12:00:00.000Z')

function session(config: string, folder: string, id: string, lines: object[], mtime: number): string {
  const dir = join(config, 'projects', folder)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${id}.jsonl`)
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  utimesSync(path, mtime / 1000, mtime / 1000)
  return path
}

test('lists sessions of every config, live ones first, then by last change', () => {
  const a = tempDir()
  const b = tempDir()
  session(a, 'C--repo', 's-old', [{ type: 'user', cwd: 'C:/repo' }], NOW - 3_600_000)
  session(a, 'C--repo', 's-live', [{ type: 'user', cwd: 'C:/repo' }], NOW - 10_000)
  session(b, 'C--other', 's-mid', [{ type: 'user', cwd: 'C:/other' }], NOW - 120_000)
  const list = listSessions([a, b], NOW)
  assert.deepEqual(list.map((s) => [s.id, s.isLive, s.config === b]), [['s-live', true, false], ['s-mid', false, true], ['s-old', false, false]])
  assert.equal(list[0]?.lastAt, NOW - 10_000)
})

test('counts a transcript as live up to 60 seconds after its last change', () => {
  const a = tempDir()
  session(a, 'C--r', 'edge', [{ type: 'user' }], NOW - 60_000)
  session(a, 'C--r', 'past', [{ type: 'user' }], NOW - 60_001)
  assert.deepEqual(listSessions([a], NOW).map((s) => [s.id, s.isLive]), [['edge', true], ['past', false]])
})

test('keeps the 20 most recent sessions', () => {
  const a = tempDir()
  for (let i = 0; i < 25; i++) session(a, 'C--r', `s${i}`, [{ type: 'user' }], NOW - 3_600_000 - i * 1000)
  const list = listSessions([a], NOW)
  assert.equal(list.length, 20)
  assert.equal(list[19]?.id, 's19')
})

test('takes the app title, else the last prompt, else the short id', () => {
  const a = tempDir()
  session(a, 'C--r', 'titled', [{ type: 'custom-title', customTitle: 'Agent-team fortsetzen' }, { type: 'last-prompt', lastPrompt: 'later' }], NOW - 5_000_000)
  session(a, 'C--r', 'untitled', [{ type: 'custom-title', customTitle: 'Untitled session' }, { type: 'last-prompt', lastPrompt: 'Fix the bars' }], NOW - 5_001_000)
  session(a, 'C--r', 'new', [{ type: 'custom-title', customTitle: 'New session' }], NOW - 5_002_000)
  session(a, 'C--r', 'abcdef1234', [{ type: 'user' }], NOW - 5_003_000)
  assert.deepEqual(listSessions([a], NOW).map((s) => s.title), ['Agent-team fortsetzen', 'Fix the bars', 'new', 'abcdef12'])
})

test('reads the title from the head and the cwd from the tail of a long transcript', () => {
  const a = tempDir()
  const filler = Array.from({ length: 3000 }, (_, i) => ({ type: 'assistant', pad: 'x'.repeat(40), i }))
  session(a, 'C--r', 'long', [{ type: 'custom-title', customTitle: 'Head title' }, ...filler, { type: 'user', cwd: 'C:/work/wt' }], NOW - 1000)
  const [s] = listSessions([a], NOW)
  assert.equal(s?.title, 'Head title')
  assert.equal(s?.cwd, 'C:/work/wt')
  assert.equal(s?.project, 'wt')
})

test('falls back to the project folder when no line names a cwd, and skips broken lines', () => {
  const a = tempDir()
  const dir = join(a, 'projects', 'C--Users-u-repo')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'raw.jsonl'), 'not json\n[1]\n{"type":"user","cwd":5}\n')
  const [s] = listSessions([a], NOW)
  assert.equal(s?.cwd, '')
  assert.equal(s?.project, 'C--Users-u-repo')
})

test('leaves out subagent transcripts and copes with missing or odd folders', () => {
  const a = tempDir()
  const lead = session(a, 'C--r', 'lead', [{ type: 'user' }], NOW - 1000)
  const sub = join(lead.replace(/\.jsonl$/, ''), 'subagents')
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(sub, 'agent-x.jsonl'), '{}\n')
  writeFileSync(join(a, 'projects', 'stray.jsonl'), '{}\n')
  // A folder named like a transcript is no session.
  mkdirSync(join(a, 'projects', 'C--r', 'dir.jsonl'))
  assert.deepEqual(listSessions([a, join(a, 'missing')], NOW).map((s) => s.id), ['lead'])
})

test('finds the config folders in the home, the own one first and none twice', () => {
  const home = tempDir()
  for (const d of ['.claude', '.claude-b', '.claudex', '.claude-c']) mkdirSync(join(home, d), { recursive: true })
  for (const d of ['.claude', '.claude-b', '.claudex']) mkdirSync(join(home, d, 'projects'), { recursive: true })
  assert.deepEqual(configsOf(home, join(home, '.claude-b')), [join(home, '.claude-b'), join(home, '.claude')])
  assert.deepEqual(configsOf(join(home, 'missing'), '/own'), ['/own'])
})
