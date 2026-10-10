import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildView, countItems, detailLine, isOpen, fmtCost, fmtTime, fmtTokens, glyphColor, groupLine, parseResult, reportedCost, rowLine, scriptArgs, sharesOf, startError, statusItems, dirsOf, toggle, visibleRows, moreLine, sessionsOf, sessionLabel, listArgs, pickerOptions, isGone, type ViewInput } from '../hooks/view.ts'
import type { AgentSummary, SessionInfo, Summary } from '../shared/summary.ts'

const MIN = 60_000

function agent(p: Partial<AgentSummary>): AgentSummary {
  return {
    id: 'a', sessionId: 's1', kind: 'agent', name: 'impl-T1', role: 'implementer-backend', task: 'impl T1', model: 'claude-sonnet-5-5', effort: 'medium',
    tokens: { input: 1000, output: 2000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    costUsd: 0.5, unpriced: false, firstAt: 0, lastAt: MIN, end: 'answered', errorText: '', ...p,
  }
}

const lead = (p: Partial<AgentSummary>) => agent({ id: 'lead:s1', kind: 'lead', name: 'Lead', role: 'lead', task: '', model: 'claude-opus-5-5', ...p })

function input(summary: Summary | null, p: Partial<ViewInput> = {}): ViewInput {
  return { summary, live: [], reportedCostUsd: null, costIncludesAgents: true, now: 10 * MIN, error: '', foreign: null, ...p }
}

const team = (agents: AgentSummary[], generations = ['s1']): Summary => ({ runId: 'r1', generations, agents, unreadableLines: 0, problems: [] })
const plain = (agents: AgentSummary[]): Summary => ({ runId: null, generations: ['s1'], agents, unreadableLines: 0, problems: [] })

test('formats cost, tokens and time', () => {
  assert.equal(fmtCost(0.4), '$0.40')
  assert.equal(fmtCost(12.34), '$12.3')
  assert.equal(fmtTokens(999), '999')
  assert.equal(fmtTokens(140_000), '140k')
  assert.equal(fmtTokens(1_800_000), '1.8M')
  assert.equal(fmtTime(190_000), '3:10')
  assert.equal(fmtTime(3_725_000), '1:02:05')
  assert.equal(fmtTime(-5), '0:00')
})

test('just under a million tokens rounds up to 1.0M, not to 1000k', () => {
  assert.equal(fmtTokens(999_499), '999k')
  assert.equal(fmtTokens(999_500), '1.0M')
  assert.equal(fmtTokens(999_999), '1.0M')
})

test('groups a team run by role, running groups first, then by cost', () => {
  const v = buildView(input(team([
    lead({ firstAt: 0, lastAt: MIN, costUsd: 0.9 }),
    agent({ id: 'v1', role: 'verifier', task: 'verify T1 #1', costUsd: 2 }),
    agent({ id: 'i1', costUsd: 0.5 }),
    agent({ id: 'i2', task: 'impl T2', costUsd: 0.3 }),
  ]), { live: [{ id: 'i2', status: 'running' }] }))
  assert.deepEqual(v.groups.map((g) => g.title), ['Lead (Orchestrator)', 'implementer-backend', 'verifier'])
  assert.deepEqual(v.groups[1]?.rows.map((r) => [r.glyph, r.label]), [['●', 'impl T2'], ['✓', 'impl T1']])
  assert.equal(v.groups[1]?.cost, '$0.80')
  assert.equal(v.title, 'Lauf r1')
  assert.equal(v.gens, '')
})

test('lists a plain session flat, under Lead and Agents, by start time', () => {
  const v = buildView(input(plain([lead({}), agent({ id: 'b', name: 'second', firstAt: 5 }), agent({ id: 'a', name: 'first', firstAt: 1 })])))
  assert.equal(v.title, 'Diese Sitzung')
  assert.deepEqual(v.groups.map((g) => g.title), ['Lead', 'Agents'])
  assert.deepEqual(v.groups[1]?.rows.map((r) => r.label), ['first', 'second'])
})

test('takes live status first, then the transcript', () => {
  const v = buildView(input(plain([lead({}),
    agent({ id: 'p', name: 'p' }), agent({ id: 'w', name: 'w' }), agent({ id: 'c', name: 'c', end: 'open' }),
    agent({ id: 'f', name: 'f' }), agent({ id: 'k', name: 'k' }), agent({ id: 'u', name: 'u' }),
    agent({ id: 'e', name: 'e', end: 'error', errorText: 'rate_limit' }), agent({ id: 'o', name: 'o', end: 'open' }),
  ]), { live: [
    { id: 'p', status: 'pending' }, { id: 'w', status: 'idle' }, { id: 'c', status: 'completed' },
    { id: 'f', status: 'failed' }, { id: 'k', status: 'killed' }, { id: 'u', status: 'something-new' },
  ] }))
  const rows = Object.fromEntries((v.groups.find((g) => g.key === 'agents')?.rows ?? []).map((r) => [r.label, [r.glyph, r.note]]))
  assert.deepEqual(rows, {
    p: ['●', ''], w: ['●', ''], c: ['✓', ''], f: ['✗', 'gescheitert'], k: ['✗', 'gescheitert'], u: ['●', ''],
    e: ['✗', 'rate_limit'], o: ['⊘', 'abgebrochen'],
  })
  assert.equal(v.counts, '● 3  ✓ 1  ✗ 3  ⊘ 1')
})

test('shows the current lead as running and earlier leads by their transcript', () => {
  const v = buildView(input(team([
    lead({ id: 'lead:s1', sessionId: 's1', end: 'answered' }),
    lead({ id: 'lead:s2', sessionId: 's2', end: 'error', errorText: 'boom' }),
    lead({ id: 'lead:s3', sessionId: 's3', end: 'open' }),
    lead({ id: 'lead:s4', sessionId: 's4', end: 'answered' }),
  ], ['s1', 's2', 's3', 's4'])))
  assert.deepEqual(v.groups[0]?.rows.map((r) => [r.label, r.glyph]), [['Gen 1', '✓'], ['Gen 2', '✗'], ['Gen 3', '⊘'], ['Gen 4', '●']])
  assert.equal(v.title, 'Lauf r1')
  assert.equal(v.gens, 'Gen 1–4')
})

test('sums wall-clock time per generation, without the pause between them and without double-counting parallel agents', () => {
  const v = buildView(input(team([
    lead({ id: 'lead:s1', sessionId: 's1', firstAt: 0, lastAt: 10 * MIN }),
    agent({ id: 'x', sessionId: 's1', firstAt: 2 * MIN, lastAt: 9 * MIN }),
    agent({ id: 'y', sessionId: 's1', firstAt: 3 * MIN, lastAt: 12 * MIN }),
    lead({ id: 'lead:s2', sessionId: 's2', firstAt: 600 * MIN, lastAt: 601 * MIN }),
    agent({ id: 'z', sessionId: 's2', firstAt: null, lastAt: null }),
  ], ['s1', 's2']), { now: 605 * MIN }))
  // Generation 1: 0..12 min; generation 2: 600 min .. now (its lead runs) = 5 min.
  assert.match(v.totals, / 17:00/)
})

test('counts a running agent up to now', () => {
  const v = buildView(input(plain([lead({ firstAt: 0, lastAt: MIN }), agent({ id: 'r', firstAt: 0, lastAt: MIN })]), { live: [{ id: 'r', status: 'running' }], now: 3 * MIN }))
  assert.equal(v.groups[1]?.rows[0]?.time, '3:00')
})

test('marks unpriced agents with ? and names how many the total leaves out', () => {
  const v = buildView(input(plain([lead({ costUsd: 1 }), agent({ id: 'q', unpriced: true, costUsd: 0.2 })])))
  assert.equal(v.groups[1]?.rows[0]?.cost, '?')
  assert.match(v.totals, /^≈ \$1\.20 .* ohne 1 Agents$/)
  assert.equal(v.overview.unpriced, 'ohne 1 Agents')
  assert.equal(v.overview.line, '≈ $1.20 · 6k · 10:00 · ohne 1 Agents')
  assert.equal(buildView(input(plain([lead({ costUsd: 1 })]))).overview.unpriced, '')
})

test('reconciles the reported cost with the right sum, and warns above 10 %', () => {
  const agents = [lead({ id: 'lead:s1', sessionId: 's1', costUsd: 1 }), agent({ id: 'x', sessionId: 's1', costUsd: 1 })]
  assert.deepEqual(buildView(input(plain(agents), { reportedCostUsd: 2.1 })).notices, [])
  assert.deepEqual(buildView(input(plain(agents), { reportedCostUsd: 3 })).notices, ['⚠ Preistabelle prüfen: gemeldet $3.00, errechnet $2.00'])
  assert.deepEqual(buildView(input(plain(agents), { reportedCostUsd: 1.05, costIncludesAgents: false })).notices, [])
  assert.equal(buildView(input(plain(agents), { reportedCostUsd: 1.05 })).groups[0]?.rows[0]?.note, 'gemeldet $1.05')
  assert.deepEqual(buildView(input(plain(agents), { reportedCostUsd: 0 })).notices, [])
})

test('lists script errors, unreadable lines and problems as notices', () => {
  const s = { ...plain([lead({})]), unreadableLines: 3, problems: ['kein Transkript für Sitzung x'] }
  assert.deepEqual(buildView(input(s, { error: 'summarize exit 1: boom' })).notices, [
    '⚠ summarize exit 1: boom', '⚠ 3 Zeilen unlesbar', '⚠ kein Transkript für Sitzung x',
  ])
})

test('says it is loading before the first summary, and shows only the error if that failed', () => {
  assert.deepEqual(buildView(input(null)), {
    title: 'Agents', gens: '', subtitle: '', totals: 'lade …', counts: '', notices: [], groups: [], status: { running: 0, done: 0, failed: 0, aborted: 0 },
    overview: { cost: '≈ $0.00', tokens: '0', time: '0:00', shares: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, amounts: { input: '0', output: '0', cacheRead: '0', cacheWrite: '0' }, line: '', unpriced: '' },
  })
  assert.deepEqual(buildView(input(null, { error: 'node nicht gefunden: x' })).notices, ['⚠ node nicht gefunden: x'])
})

test('renders group and row lines', () => {
  const v = buildView(input(plain([lead({}), agent({ id: 'e', name: 'e', end: 'error', errorText: 'boom' })])))
  const g = v.groups[1]
  assert.ok(g)
  assert.equal(groupLine(g, false), `▾ Agents  $0.50  3k  1:00`)
  assert.equal(groupLine(g, true), `▸ Agents  $0.50  3k  1:00`)
  const row = g.rows[0] ?? assert.fail()
  assert.equal(rowLine(row), 'e  Sonnet 5.5  $0.50  3k  1:00  boom')
  assert.equal(rowLine({ ...row, note: '' }), 'e  Sonnet 5.5  $0.50  3k  1:00')
  assert.equal(detailLine(row), '      in 1k · out 2k · read 0 · write 0/0')
  assert.deepEqual(['●', '✓', '✗', '⊘'].map((x) => glyphColor(x as '●')), ['cyan', 'green', 'red', 'yellow'])
})

test('names models short', () => {
  const v = buildView(input(plain([lead({ model: 'claude-opus-5[1m]' }), agent({ id: 'h', model: 'claude-haiku-4-5-20251001' }), agent({ id: 'n', model: '' })])))
  assert.deepEqual([v.groups[0]?.rows[0]?.model, ...(v.groups[1]?.rows.map((r) => r.model) ?? [])], ['Opus 5', 'Haiku 4.5', '—'])
})

test('parses the script result', () => {
  const s = plain([])
  assert.deepEqual(parseResult({ exitCode: 0, stdout: JSON.stringify(s), stderr: '' }), { summary: s, error: '' })
  assert.deepEqual(parseResult({ exitCode: 2, stdout: '', stderr: ' usage \n' }), { summary: null, error: 'summarize exit 2: usage' })
  assert.deepEqual(parseResult({ exitCode: 0, stdout: 'nope', stderr: '' }), { summary: null, error: 'summarize: Ausgabe ist kein JSON' })
  assert.deepEqual(parseResult({ exitCode: 0, stdout: '{}', stderr: '' }), { summary: null, error: 'summarize: unerwartete Ausgabe' })
})

test('leaves cutting a long script error to the one cap of the view', () => {
  const stderr = 'E'.repeat(300)
  assert.equal(parseResult({ exitCode: 1, stdout: '', stderr }).error, `summarize exit 1: ${stderr}`)
})

// summarize writes its result with JSON.stringify, which turns a non-finite number into null.
const run = (v: unknown) => parseResult({ exitCode: 0, stdout: JSON.stringify(v), stderr: '' })
const shown = (r: ReturnType<typeof parseResult>) => buildView(input(r.summary, { error: r.error }))

test('an unpriced cost from the script stays unpriced instead of becoming a price', () => {
  for (const costUsd of [null, 'many', undefined]) {
    const r = run(plain([agent({ costUsd: costUsd as unknown as number })]))
    assert.equal(r.error, '')
    assert.equal(r.summary?.agents[0]?.costUsd, 0)
    assert.equal(r.summary?.agents[0]?.unpriced, true)
    assert.equal(shown(r).overview.unpriced, 'ohne 1 Agents')
    assert.equal(shown(r).groups[0]?.rows[0]?.cost, '?')
  }
})

test('a token count that is not a finite number counts as zero', () => {
  const tokens = { input: null, output: 'x', cacheRead: 3, cacheWrite5m: undefined, cacheWrite1h: 1 } as unknown as AgentSummary['tokens']
  const r = run(plain([agent({ tokens })]))
  assert.deepEqual(r.summary?.agents[0]?.tokens, { input: 0, output: 0, cacheRead: 3, cacheWrite5m: 0, cacheWrite1h: 1 })
  assert.equal(shown(r).overview.tokens, '4')
  const none = run(plain([agent({ tokens: undefined as unknown as AgentSummary['tokens'] })]))
  assert.deepEqual(none.summary?.agents[0]?.tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })
})

test('missing texts, times and end state fall back to empty ones', () => {
  const bare = { id: 'a', sessionId: 's1', kind: 'agent', tokens: {}, costUsd: 0.5 }
  const r = run({
    runId: null,
    generations: ['s1'],
    agents: [bare, { ...bare, id: 'b', end: 'error', errorText: 'boom', unpriced: 'yes', firstAt: 5, lastAt: 9 }, { ...bare, id: 'c', end: 'answered', firstAt: 5 }],
    unreadableLines: 'x',
    problems: [],
  })
  assert.deepEqual(r.summary?.agents[0], {
    id: 'a', sessionId: 's1', kind: 'agent', name: '', role: '', task: '', model: '', effort: '',
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    costUsd: 0.5, unpriced: false, firstAt: null, lastAt: null, end: 'open', errorText: '',
  })
  assert.deepEqual(r.summary?.agents.slice(1).map((a) => [a.end, a.errorText, a.unpriced, a.firstAt, a.lastAt]), [['error', 'boom', false, 5, 9], ['answered', '', false, null, null]])
  assert.equal(r.summary?.unreadableLines, 0)
  assert.equal(shown(r).groups[0]?.rows.length, 3)
})

test('a summary of the wrong shape is rejected instead of reaching the view', () => {
  const ok = plain([agent({})])
  const bad: unknown[] = [
    { agents: [] },
    { ...ok, generations: undefined },
    { ...ok, generations: [1] },
    { ...ok, problems: undefined },
    { ...ok, problems: [null] },
    { ...ok, runId: 5 },
    { ...ok, agents: [null] },
    { ...ok, agents: [[]] },
    { ...ok, agents: [{ ...agent({}), id: 7 }] },
    { ...ok, agents: [{ ...agent({}), sessionId: undefined }] },
    { ...ok, agents: [{ ...agent({}), kind: 'other' }] },
  ]
  for (const v of bad) assert.deepEqual(run(v), { summary: null, error: 'summarize: unerwartete Ausgabe' })
  assert.deepEqual(shown(run(bad[0])).notices, ['⚠ summarize: unerwartete Ausgabe'])
})

test('words a failed start', () => {
  assert.equal(startError(new Error('spawn node ENOENT')), 'node nicht gefunden: spawn node ENOENT')
  assert.equal(startError('timed out'), 'summarize gescheitert: timed out')
})

test('reads the reported cost', () => {
  assert.equal(reportedCost(1.5), 1.5)
  assert.equal(reportedCost({ totalUsd: 2 }), 2)
  assert.equal(reportedCost({ usd: 3 }), 3)
  assert.equal(reportedCost({ total_cost_usd: 4 }), 4)
  assert.equal(reportedCost({ other: 1 }), null)
  assert.equal(reportedCost(undefined), null)
  assert.equal(reportedCost(Number.NaN), null)
  assert.equal(reportedCost({ usd: Number.NaN }), null)
})

test('builds the script call', () => {
  assert.deepEqual(scriptArgs('P/cli/summarize.ts', 's1', 'C:/repo', 'C:/Users/u/.claude', 'C:/tmp'), [
    'node', 'P/cli/summarize.ts', '--session', 's1', '--cwd', 'C:/repo', '--config', 'C:/Users/u/.claude', '--cache', 'C:/tmp/agent-panel/s1.json',
  ])
})

test('sorts an agent without a first time as if it started at zero', () => {
  const v = buildView(input(plain([lead({}), agent({ id: 'b', name: 'late', firstAt: 5 }), agent({ id: 'a', name: 'none', firstAt: null, lastAt: null }), agent({ id: 'c', name: 'late2', firstAt: 9 })])))
  assert.deepEqual(v.groups.find((g) => g.key === 'agents')?.rows.map((r) => [r.label, r.time]), [['none', '0:00'], ['late', '1:00'], ['late2', '1:00']])
})

test('dirsOf prefers the Windows variables, falls back to POSIX, then to defaults', () => {
  assert.deepEqual(dirsOf({ USERPROFILE: 'U', HOME: 'H', TEMP: 'T', TMPDIR: 'D' }), { home: 'U', config: 'U/.claude', tmp: 'T' })
  assert.deepEqual(dirsOf({ HOME: 'H', TMPDIR: 'D' }), { home: 'H', config: 'H/.claude', tmp: 'D' })
  assert.deepEqual(dirsOf({}), { home: '', config: '/.claude', tmp: '/tmp' })
})

test('dirsOf takes the config folder Claude Code was started with', () => {
  assert.deepEqual(dirsOf({ USERPROFILE: 'U', CLAUDE_CONFIG_DIR: 'C:/Users/u/.claude-b', TEMP: 'T' }), { home: 'U', config: 'C:/Users/u/.claude-b', tmp: 'T' })
  assert.deepEqual(dirsOf({ USERPROFILE: 'U', CLAUDE_CONFIG_DIR: '', TEMP: 'T' }), { home: 'U', config: 'U/.claude', tmp: 'T' })
})

test('toggle adds a missing key and removes a present one', () => {
  const s = new Set<string>()
  toggle(s, 'a')
  assert.deepEqual([...s], ['a'])
  toggle(s, 'a')
  assert.deepEqual([...s], [])
})

test('tells whether a pane is open', () => {
  assert.equal(isOpen([{ id: 'x' }, { id: 'agent-panel' }], 'agent-panel'), true)
  assert.equal(isOpen([{ id: 'x' }], 'agent-panel'), false)
  // A pane that waits undrawn is listed, but the person does not see it.
  assert.equal(isOpen([{ id: 'agent-panel', isPlaced: false }], 'agent-panel'), false)
  assert.equal(isOpen([{ id: 'agent-panel', isPlaced: true }], 'agent-panel'), true)
})

test('draws the first rows of a big card and names how many it leaves out', () => {
  const many = Array.from({ length: 160 }, (_, i) => agent({ id: `a${i}`, name: `a${i}`, firstAt: i }))
  const g = buildView(input(plain([lead({}), ...many]), { live: [{ id: 'a159', status: 'running' }] })).groups.find((x) => x.key === 'agents') ?? assert.fail()
  assert.equal(visibleRows(g, false).length, 150)
  assert.equal(moreLine(g, false), '… 10 weitere Agents')
  assert.equal(visibleRows(g, true).length, 1)
  assert.equal(moreLine(g, true), '')
})

test('splits tokens into shares, and gives all zeros for no tokens', () => {
  assert.deepEqual(sharesOf({ input: 10, output: 30, cacheRead: 50, cacheWrite5m: 5, cacheWrite1h: 5 }), { input: 0.1, output: 0.3, cacheRead: 0.5, cacheWrite: 0.1 })
  assert.deepEqual(sharesOf({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
})

test('puts model, effort, cost and time into a row, and the note instead of cost for failures', () => {
  const v = buildView(input(plain([lead({}), agent({ id: 'a', name: 'a' }), agent({ id: 'b', name: 'b', effort: '' }), agent({ id: 'e', name: 'e', end: 'error', errorText: 'boom' })])))
  const rows = Object.fromEntries((v.groups.find((g) => g.key === 'agents')?.rows ?? []).map((r) => [r.label, r]))
  assert.equal(rows.a?.meta, 'Sonnet 5.5 · medium · $0.50 · ⏱ 1:00')
  assert.equal(rows.b?.meta, 'Sonnet 5.5 · $0.50 · ⏱ 1:00')
  assert.equal(rows.e?.meta, 'Sonnet 5.5 · medium · boom')
  assert.equal(rows.a?.status, 'done')
  assert.equal(rows.e?.status, 'failed')
})

test('adds the reported cost to the current lead row', () => {
  const v = buildView(input(plain([lead({ effort: 'xhigh' })]), { reportedCostUsd: 0.5 }))
  assert.equal(v.groups[0]?.rows[0]?.meta, 'Opus 5.5 · xhigh · $0.50 · ⏱ 10:00 · gemeldet $0.50')
})

test('counts statuses overall and per role, and gives each role its cost share', () => {
  const v = buildView(input(team([
    lead({ costUsd: 1 }),
    agent({ id: 'r', costUsd: 1 }), agent({ id: 'd', costUsd: 1 }), agent({ id: 'f', costUsd: 1, end: 'error' }), agent({ id: 'x', costUsd: 0, end: 'open' }),
  ]), { live: [{ id: 'r', status: 'running' }] }))
  assert.deepEqual(v.status, { running: 1, done: 1, failed: 1, aborted: 1 })
  const g = v.groups.find((x) => x.key === 'implementer-backend')
  assert.deepEqual(g?.counts, { running: 1, done: 1, failed: 1, aborted: 1 })
  assert.equal(g?.costShare, 0.75)
  assert.equal(g?.role, 'implementer-backend')
  assert.equal(v.groups.find((x) => x.key === 'lead')?.role, 'lead')
})

test('gives a zero cost share when nothing cost anything', () => {
  const v = buildView(input(plain([lead({ costUsd: 0 }), agent({ id: 'a', costUsd: 0 })])))
  assert.deepEqual(v.groups.map((g) => g.costShare), [0, 0])
})

test('builds the overview with amounts per token kind and a one-line summary', () => {
  const v = buildView(input(plain([lead({ tokens: { input: 110_000, output: 160_000, cacheRead: 1_260_000, cacheWrite5m: 200_000, cacheWrite1h: 70_000 }, costUsd: 4.12, firstAt: 0, lastAt: 10 * MIN })])))
  assert.deepEqual(v.overview.amounts, { input: '110k', output: '160k', cacheRead: '1.3M', cacheWrite: '270k' })
  assert.equal(v.overview.cost, '≈ $4.12')
  assert.equal(v.overview.line, '≈ $4.12 · 1.8M · 10:00')
  assert.ok(Math.abs(v.overview.shares.cacheRead - 1_260_000 / 1_800_000) < 1e-9)
})

test('words the status counts in full and short, each part with its status', () => {
  const c = { running: 2, done: 9, failed: 1, aborted: 0 }
  assert.deepEqual(statusItems(c), [
    { status: 'running', text: '● läuft 2' }, { status: 'done', text: '✓ fertig 9' },
    { status: 'failed', text: '✗ gescheitert 1' }, { status: 'aborted', text: '⊘ abgebrochen 0' },
  ])
  assert.deepEqual(countItems(c), [{ status: 'running', text: '● 2' }, { status: 'done', text: '✓ 9' }, { status: 'failed', text: '✗ 1' }])
  assert.deepEqual(countItems({ running: 0, done: 3, failed: 0, aborted: 2 }).map((i) => i.text), ['● 0', '✓ 3', '⊘ 2'])
})

test('hides finished rows on request', () => {
  const v = buildView(input(plain([lead({}), agent({ id: 'a', name: 'a' }), agent({ id: 'r', name: 'r' })]), { live: [{ id: 'r', status: 'running' }] }))
  const g = v.groups.find((x) => x.key === 'agents')
  assert.ok(g)
  assert.deepEqual(visibleRows(g, false).map((r) => r.label), ['r', 'a'])
  assert.deepEqual(visibleRows(g, true).map((r) => r.label), ['r'])
})

// What the host refuses in a text, and what splits a row into two lines.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/u
const DIRTY = 'a\u001b[2J\r\n\tb\u0007\u0085c\u{2028}d'
const CLEAN = 'a [2J b c d'

test('cleans control characters and line breaks out of the label of a team row and a plain row', () => {
  const t = buildView(input(team([lead({}), agent({ task: 'impl \u001b[2J\nT1' })])))
  assert.equal(t.groups[1]?.rows[0]?.label, 'impl [2J T1')
  const p = buildView(input(plain([lead({}), agent({ name: DIRTY })])))
  assert.equal(p.groups[1]?.rows[0]?.label, CLEAN)
})

test('cleans a model id that names no known family, and the effort', () => {
  const v = buildView(input(plain([lead({}), agent({ model: 'x\u001b]0;title\u0007', effort: '\u001b[31mhigh\r\nX' })])))
  const row = v.groups[1]?.rows[0] ?? assert.fail()
  assert.equal(row.model, 'x ]0;title')
  assert.equal(row.effort, '[31mhigh X')
  assert.equal(row.meta, 'x ]0;title · [31mhigh X · $0.50 · ⏱ 1:00')
})

test('cleans the error text that becomes the note', () => {
  const v = buildView(input(plain([lead({}), agent({ end: 'error', errorText: 'boom\u001b[2J\r\nY' })])))
  const row = v.groups[1]?.rows[0] ?? assert.fail()
  assert.equal(row.note, 'boom [2J Y')
  assert.equal(row.meta, 'Sonnet 5.5 · medium · boom [2J Y')
  assert.equal(rowLine(row), 'impl-T1  Sonnet 5.5  $0.50  3k  1:00  boom [2J Y')
})

test('cleans a role into its group title, key and role', () => {
  const v = buildView(input(team([lead({}), agent({ role: 'rev\u001b[31m\nx' })])))
  const g = v.groups.find((x) => x.key !== 'lead') ?? assert.fail()
  assert.equal(g.title, 'rev [31m x')
  assert.equal(g.key, 'rev [31m x')
  assert.equal(g.role, 'rev [31m x')
})

test('cleans the run id, the script error and the problems', () => {
  const s = { ...team([lead({})]), runId: 'r\n1', problems: ['kann x\u001b nicht lesen:\r\ny'] }
  const v = buildView(input(s, { error: 'summarize exit 1:\nboom\u0007' }))
  assert.equal(v.title, 'Lauf r 1')
  assert.deepEqual(v.notices, ['⚠ summarize exit 1: boom', '⚠ kann x nicht lesen: y'])
  assert.equal(buildView(input(null, { error: 'a\nb' })).notices[0], '⚠ a b')
})

test('shows no error line when the error holds nothing but control characters', () => {
  const v = buildView(input(null, { error: '\u001b\n' }))
  assert.deepEqual(v.notices, [])
  assert.equal(v.totals, 'lade …')
})

test('leaves no control character in any text of the view', () => {
  const v = buildView(input(team([
    lead({}),
    agent({ id: 'f', task: DIRTY, model: DIRTY, effort: DIRTY, end: 'error', errorText: DIRTY }),
    agent({ id: 'd', role: DIRTY, task: DIRTY, model: DIRTY, effort: DIRTY }),
  ]), { error: DIRTY }))
  const texts = [v.title, v.gens, v.subtitle, v.totals, v.counts, ...v.notices]
  for (const g of v.groups) {
    texts.push(g.title, g.key, g.role, groupLine(g, false))
    for (const r of g.rows) texts.push(r.label, r.model, r.effort, r.note, r.meta, rowLine(r), detailLine(r))
  }
  for (const text of texts) assert.doesNotMatch(text, CONTROL, JSON.stringify(text))
})

test('caps a long text by code points, so a pair of surrogates is never cut in two', () => {
  const v = buildView(input(plain([lead({}), agent({ name: '😀'.repeat(300) }), agent({ id: 'b', name: 'x'.repeat(100) })])))
  const [long, exact] = (v.groups[1]?.rows ?? []).map((r) => r.label)
  assert.equal(long, `${'😀'.repeat(99)}…`)
  assert.equal(exact, 'x'.repeat(100))
})

test('reads only a bounded prefix of a text, so a huge one costs no more than a long one', () => {
  const v = buildView(input(plain([lead({}), agent({ name: `${' '.repeat(400)}tail` }), agent({ id: 'b', name: 'x'.repeat(2_000_000) })])))
  const [padded, huge] = (v.groups[1]?.rows ?? []).map((r) => r.label)
  // Four hundred blanks fill the prefix, so what follows is never read.
  assert.equal(padded, '')
  assert.equal(huge, `${'x'.repeat(99)}…`)
})

test('drops half a surrogate pair that the prefix cut leaves at its end', () => {
  const v = buildView(input(plain([lead({}), agent({ name: `${' '.repeat(399)}😀tail` }), agent({ id: 'b', name: `a${' '.repeat(398)}😀tail` })]), { error: `${' '.repeat(399)}😀tail` }))
  assert.deepEqual((v.groups[1]?.rows ?? []).map((r) => r.label), ['', 'a'])
  assert.deepEqual(v.notices, [])
})

test('takes a text of any type: a number shows as its digits, anything else as blank', () => {
  // A meta.json or a transcript line from other tooling can hold any JSON value where a string belongs.
  const odd = (id: string, value: unknown) => agent({ id, name: value as string })
  const v = buildView(input(plain([lead({}), odd('a', 42), odd('b', null), odd('c', undefined), odd('d', { x: 1 }), odd('e', ['x']), odd('f', true)])))
  assert.deepEqual((v.groups[1]?.rows ?? []).map((r) => r.label), ['42', '', '', '', '', ''])
})

test('caps the script error notice at the same length as every other text', () => {
  const v = buildView(input(null, { error: `summarize exit 1: ${'E'.repeat(300)}` }))
  assert.equal(v.notices[0], `⚠ summarize exit 1: ${'E'.repeat(81)}…`)
})

test('a script failure with a multi-line stderr becomes a one-line notice', () => {
  const stderr = 'node:internal/modules/run_main:123\n    triggerUncaughtException(\n    ^\n\nError: boom\n'
  const v = buildView(input(null, { error: parseResult({ exitCode: 1, stdout: '', stderr }).error }))
  assert.equal(v.notices.length, 1)
  assert.doesNotMatch(v.notices[0] ?? '', /[\r\n]/)
})

test('a plain session lists the lead first even when a running agent cost more', () => {
  const v = buildView(input(plain([lead({ costUsd: 0.1 }), agent({ id: 'b', name: 'busy', costUsd: 2 })]), { live: [{ id: 'b', status: 'running' }] }))
  assert.deepEqual(v.groups.map((g) => g.title), ['Lead', 'Agents'])
})

test('an agent whose role is named lead or agents gets its own card', () => {
  const v = buildView(input(team([lead({}), agent({ id: 'x', role: 'lead', task: 'impl T9' }), agent({ id: 'y', role: 'agents', task: 'impl T8' })])))
  assert.deepEqual(v.groups.find((g) => g.title === 'Lead (Orchestrator)')?.rows.map((r) => r.key), ['lead:s1'])
  assert.deepEqual(v.groups.map((g) => [g.title, g.role]).sort(), [['Lead (Orchestrator)', 'lead'], ['agents', 'agents'], ['lead', 'lead']])
  assert.equal(new Set(v.groups.map((g) => g.key)).size, 3)
})

test('names Claude 3.x models by family and version, not by their date', () => {
  const v = buildView(input(plain([lead({}), agent({ id: 'h', model: 'claude-3-5-haiku-20241022' }), agent({ id: 's', model: 'claude-3-7-sonnet-20250219', firstAt: 1 }), agent({ id: 'o', model: 'claude-3-opus-20240229', firstAt: 2 })])))
  assert.deepEqual(v.groups.find((g) => g.key === 'agents')?.rows.map((r) => r.model), ['Haiku 3.5', 'Sonnet 3.7', 'Opus 3'])
})

const info = (p: Partial<SessionInfo>): SessionInfo => ({ id: 's2', config: 'C:/Users/u/.claude', project: 'repo', title: 'Agent-team fortsetzen', cwd: 'C:/repo', lastAt: 10 * MIN - 3 * MIN, isLive: false, ...p })

test('labels a session with its state, title, project, age and account', () => {
  const now = 10 * MIN
  assert.equal(sessionLabel(info({ isLive: true, lastAt: now - 5000 }), now), '● Agent-team fortsetzen · repo · gerade eben')
  assert.equal(sessionLabel(info({}), now), '○ Agent-team fortsetzen · repo · vor 3 min')
  assert.equal(sessionLabel(info({ lastAt: now - 150 * MIN }), now), '○ Agent-team fortsetzen · repo · vor 2 h')
  assert.equal(sessionLabel(info({ lastAt: now - 50 * 60 * MIN }), now), '○ Agent-team fortsetzen · repo · vor 2 d')
  assert.equal(sessionLabel(info({ config: 'C:/Users/u/.claude-b' }), now), '○ Agent-team fortsetzen · repo · vor 3 min · b')
  // A clock set back shows no negative age.
  assert.equal(sessionLabel(info({ lastAt: now + 60_000 }), now), '○ Agent-team fortsetzen · repo · gerade eben')
  const long = sessionLabel(info({ title: `a${String.fromCharCode(27)}[31m${'x'.repeat(10_000)}` }), now)
  assert.ok(!long.includes(String.fromCharCode(27)))
  assert.ok(long.length < 120, String(long.length))
})

test('cuts a label text on whole characters, never through an emoji', () => {
  const label = sessionLabel(info({ title: `${'t'.repeat(59)}😀😀` }), 10 * MIN)
  const title = label.slice(2, label.indexOf(' · '))
  assert.equal([...title].length, 60)
  assert.ok(title.endsWith('😀'))
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(label))
})

test('offers this session first, then the listed ones, and keeps a picked one that left the list', () => {
  const now = 10 * MIN
  const a = info({ id: 'a' })
  const b = info({ id: 'b' })
  assert.deepEqual(pickerOptions([a, b], null, now).map((o) => o.value), ['', 'a', 'b'])
  assert.equal(pickerOptions([], null, now)[0]?.label, 'Diese Sitzung')
  assert.deepEqual(pickerOptions([a], b, now).map((o) => o.value), ['', 'b', 'a'])
  assert.deepEqual(pickerOptions([a, b], b, now).map((o) => o.value), ['', 'a', 'b'])
})

test('tells when the picked session has no transcript any more', () => {
  const gone = { ...plain([]), problems: ['kein Transkript für Sitzung s2'] }
  assert.equal(isGone(gone, 's2'), true)
  assert.equal(isGone(gone, 's3'), false)
  assert.equal(isGone(null, 's2'), false)
})

test('accepts the --list output only in the shape the picker reads', () => {
  const good = [info({})]
  assert.deepEqual(sessionsOf({ exitCode: 0, stdout: JSON.stringify(good) }), good)
  assert.equal(sessionsOf({ exitCode: 1, stdout: '[]' }), null)
  assert.equal(sessionsOf({ exitCode: 0, stdout: 'nope' }), null)
  assert.equal(sessionsOf({ exitCode: 0, stdout: '{}' }), null)
  for (const bad of [null, { ...good[0], id: 5 }, { ...good[0], lastAt: 'x' }, { ...good[0], isLive: 'yes' }, { ...good[0], cwd: null }]) {
    assert.equal(sessionsOf({ exitCode: 0, stdout: JSON.stringify([bad]) }), null)
  }
})

test('builds the list call', () => {
  assert.deepEqual(listArgs('P/cli/summarize.ts', 'C:/Users/u', 'C:/Users/u/.claude'), ['node', 'P/cli/summarize.ts', '--list', '--home', 'C:/Users/u', '--config', 'C:/Users/u/.claude'])
})

test('shows another session from its transcript only', () => {
  const s = plain([lead({}), agent({ id: 'b', name: 'busy', end: 'open' })])
  const idle = buildView(input(s, { foreign: { title: 'Agent-team fortsetzen', isLive: false }, reportedCostUsd: 99 }))
  assert.equal(idle.title, 'Sitzung: Agent-team fortsetzen')
  assert.equal(buildView(input(s, { foreign: { title: 'x'.repeat(500), isLive: false } })).title, `Sitzung: ${'x'.repeat(60)}`)
  assert.equal(idle.subtitle, 'nur aus dem Transkript')
  assert.equal(idle.groups.find((g) => g.key === 'lead')?.rows[0]?.glyph, '✓')
  // The hook passes no reported cost for another session; even if one came, it would not be shown.
  assert.ok(idle.notices.every((n) => !n.includes('Preistabelle')))
  const busy = buildView(input(s, { foreign: { title: 'x', isLive: true } }))
  assert.equal(busy.groups.find((g) => g.key === 'lead')?.rows[0]?.glyph, '●')
  assert.equal(buildView(input(s)).subtitle, '')
  assert.equal(buildView(input(null, { foreign: { title: 'y', isLive: false } })).subtitle, 'nur aus dem Transkript')
})
