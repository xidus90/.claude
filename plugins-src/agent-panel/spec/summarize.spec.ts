import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { main, summarize } from '../cli/summarize.ts'
import type { Summary } from '../shared/summary.ts'
import { apiError, assistant, tempDir } from './helpers.ts'

type World = { home: string; config: string; repo: string; cache: string; projects: string }

function world(): World {
  const home = tempDir()
  const repo = tempDir()
  const projects = join(home, '.claude', 'projects')
  return { home, config: join(home, '.claude'), repo, cache: join(tempDir(), 'agent-panel', 's.json'), projects }
}

function lead(w: World, folder: string, session: string, body: string): string {
  mkdirSync(join(w.projects, folder), { recursive: true })
  const path = join(w.projects, folder, `${session}.jsonl`)
  writeFileSync(path, body)
  return path
}

const subagentsDir = (leadPath: string) => join(leadPath.replace(/\.jsonl$/, ''), 'subagents')

function agent(leadPath: string, id: string, meta: object | string, body: string): void {
  const dir = subagentsDir(leadPath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `agent-${id}.jsonl`), body)
  writeFileSync(join(dir, `agent-${id}.meta.json`), typeof meta === 'string' ? meta : JSON.stringify(meta))
}

function teamRun(w: World, sessions: string[]): void {
  mkdirSync(join(w.repo, '.team-runs', 'r1'), { recursive: true })
  writeFileSync(join(w.repo, '.team-runs', 'r1', 'run.json'), JSON.stringify({ generation: sessions.length, sessions }))
}

const opts = (w: World, session: string) => ({ session, cwd: w.repo, config: w.config, cache: w.cache })

test('summarizes a plain session: the lead and its subagents', () => {
  const w = world()
  const l = lead(w, 'C--repo', 's1', JSON.stringify({ type: 'assistant', effort: 'xhigh', message: { id: 'm1', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { output_tokens: 20 } } }) + '\n')
  agent(l, 'a1', { name: 'probe', agentType: 'Explore' }, assistant({ id: 'x1', model: 'claude-haiku-5-5' }))
  const s = summarize(opts(w, 's1'))
  assert.equal(s.runId, null)
  assert.deepEqual(s.generations, ['s1'])
  assert.deepEqual(s.agents.map((a) => [a.id, a.kind, a.name, a.role, a.task]), [
    ['lead:s1', 'lead', 'Lead', 'lead', ''],
    ['a1', 'agent', 'probe', 'Explore', 'probe'],
  ])
  assert.equal(s.agents[1]?.model, 'claude-haiku-5-5')
  assert.equal(s.agents[0]?.effort, 'xhigh')
  assert.equal(s.agents[1]?.effort, '')
  // A second call takes the meta from the cache file.
  assert.deepEqual(summarize(opts(w, 's1')).agents.map((a) => a.name), ['Lead', 'probe'])
})

test('one line with a model that is not a string does not take down the whole summary', () => {
  const w = world()
  const l = lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  const bad = JSON.stringify({ type: 'assistant', message: { id: 'x1', model: 5, stop_reason: 'end_turn', usage: { output_tokens: 20 } } }) + '\n'
  agent(l, 'a1', { name: 'impl-T1', agentType: 'implementer' }, bad)
  const s = summarize(opts(w, 's1'))
  assert.equal(s.agents.find((a) => a.kind === 'lead')?.tokens.output, 20)
  assert.equal(s.agents.find((a) => a.id === 'a1')?.tokens.output, 20)
})

test('an agent meta whose type or name is not a string does not take down the whole summary', () => {
  const w = world()
  const l = lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  agent(l, 'a1', { name: { toString: 0 }, customAgentType: 5 }, assistant({ id: 'x1' }))
  const s = summarize(opts(w, 's1'))
  assert.deepEqual(s.problems, [])
  assert.equal(s.agents.find((a) => a.id === 'a1')?.tokens.output, 20)
})

test('a cache entry of the wrong shape is read from scratch, not kept forever', () => {
  const w = world()
  const l = lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  summarize(opts(w, 's1'))
  const data = JSON.parse(readFileSync(w.cache, 'utf8')) as { files: Record<string, unknown> }
  data.files[l] = {}
  writeFileSync(w.cache, JSON.stringify(data))
  summarize(opts(w, 's1'))
  const s = summarize(opts(w, 's1'))
  assert.deepEqual(s.problems, [])
  assert.equal(s.agents[0]?.tokens.output, 20)
})

test('summarizes every generation of a team run, wherever its transcript lives', () => {
  const w = world()
  teamRun(w, ['s1', 's2'])
  const l1 = lead(w, 'C--repo', 's1', assistant({ id: 'm1' }) + apiError('server_error'))
  agent(l1, 'aimpl-T1-1', { name: 'impl-T1', customAgentType: 'implementer-backend' }, assistant({ id: 'x' }))
  lead(w, 'C--repo--claude-worktrees-w', 's2', assistant({ id: 'm2' }))
  const s = summarize(opts(w, 's2'))
  assert.equal(s.runId, 'r1')
  assert.deepEqual(s.generations, ['s1', 's2'])
  assert.deepEqual(s.agents.map((a) => [a.id, a.sessionId, a.end]), [
    ['lead:s1', 's1', 'error'],
    ['aimpl-T1-1', 's1', 'answered'],
    ['lead:s2', 's2', 'answered'],
  ])
  assert.equal(s.agents[0]?.errorText, 'server_error')
  assert.deepEqual([s.agents[1]?.role, s.agents[1]?.task], ['implementer-backend', 'impl T1'])
})

test('reports a generation without transcript and keeps the rest', () => {
  const w = world()
  teamRun(w, ['gone', 's2'])
  lead(w, 'C--repo', 's2', assistant({ id: 'm2' }))
  const s = summarize(opts(w, 's2'))
  assert.deepEqual(s.problems, ['kein Transkript für Sitzung gone'])
  assert.deepEqual(s.agents.map((a) => a.id), ['lead:s2'])
})

test('falls back to the description, then the id, when a meta file says little or is broken', () => {
  const w = world()
  const l = lead(w, 'C--repo', 's1', '')
  agent(l, 'a1', { description: 'Look around' }, '')
  agent(l, 'a2', '{', '')
  const s = summarize(opts(w, 's1'))
  assert.deepEqual(s.agents.map((a) => [a.name, a.role]), [['Lead', 'lead'], ['Look around', 'agent'], ['a2', 'agent']])
})

const notStrings: unknown[] = [5, true, {}, [], [1], { toString: 0 }, [{ toString: 0 }]]

// A lead, a clean agent a2 and an agent a1 with the given meta file; `cached` plants an entry for a1's meta in the cache file.
function summaryWithBadMeta(file: object, cached?: object): Summary {
  const w = world()
  const l = lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  agent(l, 'a1', file, '')
  agent(l, 'a2', { name: 'impl-T1', agentType: 'team:coder' }, '')
  if (cached) {
    const metas = { [join(subagentsDir(l), 'agent-a1.meta.json')]: cached }
    mkdirSync(dirname(w.cache), { recursive: true })
    writeFileSync(w.cache, JSON.stringify({ version: 4, files: {}, metas, leads: {} }))
  }
  return summarize(opts(w, 's1'))
}

function assertBadMetaIgnored(s: Summary, label: string): void {
  assert.deepEqual(s.problems, [], label)
  assert.deepEqual(s.agents.map((a) => [a.id, a.name, a.role, a.task]), [
    ['lead:s1', 'Lead', 'lead', ''],
    ['a1', 'a1', 'agent', 'a1'],
    ['a2', 'impl-T1', 'coder', 'impl T1'],
  ], label)
}

for (const field of ['customAgentType', 'agentType', 'name', 'description']) {
  test(`a meta.json ${field} that is not a string counts as absent and does not take down the summary`, () => {
    for (const value of notStrings) assertBadMetaIgnored(summaryWithBadMeta({ [field]: value }), JSON.stringify(value))
  })

  test(`a cached meta ${field} that is not a string counts as absent and does not take down the summary`, () => {
    for (const value of notStrings) assertBadMetaIgnored(summaryWithBadMeta({ name: 'clean', agentType: 'team:coder' }, { [field]: value }), JSON.stringify(value))
  })
}

test('a cached meta keeps its string fields and loses the rest', () => {
  const s = summaryWithBadMeta({ name: 'from the file' }, { name: 'cached', customAgentType: 5, agentType: 'team:coder' })
  const a1 = s.agents.find((a) => a.id === 'a1')
  assert.deepEqual([a1?.name, a1?.role], ['cached', 'coder'])
})

test('a meta.json field that is not a string yields to the next field that is', () => {
  const w = world()
  const l = lead(w, 'C--repo', 's1', '')
  agent(l, 'a1', { customAgentType: [], agentType: 'team:coder', name: { toString: 0 }, description: 'Look around' }, '')
  const s = summarize(opts(w, 's1'))
  assert.deepEqual(s.agents.map((a) => [a.name, a.role, a.task]), [['Lead', 'lead', ''], ['Look around', 'coder', 'Look around']])
})

test('reads only what was added since the last call, and sums unreadable lines', () => {
  const w = world()
  const l = lead(w, 'C--repo', 's1', assistant({ id: 'm1' }) + '{oops\n')
  assert.equal(summarize(opts(w, 's1')).agents[0]?.tokens.output, 20)
  writeFileSync(l, assistant({ id: 'm1' }) + '{oops\n' + assistant({ id: 'm2' }))
  const s = summarize(opts(w, 's1'))
  assert.equal(s.agents[0]?.tokens.output, 40)
  assert.equal(s.unreadableLines, 1)
})

test('a JSON null line is counted as unreadable and does not block the transcript', () => {
  const w = world()
  lead(w, 'C--repo', 's1', 'null\n' + assistant({ id: 'm1' }))
  const s = summarize(opts(w, 's1'))
  assert.deepEqual(s.problems, [])
  assert.equal(s.unreadableLines, 1)
  assert.equal(s.agents[0]?.tokens.output, 20)
})

test('reports a transcript it cannot read and goes on', () => {
  const w = world()
  const l = lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  const dir = join(l.replace(/\.jsonl$/, ''), 'subagents')
  mkdirSync(join(dir, 'agent-a1.jsonl'), { recursive: true })
  const s = summarize(opts(w, 's1'))
  assert.equal(s.agents.length, 1)
  assert.match(s.problems[0] ?? '', /^kann .*agent-a1\.jsonl nicht lesen: /)
})

test('a last line with a hostile token count does not take down the whole summary', () => {
  const w = world()
  const hostile = { input_tokens: { toString: 0 }, output_tokens: 5, cache_creation: { ephemeral_1h_input_tokens: { toString: 0 } } }
  lead(w, 'C--repo', 's1', assistant({ id: 'm1' }) + assistant({ id: 'm2', usage: hostile }))
  const s = summarize(opts(w, 's1'))
  assert.deepEqual(s.problems, [])
  assert.deepEqual(s.agents.map((a) => a.tokens), [{ input: 10, output: 25, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }])
})

test('main prints a finite cost and numeric tokens for counts out of range or of the wrong type', () => {
  const w = world()
  const line = (id: string, input: string) => assistant({ id, usage: { input_tokens: '@@', output_tokens: 20 } }).replace('"@@"', input)
  lead(w, 'C--repo', 's1', line('m1', '1e999') + line('m2', '"7"'))
  let out = ''
  main(['--session', 's1', '--cwd', w.repo, '--config', w.config, '--cache', w.cache], (s) => (out += s), () => {})
  const a = (JSON.parse(out) as Summary).agents[0]
  assert.equal(a?.tokens.input, 0)
  assert.equal(a?.tokens.output, 40)
  assert.equal(a?.costUsd, 40 * 20 / 1e6)
})

test('main prints one JSON line and returns 0', () => {
  const w = world()
  lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  let out = ''
  const code = main(['--session', 's1', '--cwd', w.repo, '--config', w.config, '--cache', w.cache], (s) => (out += s), () => {})
  assert.equal(code, 0)
  assert.ok(out.endsWith('\n'))
  assert.equal((JSON.parse(out) as Summary).agents.length, 1)
})

test('main summarizes in full when a file sits where the cache folder should be', () => {
  const w = world()
  lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  let out = ''
  const root = tempDir()
  writeFileSync(join(root, 'agent-panel'), '')
  const code = main(['--session', 's1', '--cwd', w.repo, '--config', w.config, '--cache', join(root, 'agent-panel', 's.json')], (s) => (out += s), () => {})
  const s = JSON.parse(out) as Summary
  assert.equal(code, 0)
  assert.deepEqual([s.agents.map((a) => a.id), s.problems], [['lead:s1'], []])
})

test('keeps the summary and adds a problem line when the cache cannot be written', () => {
  const w = world()
  lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  // A folder at the cache path lets the cache be read as empty but makes the final rename fail.
  mkdirSync(w.cache, { recursive: true })
  const s = summarize(opts(w, 's1'))
  assert.deepEqual(s.agents.map((a) => a.id), ['lead:s1'])
  assert.equal(s.problems.length, 1)
  assert.match(s.problems[0] ?? '', /^Cache nicht gespeichert: /)
})

test('keeps the summary and adds a problem line when the cache folder cannot be created', () => {
  const w = world()
  lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  // A null byte makes mkdir fail with an error that says nothing about the path being taken.
  const s = summarize({ ...opts(w, 's1'), cache: join(tempDir(), 'a\0b', 's.json') })
  assert.deepEqual(s.agents.map((a) => a.id), ['lead:s1'])
  assert.equal(s.problems.length, 1)
  assert.match(s.problems[0] ?? '', /^Cache nicht gespeichert: /)
})

test('main reports a failure inside the summary and still returns 0', () => {
  const w = world()
  lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  let out = ''
  // A file where the run folder should be makes the run lookup throw.
  writeFileSync(join(w.repo, '.team-runs'), '')
  const code = main(['--session', 's1', '--cwd', w.repo, '--config', w.config, '--cache', w.cache], (s) => (out += s), () => {})
  const s = JSON.parse(out) as Summary
  assert.equal(code, 0)
  assert.deepEqual([s.generations, s.agents], [['s1'], []])
  assert.match(s.problems[0] ?? '', /^Zusammenfassung gescheitert: /)
})

test('main refuses missing or unknown arguments with 2', () => {
  let err = ''
  assert.equal(main(['--session', 's1'], () => {}, (s) => (err += s)), 2)
  assert.match(err, /usage: summarize\.ts --session/)
  assert.equal(main(['--bogus', 'x'], () => {}, () => {}), 2)
})

test('runs as a script', () => {
  const w = world()
  lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  const script = join(import.meta.dirname, '..', 'cli', 'summarize.ts')
  const r = spawnSync(process.execPath, [script, '--session', 's1', '--cwd', w.repo, '--config', w.config, '--cache', w.cache], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal((JSON.parse(r.stdout) as Summary).agents[0]?.id, 'lead:s1')
})
