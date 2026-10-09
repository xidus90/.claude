import type { AgentSummary, Summary, TokenCounts } from '../shared/summary.ts'

export type LiveAgent = { id: string; status: string }
export type Glyph = '●' | '✓' | '✗' | '⊘'
export type Row = { key: string; glyph: Glyph; label: string; model: string; cost: string; tokens: string; time: string; note: string; detail: string }
export type Group = { key: string; title: string; cost: string; tokens: string; time: string; costUsd: number; isRunning: boolean; rows: Row[] }
export type View = { title: string; totals: string; counts: string; notices: string[]; groups: Group[] }
export type ViewInput = {
  summary: Summary | null
  live: LiveAgent[]
  reportedCostUsd: number | null
  costIncludesAgents: boolean
  now: number
  error: string
}

const MISMATCH = 0.1

const LIVE: Record<string, Glyph> = { completed: '✓', failed: '✗', killed: '✗' }
const COLORS: Record<Glyph, string> = { '●': 'cyan', '✓': 'green', '✗': 'red', '⊘': 'yellow' }

export const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

export const fmtTokens = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : `${n}`

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

const tokenSum = (t: TokenCounts): number => t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h

function modelName(id: string): string {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  if (!m) return id || '—'
  const family = (m[1] as string).toLowerCase()
  return `${family[0]?.toUpperCase()}${family.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

function byTranscript(a: AgentSummary): Glyph {
  return a.end === 'error' ? '✗' : a.end === 'answered' ? '✓' : '⊘'
}

function glyphOf(a: AgentSummary, live: Map<string, string>, current: string): Glyph {
  if (a.kind === 'lead') return a.sessionId === current ? '●' : byTranscript(a)
  const status = live.get(a.id)
  // Unknown statuses are new ways of being alive; the done ones are listed.
  if (status !== undefined) return LIVE[status] ?? '●'
  return byTranscript(a)
}

function endOf(a: AgentSummary, glyph: Glyph, now: number): number | null {
  return glyph === '●' ? now : a.lastAt
}

function wallClock(agents: AgentSummary[], glyphs: Map<AgentSummary, Glyph>, generations: string[], now: number): number {
  let total = 0
  for (const g of generations) {
    const members = agents.filter((a) => a.sessionId === g && a.firstAt !== null)
    if (members.length === 0) continue
    const start = Math.min(...members.map((a) => a.firstAt as number))
    // A transcript with a first time also has a last one.
    const end = Math.max(...members.map((a) => endOf(a, glyphs.get(a) as Glyph, now) as number))
    total += end - start
  }
  return total
}

function noteOf(a: AgentSummary, glyph: Glyph): string {
  if (glyph === '✗') return a.errorText || 'gescheitert'
  return glyph === '⊘' ? 'abgebrochen' : ''
}

export function buildView(input: ViewInput): View {
  const notices = input.error ? [`⚠ ${input.error}`] : []
  const s = input.summary
  if (!s) return { title: 'Agents', totals: input.error ? '' : 'lade …', counts: '', notices, groups: [] }
  if (s.unreadableLines > 0) notices.push(`⚠ ${s.unreadableLines} Zeilen unlesbar`)
  for (const p of s.problems) notices.push(`⚠ ${p}`)

  const current = s.generations[s.generations.length - 1] as string
  const live = new Map(input.live.map((l) => [l.id, l.status]))
  const glyphs = new Map(s.agents.map((a) => [a, glyphOf(a, live, current)]))
  const isTeam = s.runId !== null

  const rowOf = (a: AgentSummary): Row => {
    const glyph = glyphs.get(a) as Glyph
    const gen = s.generations.indexOf(a.sessionId) + 1
    const label = a.kind === 'lead' ? (s.generations.length > 1 ? `Gen ${gen}` : 'Lead') : isTeam ? a.task : a.name
    const ended = endOf(a, glyph, input.now)
    const isCurrentLead = a.kind === 'lead' && a.sessionId === current
    const reported = isCurrentLead && input.reportedCostUsd !== null ? `gemeldet ${fmtCost(input.reportedCostUsd)}` : ''
    return {
      key: a.id,
      glyph,
      label,
      model: modelName(a.model),
      cost: a.unpriced ? '?' : fmtCost(a.costUsd),
      tokens: fmtTokens(tokenSum(a.tokens)),
      time: fmtTime(a.firstAt === null ? 0 : (ended as number) - a.firstAt),
      note: reported || noteOf(a, glyph),
      // Cache reads dwarf the rest, so the total alone says little.
      detail: `in ${fmtTokens(a.tokens.input)} · out ${fmtTokens(a.tokens.output)} · read ${fmtTokens(a.tokens.cacheRead)} · write ${fmtTokens(a.tokens.cacheWrite5m)}/${fmtTokens(a.tokens.cacheWrite1h)}`,
    }
  }

  const buckets = new Map<string, AgentSummary[]>()
  for (const a of s.agents) {
    const key = a.kind === 'lead' ? 'lead' : isTeam ? a.role : 'agents'
    buckets.set(key, [...(buckets.get(key) ?? []), a])
  }
  const groups: Group[] = [...buckets].map(([key, members]) => {
    // Leads stay in generation order; agents put the running ones first, then go by start.
    const sorted = key === 'lead'
      ? members
      : [...members].sort((x, y) =>
          Number(glyphs.get(y) === '●') - Number(glyphs.get(x) === '●') || (x.firstAt ?? 0) - (y.firstAt ?? 0))
    const costUsd = members.reduce((n, a) => n + a.costUsd, 0)
    return {
      key,
      title: key === 'lead' ? (isTeam ? 'Lead (Orchestrator)' : 'Lead') : key === 'agents' ? 'Agents' : key,
      cost: fmtCost(costUsd),
      tokens: fmtTokens(members.reduce((n, a) => n + tokenSum(a.tokens), 0)),
      time: fmtTime(wallClock(members, glyphs, s.generations, input.now)),
      costUsd,
      isRunning: members.some((a) => glyphs.get(a) === '●'),
      rows: sorted.map(rowOf),
    }
  })
  groups.sort((x, y) => Number(y.isRunning) - Number(x.isRunning) || y.costUsd - x.costUsd)

  const total = s.agents.reduce((n, a) => n + a.costUsd, 0)
  const unpriced = s.agents.filter((a) => a.unpriced).length
  const wall = wallClock(s.agents, glyphs, s.generations, input.now)
  const tokens = s.agents.reduce((n, a) => n + tokenSum(a.tokens), 0)

  const reported = input.reportedCostUsd
  if (reported !== null && reported > 0) {
    const scope = s.agents.filter((a) => a.sessionId === current && (input.costIncludesAgents || a.kind === 'lead'))
    const base = scope.reduce((n, a) => n + a.costUsd, 0)
    if (Math.abs(reported - base) / reported > MISMATCH) {
      notices.push(`⚠ Preistabelle prüfen: gemeldet ${fmtCost(reported)}, errechnet ${fmtCost(base)}`)
    }
  }

  const agentGlyphs = s.agents.filter((a) => a.kind === 'agent').map((a) => glyphs.get(a) as Glyph)
  const count = (g: Glyph) => agentGlyphs.filter((x) => x === g).length
  const counts = [`● ${count('●')}`, `✓ ${count('✓')}`, `✗ ${count('✗')}`, ...(count('⊘') ? [`⊘ ${count('⊘')}`] : [])].join('  ')

  const gens = s.generations.length
  return {
    title: isTeam ? `Lauf ${s.runId}${gens > 1 ? ` (Gen 1–${gens})` : ''}` : 'Diese Sitzung',
    totals: `≈ ${fmtCost(total)}   ${fmtTokens(tokens)} Tok   ${fmtTime(wall)}${unpriced ? `   ohne ${unpriced} Agents` : ''}`,
    counts,
    notices,
    groups,
  }
}

export const groupLine = (g: Group, isCollapsed: boolean): string =>
  `${isCollapsed ? '▸' : '▾'} ${g.title}  ${g.cost}  ${g.tokens}  ${g.time}`

export const rowLine = (r: Row): string =>
  `${r.label}  ${r.model}  ${r.cost}  ${r.tokens}  ${r.time}${r.note ? `  ${r.note}` : ''}`

export const detailLine = (r: Row): string => `      ${r.detail}`

export const glyphColor = (g: Glyph): string => COLORS[g]

export function parseResult(r: { exitCode: number; stdout: string; stderr: string }): { summary: Summary | null; error: string } {
  if (r.exitCode !== 0) return { summary: null, error: `summarize exit ${r.exitCode}: ${r.stderr.trim().slice(0, 200)}` }
  try {
    const data = JSON.parse(r.stdout) as Partial<Summary>
    return Array.isArray(data.agents) ? { summary: data as Summary, error: '' } : { summary: null, error: 'summarize: unerwartete Ausgabe' }
  } catch {
    return { summary: null, error: 'summarize: Ausgabe ist kein JSON' }
  }
}

export function startError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return /ENOENT|not found|nicht gefunden/i.test(text) ? `node nicht gefunden: ${text}` : `summarize gescheitert: ${text}`
}

// The probe (docs/.superpowers/smoke/2026-10-09-agent-panel-probe.md) records the shape this build reports.
const COST_FIELDS = ['usd', 'totalUsd', 'total_cost_usd'] as const

export function reportedCost(cost: unknown): number | null {
  if (typeof cost === 'number') return Number.isFinite(cost) ? cost : null
  if (typeof cost !== 'object' || cost === null) return null
  const record = cost as Record<string, unknown>
  for (const field of COST_FIELDS) {
    const value = record[field]
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
  }
  return null
}

export function scriptArgs(script: string, session: string, cwd: string, home: string, tmp: string): string[] {
  return ['node', script, '--session', session, '--cwd', cwd, '--home', home, '--cache', `${tmp}/agent-panel/${session}.json`]
}

export type DirEnv = { USERPROFILE?: string | undefined; HOME?: string | undefined; TEMP?: string | undefined; TMPDIR?: string | undefined }

export const dirsOf = (env: DirEnv): { home: string; tmp: string } => ({
  home: env.USERPROFILE ?? env.HOME ?? '',
  tmp: env.TEMP ?? env.TMPDIR ?? '/tmp',
})

export function toggle(set: Set<string>, key: string): void {
  if (set.has(key)) set.delete(key)
  else set.add(key)
}
