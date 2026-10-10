import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { loadCache, saveCache } from './cache.ts'
import { parseMeta, roleOf, taskOf, type Meta } from './classify.ts'
import { agentFiles, findLead, findRun } from './scan.ts'
import { emptyState, endOf, readTranscript, totals, type FileState } from './transcript.ts'
import type { AgentSummary, Summary } from '../shared/summary.ts'

export type Options = { session: string; cwd: string; home: string; cache: string }

type Source = { id: string; transcript: string; meta: string | null }

function metaOf(path: string, known: Record<string, Meta>): Meta | null {
  try {
    // The cache file is as untrusted as the meta file it copies from.
    const meta = parseMeta(known[path] ?? JSON.parse(readFileSync(path, 'utf8')))
    known[path] = meta
    return meta
  } catch {
    return null
  }
}

function toSummary(src: Source, sessionId: string, state: FileState, meta: Meta | null): AgentSummary {
  const t = totals(state)
  const isLead = src.meta === null
  const name = isLead ? 'Lead' : meta?.name || meta?.description || src.id
  return {
    id: src.id,
    sessionId,
    kind: isLead ? 'lead' : 'agent',
    name,
    role: isLead ? 'lead' : roleOf(meta ?? {}),
    task: isLead ? '' : taskOf(meta?.name ?? '') || name,
    model: state.model,
    effort: state.effort,
    tokens: t.tokens,
    costUsd: t.costUsd,
    unpriced: t.unpriced,
    firstAt: state.firstAt,
    lastAt: state.lastAt,
    end: endOf(state),
    errorText: state.errorText,
  }
}

export function summarize(o: Options): Summary {
  const cache = loadCache(o.cache)
  const run = findRun(o.cwd, o.session)
  const generations = run ? run.sessions : [o.session]
  const projects = join(o.home, '.claude', 'projects')
  const agents: AgentSummary[] = []
  const problems: string[] = []
  let unreadableLines = 0
  for (const sessionId of generations) {
    const lead = findLead(projects, sessionId, cache.leads[sessionId])
    if (lead === null) {
      problems.push(`kein Transkript für Sitzung ${sessionId}`)
      continue
    }
    cache.leads[sessionId] = lead
    const sources: Source[] = [{ id: `lead:${sessionId}`, transcript: lead, meta: null }, ...agentFiles(lead)]
    for (const src of sources) {
      let state: FileState
      try {
        const cached = cache.files[src.transcript]
        try {
          state = readTranscript(src.transcript, cached ?? emptyState())
        } catch (err) {
          // A damaged cache entry throws; the transcript is the truth, so read it once more from scratch.
          // ponytail: an entry damaged without a throw stays trusted; validate its shape if a foreign cache matters.
          if (!cached) throw err
          state = readTranscript(src.transcript, emptyState())
        }
      } catch (err) {
        problems.push(`kann ${src.transcript} nicht lesen: ${(err as Error).message}`)
        continue
      }
      cache.files[src.transcript] = state
      unreadableLines += state.unreadable
      agents.push(toSummary(src, sessionId, state, src.meta === null ? null : metaOf(src.meta, cache.metas)))
    }
  }
  saveCache(o.cache, cache)
  return { runId: run?.runId ?? null, generations, agents, unreadableLines, problems }
}

const USAGE = 'usage: summarize.ts --session <id> --cwd <dir> --home <dir> --cache <file>\n'

export function main(argv: string[], write: (s: string) => void, fail: (s: string) => void): number {
  let values: Partial<Options>
  try {
    values = parseArgs({
      args: argv,
      options: { session: { type: 'string' }, cwd: { type: 'string' }, home: { type: 'string' }, cache: { type: 'string' } },
    }).values
  } catch {
    fail(USAGE)
    return 2
  }
  const { session, cwd, home, cache } = values
  if (!session || !cwd || !home || !cache) {
    fail(USAGE)
    return 2
  }
  let summary: Summary
  try {
    summary = summarize({ session, cwd, home, cache })
  } catch (err) {
    // The panel shows problems as lines; a non-zero exit would only hide this one.
    summary = { runId: null, generations: [session], agents: [], unreadableLines: 0, problems: [`Zusammenfassung gescheitert: ${(err as Error).message}`] }
  }
  write(JSON.stringify(summary) + '\n')
  return 0
}

/* node:coverage disable */
// Runs only as a child process; the spawn test in spec/summarize.spec.ts covers it.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2), (s) => process.stdout.write(s), (s) => process.stderr.write(s))
}
/* node:coverage enable */
