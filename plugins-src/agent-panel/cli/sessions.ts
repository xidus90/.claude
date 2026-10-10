import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionInfo } from '../shared/summary.ts'

const LIMIT = 20
const LIVE_MS = 60_000
const HEAD = 16 * 1024
const TAIL = 64 * 1024
// The app's names for a session nobody has named yet.
const PLACEHOLDER = new Set(['Untitled session', 'New session'])

type Found = { path: string; config: string; folder: string; id: string; mtime: number }

const children = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** The own config folder first, then every `.claude` or `.claude-*` in the home that holds projects. */
export function configsOf(home: string, own: string): string[] {
  const found = children(home)
    .filter((name) => name === '.claude' || name.startsWith('.claude-'))
    .map((name) => join(home, name))
    .filter((dir) => existsSync(join(dir, 'projects')))
  return [own, ...found.filter((dir) => dir !== own)]
}

function transcripts(config: string): Found[] {
  const projects = join(config, 'projects')
  return children(projects).flatMap((folder) =>
    children(join(projects, folder))
      .filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) => {
        const path = join(projects, folder, name)
        const st = statSync(path)
        return st.isFile() ? [{ path, config, folder, id: name.slice(0, -6), mtime: st.mtimeMs }] : []
      }),
  )
}

// The head can hold the app's title; the tail the newest title, prompt and cwd.
function edges(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const size = statSync(path).size
    const read = (from: number, length: number): string => {
      const buf = Buffer.alloc(length)
      readSync(fd, buf, 0, length, from)
      return buf.toString('utf8')
    }
    return size <= HEAD + TAIL ? read(0, size) : `${read(0, HEAD)}\n${read(size - TAIL, TAIL)}`
  } finally {
    closeSync(fd)
  }
}

function lineOf(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function infoOf(f: Found, now: number): SessionInfo {
  let title = ''
  let prompt = ''
  let cwd = ''
  for (const raw of edges(f.path).split('\n')) {
    const l = lineOf(raw)
    if (!l) continue
    if (l.type === 'custom-title' && typeof l.customTitle === 'string' && !PLACEHOLDER.has(l.customTitle)) title = l.customTitle
    if (l.type === 'last-prompt' && typeof l.lastPrompt === 'string') prompt = l.lastPrompt
    if (typeof l.cwd === 'string') cwd = l.cwd
  }
  // A transcript names a Windows or a POSIX folder whatever the host is, so split on both separators.
  const project = cwd.split(/[\\/]/).filter(Boolean).pop() ?? f.folder
  return { id: f.id, config: f.config, project, title: title || prompt || f.id.slice(0, 8), cwd, lastAt: f.mtime, isLive: now - f.mtime <= LIVE_MS }
}

export function listSessions(configs: string[], now: number): SessionInfo[] {
  const recent = configs.flatMap(transcripts).sort((x, y) => y.mtime - x.mtime).slice(0, LIMIT)
  return recent.map((f) => infoOf(f, now)).sort((x, y) => Number(y.isLive) - Number(x.isLive) || y.lastAt - x.lastAt)
}
