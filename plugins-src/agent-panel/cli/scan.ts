import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type Run = { runId: string; sessions: string[] }
export type AgentFile = { id: string; transcript: string; meta: string }

function sessionsOf(runJson: string): string[] {
  try {
    const data = JSON.parse(readFileSync(runJson, 'utf8')) as { sessions?: unknown }
    return Array.isArray(data.sessions) ? data.sessions.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

function runIn(runs: string, sessionId: string): Run | null {
  for (const entry of readdirSync(runs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const sessions = sessionsOf(join(runs, entry.name, 'run.json'))
    if (sessions.includes(sessionId)) return { runId: entry.name, sessions }
  }
  return null
}

export function findRun(cwd: string, sessionId: string): Run | null {
  // The lead may run in a subfolder of the repo that holds .team-runs.
  let dir = cwd
  for (;;) {
    const runs = join(dir, '.team-runs')
    if (existsSync(runs)) return runIn(runs, sessionId)
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function findLead(projects: string, sessionId: string, known: string | undefined): string | null {
  if (known !== undefined && existsSync(known)) return known
  if (!existsSync(projects)) return null
  // Worktrees and temp folders encode to other folder names, so the session id is the only key.
  for (const folder of readdirSync(projects)) {
    const path = join(projects, folder, `${sessionId}.jsonl`)
    if (existsSync(path)) return path
  }
  return null
}

export function agentFiles(leadPath: string): AgentFile[] {
  const dir = join(leadPath.replace(/\.jsonl$/, ''), 'subagents')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => /^agent-.+\.jsonl$/.test(f))
    .sort()
    .map((f) => {
      const id = f.slice('agent-'.length, -'.jsonl'.length)
      return { id, transcript: join(dir, f), meta: join(dir, `agent-${id}.meta.json`) }
    })
}
