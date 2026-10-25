import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentFiles, findLead, findRun } from '../cli/scan.ts'
import { tempDir } from './helpers.ts'

function repoWithRuns(): string {
  const repo = tempDir()
  mkdirSync(join(repo, '.team-runs', 'r1'), { recursive: true })
  mkdirSync(join(repo, '.team-runs', 'r2'), { recursive: true })
  mkdirSync(join(repo, '.team-runs', 'r3'), { recursive: true })
  writeFileSync(join(repo, '.team-runs', '.gitignore'), '*\n')
  writeFileSync(join(repo, '.team-runs', 'r1', 'run.json'), JSON.stringify({ generation: 1 }))
  writeFileSync(join(repo, '.team-runs', 'r2', 'run.json'), JSON.stringify({ generation: 2, sessions: ['s1', 7, 's2'] }))
  writeFileSync(join(repo, '.team-runs', 'r3', 'run.json'), '{')
  return repo
}

test('finds the run that lists the session, in generation order', () => {
  assert.deepEqual(findRun(repoWithRuns(), 's2'), { runId: 'r2', sessions: ['s1', 's2'] })
})

test('finds the run from a subfolder', () => {
  const repo = repoWithRuns()
  const sub = join(repo, 'docs', 'deep')
  mkdirSync(sub, { recursive: true })
  assert.equal(findRun(sub, 's1')?.runId, 'r2')
})

test('finds no run for a session no run lists, nor where no .team-runs exists', () => {
  assert.equal(findRun(repoWithRuns(), 'other'), null)
  assert.equal(findRun(tempDir(), 's1'), null)
})

test('finds the lead transcript in any project folder, and trusts a known path that still exists', () => {
  const home = tempDir()
  const projects = join(home, 'projects')
  mkdirSync(join(projects, 'C--a'), { recursive: true })
  mkdirSync(join(projects, 'C--b'), { recursive: true })
  const lead = join(projects, 'C--b', 's1.jsonl')
  writeFileSync(lead, '')
  assert.equal(findLead(projects, 's1', undefined), lead)
  assert.equal(findLead(projects, 's1', lead), lead)
  assert.equal(findLead(projects, 's1', join(projects, 'gone.jsonl')), lead)
  assert.equal(findLead(projects, 'nope', undefined), null)
  assert.equal(findLead(join(home, 'missing'), 's1', undefined), null)
})

test('lists the agent transcripts of a lead with their meta files', () => {
  const dir = tempDir()
  const lead = join(dir, 's1.jsonl')
  const sub = join(dir, 's1', 'subagents')
  mkdirSync(sub, { recursive: true })
  for (const f of ['agent-b2.jsonl', 'agent-a1.jsonl', 'agent-a1.meta.json', 'notes.txt']) writeFileSync(join(sub, f), '')
  assert.deepEqual(agentFiles(lead), [
    { id: 'a1', transcript: join(sub, 'agent-a1.jsonl'), meta: join(sub, 'agent-a1.meta.json') },
    { id: 'b2', transcript: join(sub, 'agent-b2.jsonl'), meta: join(sub, 'agent-b2.meta.json') },
  ])
  assert.deepEqual(agentFiles(join(dir, 'lonely.jsonl')), [])
})
