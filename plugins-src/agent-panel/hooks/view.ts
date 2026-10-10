import type { AgentSummary, Summary, TokenCounts } from '../shared/summary.ts'

export type LiveAgent = { id: string; status: string }
export type Glyph = '●' | '✓' | '✗' | '⊘'
export type Status = 'running' | 'done' | 'failed' | 'aborted'
export type StatusCounts = Record<Status, number>
export type Shares = { input: number; output: number; cacheRead: number; cacheWrite: number }
export type Overview = {
  cost: string
  tokens: string
  time: string
  shares: Shares
  amounts: { input: string; output: string; cacheRead: string; cacheWrite: string }
  line: string
  // What the cost leaves out, as a line of its own; empty when every agent is priced.
  unpriced: string
}
export type Row = { key: string; glyph: Glyph; status: Status; label: string; model: string; effort: string; cost: string; tokens: string; time: string; note: string; detail: string; shares: Shares; meta: string }
export type Group = { key: string; role: string; title: string; cost: string; tokens: string; time: string; costUsd: number; costShare: number; isRunning: boolean; counts: StatusCounts; rows: Row[] }
export type View = { title: string; totals: string; counts: string; notices: string[]; groups: Group[]; status: StatusCounts; overview: Overview }
export type ViewInput = {
  summary: Summary | null
  live: LiveAgent[]
  reportedCostUsd: number | null
  costIncludesAgents: boolean
  now: number
  error: string
}

const MISMATCH = 0.1
// Bounds a pathological name or error, and is no layout rule: the pane cuts a text to its own width, and the
// longest real ones (an error text keeps 80 characters) stay below this.
const MAX_TEXT = 100

const LIVE: Record<string, Glyph> = { completed: '✓', failed: '✗', killed: '✗' }
const COLORS: Record<Glyph, string> = { '●': 'cyan', '✓': 'green', '✗': 'red', '⊘': 'yellow' }

export const fmtCost = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`

export const fmtTokens = (n: number): string => {
  const k = Math.round(n / 1e3)
  return k >= 1e3 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${k}k` : `${n}`
}

export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

const tokenSum = (t: TokenCounts): number => t.input + t.output + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h

const STATUS_OF: Record<Glyph, Status> = { '●': 'running', '✓': 'done', '✗': 'failed', '⊘': 'aborted' }
const noCounts = (): StatusCounts => ({ running: 0, done: 0, failed: 0, aborted: 0 })
const noShares = (): Shares => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

const emptyOverview = (): Overview => ({
  cost: '≈ $0.00', tokens: '0', time: '0:00', shares: noShares(),
  amounts: { input: '0', output: '0', cacheRead: '0', cacheWrite: '0' }, line: '', unpriced: '',
})

export function sharesOf(t: TokenCounts): Shares {
  const total = tokenSum(t)
  if (total === 0) return noShares()
  return { input: t.input / total, output: t.output / total, cacheRead: t.cacheRead / total, cacheWrite: (t.cacheWrite5m + t.cacheWrite1h) / total }
}

const addTokens = (agents: AgentSummary[]): TokenCounts => agents.reduce<TokenCounts>((n, a) => ({
  input: n.input + a.tokens.input,
  output: n.output + a.tokens.output,
  cacheRead: n.cacheRead + a.tokens.cacheRead,
  cacheWrite5m: n.cacheWrite5m + a.tokens.cacheWrite5m,
  cacheWrite1h: n.cacheWrite1h + a.tokens.cacheWrite1h,
}), { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })

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

// The host refuses a whole tree for one control character in a text, and a line break would split a row.
function tidy(text: string): string {
  const flat = text.replace(/[\s\p{Cc}]+/gu, ' ').trim()
  const chars = [...flat]
  return chars.length > MAX_TEXT ? `${chars.slice(0, MAX_TEXT - 1).join('')}…` : flat
}

const tidyAgent = (a: AgentSummary): AgentSummary =>
  ({ ...a, name: tidy(a.name), role: tidy(a.role), task: tidy(a.task), model: tidy(a.model), effort: tidy(a.effort), errorText: tidy(a.errorText) })

export function buildView(input: ViewInput): View {
  // Every text the summary or the script brings in is cleaned here, so nothing below needs to be.
  const error = tidy(input.error)
  const notices = error ? [`⚠ ${error}`] : []
  const raw = input.summary
  const s = raw && { ...raw, runId: raw.runId === null ? null : tidy(raw.runId), agents: raw.agents.map(tidyAgent), problems: raw.problems.map(tidy) }
  if (!s) return { title: 'Agents', totals: error ? '' : 'lade …', counts: '', notices, groups: [], status: noCounts(), overview: emptyOverview() }
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
    const time = fmtTime(a.firstAt === null ? 0 : (ended as number) - a.firstAt)
    return {
      key: a.id,
      glyph,
      status: STATUS_OF[glyph],
      label,
      model: modelName(a.model),
      effort: a.effort,
      cost: a.unpriced ? '?' : fmtCost(a.costUsd),
      tokens: fmtTokens(tokenSum(a.tokens)),
      time,
      note: reported || noteOf(a, glyph),
      // Cache reads dwarf the rest, so the total alone says little.
      detail: `in ${fmtTokens(a.tokens.input)} · out ${fmtTokens(a.tokens.output)} · read ${fmtTokens(a.tokens.cacheRead)} · write ${fmtTokens(a.tokens.cacheWrite5m)}/${fmtTokens(a.tokens.cacheWrite1h)}`,
      shares: sharesOf(a.tokens),
      // A failed or aborted row shows why instead of what it cost.
      meta: [modelName(a.model), a.effort, ...(glyph === '✗' || glyph === '⊘' ? [noteOf(a, glyph)] : [a.unpriced ? '?' : fmtCost(a.costUsd), `⏱ ${time}`, reported])]
        .filter((p) => p !== '').join(' · '),
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
    const counts = noCounts()
    for (const a of members) counts[STATUS_OF[glyphs.get(a) as Glyph]] += 1
    return {
      key,
      role: key,
      title: key === 'lead' ? (isTeam ? 'Lead (Orchestrator)' : 'Lead') : key === 'agents' ? 'Agents' : key,
      cost: fmtCost(costUsd),
      tokens: fmtTokens(members.reduce((n, a) => n + tokenSum(a.tokens), 0)),
      time: fmtTime(wallClock(members, glyphs, s.generations, input.now)),
      costUsd,
      costShare: 0,
      isRunning: members.some((a) => glyphs.get(a) === '●'),
      counts,
      rows: sorted.map(rowOf),
    }
  })
  groups.sort((x, y) => Number(y.isRunning) - Number(x.isRunning) || y.costUsd - x.costUsd)

  const total = s.agents.reduce((n, a) => n + a.costUsd, 0)
  for (const g of groups) g.costShare = total > 0 ? g.costUsd / total : 0
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

  const status = noCounts()
  for (const a of s.agents) if (a.kind === 'agent') status[STATUS_OF[glyphs.get(a) as Glyph]] += 1
  const sum = addTokens(s.agents)
  const overview: Overview = {
    cost: `≈ ${fmtCost(total)}`,
    tokens: fmtTokens(tokens),
    time: fmtTime(wall),
    shares: sharesOf(sum),
    amounts: { input: fmtTokens(sum.input), output: fmtTokens(sum.output), cacheRead: fmtTokens(sum.cacheRead), cacheWrite: fmtTokens(sum.cacheWrite5m + sum.cacheWrite1h) },
    line: `≈ ${fmtCost(total)} · ${fmtTokens(tokens)} · ${fmtTime(wall)}${unpriced ? ` · ohne ${unpriced} Agents` : ''}`,
    unpriced: unpriced ? `ohne ${unpriced} Agents` : '',
  }

  const gens = s.generations.length
  return {
    title: isTeam ? `Lauf ${s.runId}${gens > 1 ? ` (Gen 1–${gens})` : ''}` : 'Diese Sitzung',
    totals: `≈ ${fmtCost(total)}   ${fmtTokens(tokens)} Tok   ${fmtTime(wall)}${unpriced ? `   ohne ${unpriced} Agents` : ''}`,
    counts,
    notices,
    groups,
    status,
    overview,
  }
}

export const statusLine = (c: StatusCounts): string =>
  `● läuft ${c.running}   ✓ fertig ${c.done}   ✗ gescheitert ${c.failed}   ⊘ abgebrochen ${c.aborted}`

export const countsLine = (c: StatusCounts): string =>
  [`● ${c.running}`, `✓ ${c.done}`, ...(c.failed ? [`✗ ${c.failed}`] : []), ...(c.aborted ? [`⊘ ${c.aborted}`] : [])].join('  ')

export const visibleRows = (g: Group, hideDone: boolean): Row[] => (hideDone ? g.rows.filter((r) => r.status !== 'done') : g.rows)

export const groupLine = (g: Group, isCollapsed: boolean): string =>
  `${isCollapsed ? '▸' : '▾'} ${g.title}  ${g.cost}  ${g.tokens}  ${g.time}`

export const rowLine = (r: Row): string =>
  `${r.label}  ${r.model}  ${r.cost}  ${r.tokens}  ${r.time}${r.note ? `  ${r.note}` : ''}`

export const detailLine = (r: Row): string => `      ${r.detail}`

export const glyphColor = (g: Glyph): string => COLORS[g]

export function parseResult(r: { exitCode: number; stdout: string; stderr: string }): { summary: Summary | null; error: string } {
  if (r.exitCode !== 0) return { summary: null, error: `summarize exit ${r.exitCode}: ${r.stderr.trim()}` }
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

export const isOpen = (panes: readonly { id: string }[], id: string): boolean => panes.some((p) => p.id === id)
