# Agent-Panel Optik Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Agent-Panel bekommt in Desktop-App und Terminal den grafischen Aufbau (Kacheln, Token-Streifen, Status-Balken, Rollen-Karten mit Krabben, Einklappen, hell/dunkel) und öffnet sich bei Team-Start und Agent-Schwarm von selbst.

**Architecture:** Neue reine Module erzeugen die Grafik (`hooks/sprites.ts` Pixel-Daten, `hooks/art.ts` SVG-Texte und Raster-Zellen, `hooks/open.ts` Öffnungsregeln); `hooks/view.ts` liefert die zusätzlichen Anzeige-Daten; `hooks/register.ts` verdrahtet je nach `e.surface` Desktop-SVG oder Terminal-Blockzeichen/Raster. Der Effort fließt aus dem Transkript über `cli/` in die Zusammenfassung.

**Tech Stack:** TypeScript ohne Build (Node ≥ 22.18), Claude-Code-Mods-API (`Svg`, `Raster`, `Box`, `Text`, `Button`), `node --test` mit Coverage, `claude plugin test`.

**Spec:** `docs/.superpowers/specs/2026-10-09-agent-panel-optik-design.md` (baut auf `docs/.superpowers/specs/2026-10-09-agent-panel-design.md` auf)

## Global Constraints

- Alle Pfade relativ zu `plugins-src/agent-panel/`, außer sie beginnen mit `docs/`.
- `hooks/` spricht kein Node-API; Imports nur relativ mit `.ts`-Endung und `claude-code`; `$` nur an Funktionen auf oberster Ebene derselben Datei.
- Coverage 100 % (Zeilen, Zweige, Funktionen) für `cli/**` und `hooks/view.ts`, `hooks/art.ts`, `hooks/sprites.ts`, `hooks/open.ts`; `hooks/register.ts` bleibt ausgeschlossen und ohne eigene Logik.
- Node-Tests `spec/*.spec.ts`; Kit-Tests `hooks/*.test.ts`.
- Kein `any`, `erasableSyntaxOnly`, `noUncheckedIndexedAccess`.
- SVG je Stück < 131 072 Zeichen; `Svg` braucht `source` und `alt`.
- Raster: `cells` = base64 von `columns × rows` Tripeln u32 little-endian `[codePoint, fg, bg]`; Farbe `0x00RRGGBB` oder `0x01000000`; nur Zeichen der Breite 1. base64 über `btoa` (Node 24 hat kein `Uint8Array.prototype.toBase64`).
- Breit = `e.props.bodyColumns ≥ 70`: nur dann Krabben.
- Farben (Spec Abschnitt 5): läuft `#1d6fb8`, fertig `#2f8a52`, gescheitert `#c0392b`, abgebrochen `#b07a12`; Token in `#8f8cf4`, out `#5fbf8f`, cache read hell `#d8d5ce` / dunkel `#5a5853`, cache write `#f0b35b`; Kostenbalken `#8f8cf4`; Kachel hell `#f1efea` / dunkel `#2b2a28`; Spur hell `#efece6` / dunkel `#3a3936`.
- Öffnen: Team-Lücke 10 min, Schwarm 3 Spawns in 30 s.
- Krabbe nach savvy-progress (MIT, © 2026 johnnyvizz): Lizenzhinweis im Kopf von `hooks/sprites.ts`.
- Code und Kommentare englisch, Panel-Texte deutsch. Commits per Nachrichtendatei und `git commit -F`, kein `Co-Authored-By`.

## Review Focus

1. **Rolle mit vielen Agents (200):** jedes SVG-Stück bleibt unter der Grenze, die Karte bleibt bedienbar → Test in Task 4 („keeps every piece under the SVG limit with 200 agents“).
2. **Alle Kosten 0 / alle Tokens 0** (frischer Lauf): Streifen und Balken zeichnen leere Spur statt `NaN`-Breiten → Tests in Task 2 und Task 4.
3. **Theme-Wert kein String** (`$.config.list()` liefert `true` o. ä.): helle Palette → Test in Task 4 (`paletteOf`).
4. **Terminal-Krabbe mit nur oberem oder nur unterem Pixel** in einer Zelle: richtige Halbblöcke statt Textfarbe → Test in Task 3.
5. **Viele Spawns über Minuten verteilt:** öffnet nicht ständig neu → Test in Task 5 („three spawns over 31 s do not open“, „second teammate of a run does not open“).

---

### Task 1: Effort durch die Pipeline

**Files:**
- Modify: `shared/summary.ts`, `cli/transcript.ts`, `cli/cache.ts`, `cli/summarize.ts`
- Test: `spec/transcript.spec.ts`, `spec/cache.spec.ts`, `spec/summarize.spec.ts`

**Interfaces:**
- Produces: `AgentSummary.effort: string` ('' wenn unbekannt); `FileState.effort: string`; Cache-Version 2.

- [x] **Step 1: Tests**

In `spec/transcript.spec.ts` ergänzen:

```ts
test('remembers the last effort a line names', () => {
  const lines = [
    JSON.stringify({ type: 'user', effort: 'low', timestamp: '2026-10-09T10:00:00.000Z' }),
    JSON.stringify({ type: 'assistant', effort: 'medium', message: { id: 'a', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { output_tokens: 1 } } }),
    JSON.stringify({ type: 'system' }),
    JSON.stringify({ type: 'user', effort: '' }),
  ].join('\n') + '\n'
  assert.equal(applyLines(emptyState(), lines).effort, 'medium')
  assert.equal(emptyState().effort, '')
})
```

In `spec/cache.spec.ts` im Test „starts empty …“ ergänzen (die Prüfung auf `version: 1` ersetzt die alte Version):

```ts
  writeFileSync(join(dir, 'v1.json'), JSON.stringify({ version: 1, files: {}, metas: {}, leads: {} }))
  assert.deepEqual(loadCache(join(dir, 'v1.json')), emptyCache())
```

In `spec/summarize.spec.ts` im Test „summarizes a plain session …“ die Lead-Zeile mit Effort schreiben und prüfen:

```ts
  const l = lead(w, 'C--repo', 's1', JSON.stringify({ type: 'assistant', effort: 'xhigh', message: { id: 'm1', model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { output_tokens: 20 } } }) + '\n')
  // … bestehende Zeilen …
  assert.equal(s.agents[0]?.effort, 'xhigh')
  assert.equal(s.agents[1]?.effort, '')
```

(Die bisherige Zeile `const l = lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))` wird dadurch ersetzt.)

- [x] **Step 2: Rot** — Run (in `plugins-src/agent-panel`): `node --test spec/transcript.spec.ts spec/cache.spec.ts spec/summarize.spec.ts` → FAIL (`effort` undefined, v1-Cache gilt noch).

- [x] **Step 3: Implementieren**

`shared/summary.ts`, in `AgentSummary` nach `model: string`:

```ts
  /** The reasoning effort the transcript names last; '' when none. */
  effort: string
```

`cli/transcript.ts`:
- `Line` bekommt `effort?: unknown`.
- `FileState` bekommt nach `model: string` das Feld `effort: string`; `emptyState()` setzt `effort: ''`.
- In `applyLines` direkt nach dem Zeitstempel-Block:

```ts
    if (typeof line.effort === 'string' && line.effort !== '') s = { ...s, effort: line.effort }
```

`cli/cache.ts`: `version: 2` im Typ, in `emptyCache()` und in der Prüfung von `loadCache` (`data.version === 2`). Kommentar über `version`:

```ts
  /** Bumped when FileState changes shape, so an old cache is read from scratch. */
```

`cli/summarize.ts`, in `toSummary` nach `model: state.model,`: `effort: state.effort,`

Alle anderen Stellen, die `AgentSummary` bauen (Fixtures in `spec/view.spec.ts` `agent()`, `hooks/register.test.ts` `LEAD`), bekommen `effort: ''` bzw. einen Wert, damit `tsc` grün bleibt.

- [x] **Step 4: Grün** — Run: `npm test` → PASS, 100 %; `npm run typecheck` → exit 0; `npm run kit` → PASS.

- [x] **Step 5: Commit** — `Carry the reasoning effort from transcripts into the summary`

---

### Task 2: Anzeige-Daten für den neuen Aufbau

**Files:**
- Modify: `hooks/view.ts`
- Test: `spec/view.spec.ts`

**Interfaces:**
- Consumes: `AgentSummary.effort` (Task 1)
- Produces (zusätzlich zu den bestehenden Exporten, die bleiben):
  - `type Status = 'running' | 'done' | 'failed' | 'aborted'`
  - `type StatusCounts = Record<Status, number>`
  - `type Shares = { input: number; output: number; cacheRead: number; cacheWrite: number }` (Anteile 0–1, Summe 1 oder alle 0)
  - `sharesOf(t: TokenCounts): Shares`
  - `Row` zusätzlich: `status: Status; effort: string; shares: Shares; meta: string`
  - `Group` zusätzlich: `role: string; counts: StatusCounts; costShare: number`
  - `View` zusätzlich: `status: StatusCounts; overview: Overview`
  - `type Overview = { cost: string; tokens: string; time: string; shares: Shares; amounts: { input: string; output: string; cacheRead: string; cacheWrite: string }; line: string }`
  - `countsLine(c: StatusCounts): string`, `statusLine(c: StatusCounts): string`, `visibleRows(g: Group, hideDone: boolean): Row[]`

- [x] **Step 1: Tests** (an `spec/view.spec.ts` anhängen; `agent()` liefert jetzt `effort: 'medium'`)

```ts
import { countsLine, sharesOf, statusLine, visibleRows } from '../hooks/view.ts'

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

test('words the status counts as a line and as a short summary', () => {
  const c = { running: 2, done: 9, failed: 1, aborted: 0 }
  assert.equal(statusLine(c), '● läuft 2   ✓ fertig 9   ✗ gescheitert 1   ⊘ abgebrochen 0')
  assert.equal(countsLine(c), '● 2  ✓ 9  ✗ 1')
  assert.equal(countsLine({ running: 0, done: 3, failed: 0, aborted: 2 }), '● 0  ✓ 3  ⊘ 2')
})

test('hides finished rows on request', () => {
  const v = buildView(input(plain([lead({}), agent({ id: 'a', name: 'a' }), agent({ id: 'r', name: 'r' })]), { live: [{ id: 'r', status: 'running' }] }))
  const g = v.groups.find((x) => x.key === 'agents')
  assert.ok(g)
  assert.deepEqual(visibleRows(g, false).map((r) => r.label), ['r', 'a'])
  assert.deepEqual(visibleRows(g, true).map((r) => r.label), ['r'])
})
```

- [x] **Step 2: Rot** — Run: `node --test spec/view.spec.ts` → FAIL (Exporte fehlen).

- [x] **Step 3: Implementieren** (in `hooks/view.ts`)

Neue Typen und Helfer oben nach `Glyph`:

```ts
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
}

const STATUS_OF: Record<Glyph, Status> = { '●': 'running', '✓': 'done', '✗': 'failed', '⊘': 'aborted' }
const noCounts = (): StatusCounts => ({ running: 0, done: 0, failed: 0, aborted: 0 })

export function sharesOf(t: TokenCounts): Shares {
  const total = tokenSum(t)
  if (total === 0) return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  return { input: t.input / total, output: t.output / total, cacheRead: t.cacheRead / total, cacheWrite: (t.cacheWrite5m + t.cacheWrite1h) / total }
}

const addTokens = (agents: AgentSummary[]): TokenCounts => agents.reduce<TokenCounts>((n, a) => ({
  input: n.input + a.tokens.input,
  output: n.output + a.tokens.output,
  cacheRead: n.cacheRead + a.tokens.cacheRead,
  cacheWrite5m: n.cacheWrite5m + a.tokens.cacheWrite5m,
  cacheWrite1h: n.cacheWrite1h + a.tokens.cacheWrite1h,
}), { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })
```

`tokenSum` muss über `sharesOf` stehen (die Funktion steht heute weiter oben — Reihenfolge prüfen).

`Row`, `Group`, `View` erweitern:

```ts
export type Row = { key: string; glyph: Glyph; status: Status; label: string; model: string; effort: string; cost: string; tokens: string; time: string; note: string; detail: string; shares: Shares; meta: string }
export type Group = { key: string; role: string; title: string; cost: string; tokens: string; time: string; costUsd: number; costShare: number; isRunning: boolean; counts: StatusCounts; rows: Row[] }
export type View = { title: string; totals: string; counts: string; notices: string[]; groups: Group[]; status: StatusCounts; overview: Overview }
```

Im `null`-Zweig von `buildView` die neuen Felder mitgeben:

```ts
  if (!s) return { title: 'Agents', totals: input.error ? '' : 'lade …', counts: '', notices, groups: [], status: noCounts(), overview: emptyOverview() }
```

mit

```ts
const emptyOverview = (): Overview => ({ cost: '≈ $0.00', tokens: '0', time: '0:00', shares: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, amounts: { input: '0', output: '0', cacheRead: '0', cacheWrite: '0' }, line: '' })
```

In `rowOf` die neuen Felder (nach `detail`):

```ts
      status: STATUS_OF[glyph],
      effort: a.effort,
      shares: sharesOf(a.tokens),
      meta: [modelName(a.model), a.effort, ...(glyph === '✗' || glyph === '⊘' ? [noteOf(a, glyph)] : [a.unpriced ? '?' : fmtCost(a.costUsd), `⏱ ${time}`, reported])]
        .filter((p) => p !== '').join(' · '),
```

`time` vorher als Konstante berechnen (`const time = fmtTime(…)`) und im bestehenden Feld `time: time` verwenden.

In der Gruppenbildung (`buckets` bleibt), im `map` zusätzlich:

```ts
    const counts = noCounts()
    for (const a of members) counts[STATUS_OF[glyphs.get(a) as Glyph]] += 1
```

und im zurückgegebenen Objekt `role: key, counts, costShare: 0` — `costShare` wird nach der Summenbildung gesetzt:

```ts
  const total = s.agents.reduce((n, a) => n + a.costUsd, 0)
  for (const g of groups) g.costShare = total > 0 ? g.costUsd / total : 0
```

(`total` wird heute schon berechnet; die Zeile wandert vor die Schleife, `groups` ist dafür `const` mit veränderbaren Objekten.)

Status und Übersicht am Ende:

```ts
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
  }
```

und `status`, `overview` ins zurückgegebene Objekt.

Neue Exporte unten:

```ts
export const statusLine = (c: StatusCounts): string =>
  `● läuft ${c.running}   ✓ fertig ${c.done}   ✗ gescheitert ${c.failed}   ⊘ abgebrochen ${c.aborted}`

export const countsLine = (c: StatusCounts): string =>
  [`● ${c.running}`, `✓ ${c.done}`, ...(c.failed ? [`✗ ${c.failed}`] : []), ...(c.aborted ? [`⊘ ${c.aborted}`] : [])].join('  ')

export const visibleRows = (g: Group, hideDone: boolean): Row[] => (hideDone ? g.rows.filter((r) => r.status !== 'done') : g.rows)
```

- [x] **Step 4: Grün** — Run: `npm test` → PASS, 100 % für `hooks/view.ts`; `npm run typecheck` → exit 0.

- [x] **Step 5: Commit** — `Give the panel view counts, token shares and row details for the new layout`

---

### Task 3: Krabben und Kostüme

**Files:**
- Create: `hooks/sprites.ts`, `spec/sprites.spec.ts`

**Interfaces:**
- Produces:
  - `type Part = 'bd' | 'la' | 'lb'`
  - `type Pixel = readonly [x: number, y: number, w: number, h: number, color: string, part?: Part]`
  - `GRID_W = 30`, `GRID_H = 28`
  - `COSTUMES: Record<string, { label: string; props: readonly Pixel[] }>` (Schlüssel siehe unten)
  - `costumeOf(role: string): string`
  - `spriteOf(costume: string): readonly Pixel[]` (Körper + Kostüm)
  - `pixelGrid(pixels: readonly Pixel[]): (string | null)[][]` (Zeilen × Spalten, Farbe oder null)

- [x] **Step 1: Test**

`spec/sprites.spec.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { COSTUMES, GRID_H, GRID_W, costumeOf, pixelGrid, spriteOf } from '../hooks/sprites.ts'

test('has a costume for every agent role in the repo and for browser-tester', () => {
  const agents = join(import.meta.dirname, '..', '..', '..', 'agents')
  const roles = readdirSync(agents).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
  for (const role of [...roles.filter((r) => r !== 'orchestrator'), 'browser-tester', 'lead']) {
    assert.notEqual(costumeOf(role), 'plain', role)
  }
})

test('maps roles to costumes, with plugin prefixes, browser names and a plain fallback', () => {
  assert.equal(costumeOf('lead'), 'lead')
  assert.equal(costumeOf('implementer-backend'), 'backend')
  assert.equal(costumeOf('x:browser-agent'), 'browser')
  assert.equal(costumeOf('playwright-runner'), 'browser')
  assert.equal(costumeOf('Explore'), 'explorer')
  assert.equal(costumeOf('general-purpose'), 'plain')
})

test('keeps every pixel inside the grid', () => {
  for (const key of Object.keys(COSTUMES)) {
    for (const [x, y, w, h] of spriteOf(key)) {
      assert.ok(x >= 0 && y >= 0 && x + w <= GRID_W && y + h <= GRID_H, `${key} ${x},${y},${w},${h}`)
    }
  }
})

test('paints a grid with the body clay and empty cells', () => {
  const g = pixelGrid(spriteOf('plain'))
  assert.equal(g.length, GRID_H)
  assert.equal(g[0]?.length, GRID_W)
  assert.equal(g[10]?.[7], '#D97757')
  assert.equal(g[12]?.[9], '#1F1E1D')
  assert.equal(g[0]?.[0], null)
})

test('falls back to the plain crab for an unknown costume key', () => {
  assert.deepEqual(spriteOf('nope'), spriteOf('plain'))
})
```

- [x] **Step 2: Rot** — Run: `node --test spec/sprites.spec.ts` → FAIL (Modul fehlt).

- [x] **Step 3: Implementieren**

`hooks/sprites.ts`:

```ts
// The crab follows Pixel Clawd as savvy-progress draws it (claude-kit, MIT License,
// Copyright (c) 2026 johnnyvizz): a 24×18 crab on a 30×28 grid, legs in two
// groups so a walk can lift them in turn. The costumes are this plugin's own.

export type Part = 'bd' | 'la' | 'lb'
export type Pixel = readonly [x: number, y: number, w: number, h: number, color: string, part?: Part]

export const GRID_W = 30
export const GRID_H = 28

const CLAY = '#D97757'
const INK = '#1F1E1D'

const BODY: readonly Pixel[] = [
  [7, 10, 16, 12, CLAY], [3, 14, 4, 4, CLAY], [23, 14, 4, 4, CLAY],
  [9, 12, 2, 2, INK], [19, 12, 2, 2, INK],
  [7, 22, 2, 4, CLAY, 'la'], [17, 22, 2, 4, CLAY, 'la'], [11, 22, 2, 4, CLAY, 'lb'], [21, 22, 2, 4, CLAY, 'lb'],
]

export const COSTUMES: Record<string, { label: string; props: readonly Pixel[] }> = {
  lead: { label: 'Krone', props: [[9, 5, 12, 3, '#E3B341'], [9, 3, 2, 2, '#E3B341'], [14, 2, 2, 3, '#E3B341'], [19, 3, 2, 2, '#E3B341'], [14, 6, 2, 1, '#C0392B']] },
  backend: { label: 'Bauhelm', props: [[8, 6, 14, 4, '#F0B35B'], [6, 9, 18, 1, '#F0B35B'], [14, 5, 2, 1, '#F0B35B']] },
  frontend: { label: 'Pinsel', props: [[25, 6, 2, 8, '#8B5A2B'], [24, 3, 4, 3, '#8F8CF4'], [9, 7, 12, 3, '#8F8CF4']] },
  infra: { label: 'Schraubenschlüssel', props: [[25, 6, 2, 8, '#7A8794'], [23, 3, 6, 3, '#7A8794'], [25, 4, 2, 1, '#FBFAF8']] },
  ux: { label: 'Barett', props: [[8, 7, 14, 3, '#C2185B'], [13, 5, 6, 2, '#C2185B'], [15, 4, 2, 1, '#C2185B']] },
  verifier: { label: 'Lupe', props: [[23, 4, 6, 6, '#2F6DB5'], [24, 5, 4, 4, '#CFE3F7'], [24, 10, 2, 4, '#5A3E2B']] },
  reviewer: { label: 'Brille', props: [[8, 11, 4, 4, INK], [18, 11, 4, 4, INK], [9, 12, 2, 2, '#CFE3F7'], [19, 12, 2, 2, '#CFE3F7'], [12, 12, 6, 1, INK]] },
  security: { label: 'Schild', props: [[0, 10, 6, 8, '#2F8A52'], [1, 18, 4, 2, '#2F8A52'], [2, 12, 2, 4, '#E4F4EA']] },
  hunter: { label: 'Kescher', props: [[25, 8, 1, 8, '#8B5A2B'], [22, 2, 7, 6, '#5FBF8F'], [23, 3, 5, 4, '#E4F4EA']] },
  cleaner: { label: 'Besen', props: [[25, 4, 1, 12, '#8B5A2B'], [23, 16, 5, 3, '#E3B341']] },
  explorer: { label: 'Kompass', props: [[23, 5, 6, 6, '#E4E4E1'], [25, 6, 2, 2, '#C0392B'], [25, 8, 2, 2, INK]] },
  researcher: { label: 'Buch', props: [[22, 6, 7, 6, '#6D4C9F'], [25, 6, 1, 6, '#E4E4E1']] },
  planner: { label: 'Karte', props: [[21, 3, 8, 7, '#F3E6C4'], [22, 5, 6, 1, '#3A9E9E'], [23, 7, 4, 1, '#C0392B']] },
  browser: {
    label: 'Browserfenster',
    props: [
      [20, 1, 10, 8, '#2F6DB5'], [21, 3, 8, 5, '#F4F7FB'], [21, 2, 1, 1, '#E06C5B'], [23, 2, 1, 1, '#E3B341'], [25, 2, 1, 1, '#5FBF8F'],
      [22, 4, 5, 1, '#B8C7DA'], [22, 6, 3, 1, '#B8C7DA'],
      [26, 9, 1, 4, INK], [27, 10, 1, 2, INK], [28, 11, 1, 1, INK],
    ],
  },
  plain: { label: 'ohne Kostüm', props: [] },
}

const BY_ROLE: Record<string, string> = {
  lead: 'lead',
  orchestrator: 'lead',
  'implementer-backend': 'backend',
  'implementer-frontend': 'frontend',
  'implementer-infra': 'infra',
  'implementer-ux': 'ux',
  verifier: 'verifier',
  'code-reviewer': 'reviewer',
  'security-reviewer': 'security',
  'bug-hunter': 'hunter',
  cleaner: 'cleaner',
  explorer: 'explorer',
  Explore: 'explorer',
  researcher: 'researcher',
  planner: 'planner',
  'browser-tester': 'browser',
}

export function costumeOf(role: string): string {
  const bare = role.replace(/^[^:]*:/, '')
  if (/browser|playwright/i.test(bare)) return 'browser'
  return BY_ROLE[bare] ?? 'plain'
}

export function spriteOf(costume: string): readonly Pixel[] {
  return [...BODY, ...(COSTUMES[costume] ?? (COSTUMES.plain as { props: readonly Pixel[] })).props]
}

export function pixelGrid(pixels: readonly Pixel[]): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: GRID_H }, () => Array<string | null>(GRID_W).fill(null))
  for (const [x, y, w, h, color] of pixels) {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) (grid[r] as (string | null)[])[c] = color
  }
  return grid
}
```

- [x] **Step 4: Grün** — Run: `node --test spec/sprites.spec.ts` → PASS; `npm test` → 100 % für `hooks/sprites.ts` (Coverage-Include in `package.json` um `--test-coverage-include=hooks/sprites.ts --test-coverage-include=hooks/art.ts --test-coverage-include=hooks/open.ts` erweitern); `npm run typecheck` → exit 0.

- [x] **Step 5: Commit** — `Add the crab sprite and a costume per agent role`

---

### Task 4: Zeichnungen (SVG und Terminal)

**Files:**
- Create: `hooks/art.ts`, `spec/art.spec.ts`

**Interfaces:**
- Consumes: `Shares`, `StatusCounts`, `Status` (Task 2); `spriteOf`, `pixelGrid`, `Pixel`, `GRID_W`, `GRID_H` (Task 3)
- Produces:
  - `type Palette = { name: 'light' | 'dark'; tile: string; track: string; ink: string; sub: string; cacheRead: string }`
  - `LIGHT: Palette`, `DARK: Palette`, `paletteOf(theme: unknown): Palette`
  - `STATUS_COLOR: Record<Status, string>`, `tokenColors(p: Palette): Record<keyof Shares, string>`
  - `SVG_W = 320`
  - `tilesSvg(p: Palette, tiles: { label: string; value: string }[]): string`
  - `stripeSvg(p: Palette, s: Shares, height: number): string`
  - `statusSvg(p: Palette, c: StatusCounts): string`
  - `costBarSvg(p: Palette, share: number): string`
  - `crabSvg(costume: string, isRunning: boolean): string`
  - `type Segment = { text: string; color: string }`
  - `blockBar(parts: { share: number; color: string }[], width: number, track: string): Segment[]`
  - `crabRaster(costume: string): { columns: number; rows: number; cells: string }`
  - `SVG_LIMIT = 131_072`

- [x] **Step 1: Test**

`spec/art.spec.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DARK, LIGHT, STATUS_COLOR, SVG_LIMIT, blockBar, costBarSvg, crabRaster, crabSvg, paletteOf, statusSvg, stripeSvg, tilesSvg, tokenColors } from '../hooks/art.ts'

const shares = { input: 0.1, output: 0.2, cacheRead: 0.6, cacheWrite: 0.1 }

test('picks the dark palette for a dark theme and light otherwise', () => {
  assert.equal(paletteOf('dark'), DARK)
  assert.equal(paletteOf('dark-daltonized'), DARK)
  assert.equal(paletteOf('light'), LIGHT)
  assert.equal(paletteOf(undefined), LIGHT)
  assert.equal(paletteOf(true), LIGHT)
})

test('draws the tiles with their labels and values in the palette', () => {
  const svg = tilesSvg(DARK, [{ label: 'Kosten', value: '≈ $4.12' }, { label: 'Tokens', value: '1.8M' }, { label: 'Zeit', value: '38:12' }])
  assert.match(svg, /^<svg /)
  assert.ok(svg.includes(DARK.tile) && svg.includes('Kosten') && svg.includes('38:12'))
  assert.ok(tilesSvg(LIGHT, [{ label: 'a', value: '<&>' }]).includes('&lt;&amp;&gt;'))
})

test('draws a token stripe with one rect per non-empty share, and only the track for no tokens', () => {
  const svg = stripeSvg(LIGHT, shares, 10)
  const colors = tokenColors(LIGHT)
  for (const c of Object.values(colors)) assert.ok(svg.includes(c), c)
  assert.equal((stripeSvg(LIGHT, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, 6).match(/<rect/g) ?? []).length, 1)
  assert.ok(stripeSvg(DARK, shares, 6).includes(DARK.cacheRead))
})

test('draws the status bar in the status colours, skipping empty statuses', () => {
  const svg = statusSvg(LIGHT, { running: 2, done: 9, failed: 1, aborted: 0 })
  assert.ok(svg.includes(STATUS_COLOR.running) && svg.includes(STATUS_COLOR.done) && svg.includes(STATUS_COLOR.failed))
  assert.ok(!svg.includes(STATUS_COLOR.aborted))
  assert.equal((statusSvg(LIGHT, { running: 0, done: 0, failed: 0, aborted: 0 }).match(/<rect/g) ?? []).length, 1)
})

test('draws the cost bar as a share of the track, clamped to 0..1', () => {
  assert.match(costBarSvg(LIGHT, 0.25), /width="80"/)
  assert.match(costBarSvg(LIGHT, 2), /width="320"/)
  assert.equal((costBarSvg(LIGHT, 0).match(/<rect/g) ?? []).length, 1)
})

test('animates a running crab only, and honours reduced motion', () => {
  const run = crabSvg('verifier', true)
  assert.ok(run.includes('class="run"') && run.includes('prefers-reduced-motion'))
  assert.ok(!crabSvg('verifier', false).includes('class="run"'))
  assert.ok(run.includes('#2F6DB5'))
})

test('keeps every piece under the SVG limit with 200 agents', () => {
  const pieces = Array.from({ length: 200 }, () => [stripeSvg(LIGHT, shares, 6), costBarSvg(LIGHT, 0.5), crabSvg('browser', true)]).flat()
  for (const p of pieces) assert.ok(p.length < SVG_LIMIT)
  assert.ok(statusSvg(LIGHT, { running: 50, done: 140, failed: 5, aborted: 5 }).length < SVG_LIMIT)
})

test('builds a block bar of the given width from shares', () => {
  const bar = blockBar([{ share: 0.5, color: '#111111' }, { share: 0.25, color: '#222222' }], 8, '#999999')
  assert.deepEqual(bar, [{ text: '████', color: '#111111' }, { text: '██', color: '#222222' }, { text: '░░', color: '#999999' }])
  assert.deepEqual(blockBar([], 3, '#999999'), [{ text: '░░░', color: '#999999' }])
  assert.deepEqual(blockBar([{ share: 1, color: '#111111' }], 2, '#999999'), [{ text: '██', color: '#111111' }])
})

test('packs the crab into a 15×7 raster of half blocks', () => {
  const r = crabRaster('plain')
  assert.equal(r.columns, 15)
  assert.equal(r.rows, 7)
  const bytes = Uint8Array.from(atob(r.cells), (ch) => ch.charCodeAt(0))
  assert.equal(bytes.length, 15 * 7 * 12)
  const words = new Uint32Array(bytes.buffer)
  const chars = new Set<number>()
  for (let i = 0; i < words.length; i += 3) chars.add(words[i] as number)
  for (const c of chars) assert.ok([0x20, 0x2580, 0x2584].includes(c), c.toString(16))
  assert.ok(chars.has(0x2580) && chars.has(0x20))
})

test('uses a lower half block where only the bottom pixel is set', () => {
  // The body's top edge and the claws begin on a cell's lower sampled row, so those cells carry only their lower pixel.
  const words = new Uint32Array(Uint8Array.from(atob(crabRaster('plain').cells), (ch) => ch.charCodeAt(0)).buffer)
  const chars: number[] = []
  for (let i = 0; i < words.length; i += 3) chars.push(words[i] as number)
  assert.ok(chars.includes(0x2584))
})
```

- [x] **Step 2: Rot** — Run: `node --test spec/art.spec.ts` → FAIL.

- [x] **Step 3: Implementieren**

`hooks/art.ts`:

```ts
import { GRID_H, GRID_W, pixelGrid, spriteOf, type Part } from './sprites.ts'
import type { Shares, Status, StatusCounts } from './view.ts'

export type Palette = { name: 'light' | 'dark'; tile: string; track: string; ink: string; sub: string; cacheRead: string }

export const LIGHT: Palette = { name: 'light', tile: '#f1efea', track: '#efece6', ink: '#1f1f1f', sub: '#6b6b68', cacheRead: '#d8d5ce' }
export const DARK: Palette = { name: 'dark', tile: '#2b2a28', track: '#3a3936', ink: '#ecebe8', sub: '#a3a29e', cacheRead: '#5a5853' }

export const STATUS_COLOR: Record<Status, string> = { running: '#1d6fb8', done: '#2f8a52', failed: '#c0392b', aborted: '#b07a12' }

export const tokenColors = (p: Palette): Record<keyof Shares, string> => ({ input: '#8f8cf4', output: '#5fbf8f', cacheRead: p.cacheRead, cacheWrite: '#f0b35b' })

const COST_COLOR = '#8f8cf4'

export const SVG_W = 320
export const SVG_LIMIT = 131_072

export function paletteOf(theme: unknown): Palette {
  return typeof theme === 'string' && theme.includes('dark') ? DARK : LIGHT
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const doc = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

const FONT = 'font-family="system-ui,sans-serif"'

export function tilesSvg(p: Palette, tiles: { label: string; value: string }[]): string {
  const gap = 6
  const w = (SVG_W - gap * (tiles.length - 1)) / tiles.length
  const body = tiles.map((t, i) => {
    const x = i * (w + gap)
    return `<rect x="${x}" y="0" width="${w}" height="42" rx="8" fill="${p.tile}"/>` +
      `<text x="${x + 8}" y="15" ${FONT} font-size="11" fill="${p.sub}">${esc(t.label)}</text>` +
      `<text x="${x + 8}" y="34" ${FONT} font-size="15" font-weight="600" fill="${p.ink}">${esc(t.value)}</text>`
  }).join('')
  return doc(SVG_W, 42, body)
}

// Segments laid end to end over a rounded track; empty segments draw nothing.
function segments(parts: { share: number; color: string }[], height: number, track: string): string {
  let x = 0
  let body = `<rect x="0" y="0" width="${SVG_W}" height="${height}" rx="${height / 2}" fill="${track}"/>`
  for (const part of parts) {
    if (part.share <= 0) continue
    const w = part.share * SVG_W
    body += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="${part.color}"/>`
    x += w
  }
  return `<defs><clipPath id="c"><rect width="${SVG_W}" height="${height}" rx="${height / 2}"/></clipPath></defs><g clip-path="url(#c)">${body}</g>`
}

export function stripeSvg(p: Palette, s: Shares, height: number): string {
  const c = tokenColors(p)
  return doc(SVG_W, height, segments([
    { share: s.input, color: c.input }, { share: s.output, color: c.output },
    { share: s.cacheRead, color: c.cacheRead }, { share: s.cacheWrite, color: c.cacheWrite },
  ], height, p.track))
}

export function statusSvg(p: Palette, c: StatusCounts): string {
  const total = c.running + c.done + c.failed + c.aborted
  const order: Status[] = ['running', 'done', 'failed', 'aborted']
  const parts = order.map((k) => ({ share: total > 0 ? c[k] / total : 0, color: STATUS_COLOR[k] }))
  return doc(SVG_W, 10, segments(parts, 10, p.track))
}

export function costBarSvg(p: Palette, share: number): string {
  const s = Math.min(1, Math.max(0, share))
  return doc(SVG_W, 5, segments([{ share: s, color: COST_COLOR }], 5, p.track))
}

// Pure CSS, run by the compositor: a running crab lifts its two leg groups in turn.
const CRAB_CSS = '<style>.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}' +
  '.run .bd{animation:bob .5s steps(1) infinite -.125s}@keyframes st{50%{transform:translateY(-1px)}}' +
  '@keyframes bob{50%{transform:translateY(1px)}}@media (prefers-reduced-motion: reduce){.run *{animation:none!important}}</style>'

export function crabSvg(costume: string, isRunning: boolean): string {
  const parts: Record<Part, string[]> = { bd: [], la: [], lb: [] }
  for (const [x, y, w, h, color, part] of spriteOf(costume)) {
    parts[part ?? 'bd'].push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`)
  }
  const body = `<g${isRunning ? ' class="run"' : ''}><g class="bd">${parts.bd.join('')}</g><g class="la">${parts.la.join('')}</g><g class="lb">${parts.lb.join('')}</g></g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="41" viewBox="0 0 ${GRID_W} ${GRID_H}" shape-rendering="crispEdges">${CRAB_CSS}${body}</svg>`
}

export type Segment = { text: string; color: string }

export function blockBar(parts: { share: number; color: string }[], width: number, track: string): Segment[] {
  const out: Segment[] = []
  let used = 0
  for (const part of parts) {
    const n = Math.min(width - used, Math.round(part.share * width))
    if (n <= 0) continue
    out.push({ text: '█'.repeat(n), color: part.color })
    used += n
  }
  if (used < width) out.push({ text: '░'.repeat(width - used), color: track })
  return out
}

const DEFAULT_COLOR = 0x01000000
const UPPER = 0x2580
const LOWER = 0x2584
const SPACE = 0x20

const rgb = (hex: string): number => Number.parseInt(hex.slice(1), 16)

// Every second column and row of the 30×28 grid, two sampled rows per terminal row.
export function crabRaster(costume: string): { columns: number; rows: number; cells: string } {
  const grid = pixelGrid(spriteOf(costume))
  const columns = GRID_W / 2
  const rows = GRID_H / 4
  const words: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const top = grid[r * 4]?.[c * 2] ?? null
      const bottom = grid[r * 4 + 2]?.[c * 2] ?? null
      if (top && bottom) words.push(UPPER, rgb(top), rgb(bottom))
      else if (top) words.push(UPPER, rgb(top), DEFAULT_COLOR)
      else if (bottom) words.push(LOWER, rgb(bottom), DEFAULT_COLOR)
      else words.push(SPACE, DEFAULT_COLOR, DEFAULT_COLOR)
    }
  }
  const bytes = new Uint8Array(Uint32Array.from(words).buffer)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return { columns, rows, cells: btoa(bin) }
}
```

Hinweis: `GRID_H / 4 = 7` Zeilen, je Terminalzeile werden die Pixelzeilen `4r` und `4r+2` abgetastet (jede zweite Pixelzeile, zwei je Zelle). Liefert der Test „uses a lower half block …“ für `plain` keinen unteren Halbblock, die Abtastung nicht ändern, sondern im Test ein Kostüm wählen, dessen Pixel nur in der unteren Abtastzeile liegen (z. B. `cleaner`), und das im Bericht nennen.

- [x] **Step 4: Grün** — Run: `node --test spec/art.spec.ts` → PASS; `npm test` → 100 % für `hooks/art.ts`; `npm run typecheck` → exit 0.

- [x] **Step 5: Commit** — `Draw tiles, stripes, bars and crabs as SVG and terminal cells`

---

### Task 5: Öffnungsregeln

**Files:**
- Create: `hooks/open.ts`, `spec/open.spec.ts`

**Interfaces:**
- Produces:
  - `type SpawnLog = { teammateAt: number | null; recent: number[] }`
  - `EMPTY_LOG: SpawnLog`
  - `TEAM_GAP_MS = 600_000`, `BURST = 3`, `BURST_MS = 30_000`
  - `onSpawn(log: SpawnLog, at: number, isTeammate: boolean): { log: SpawnLog; shouldOpen: boolean }`

- [x] **Step 1: Test**

`spec/open.spec.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EMPTY_LOG, onSpawn, type SpawnLog } from '../hooks/open.ts'

const S = 1000
const run = (spawns: [number, boolean][]): boolean[] => {
  let log: SpawnLog = EMPTY_LOG
  return spawns.map(([at, isTeammate]) => {
    const r = onSpawn(log, at, isTeammate)
    log = r.log
    return r.shouldOpen
  })
}

test('opens on the first teammate of a run, not on the second', () => {
  assert.deepEqual(run([[0, true], [60 * S, true]]), [true, false])
})

test('opens again for a teammate after ten quiet minutes', () => {
  assert.deepEqual(run([[0, true], [601 * S, true]]), [true, true])
  assert.deepEqual(run([[0, true], [600 * S, true]]), [true, false])
})

test('opens on the third spawn within thirty seconds', () => {
  assert.deepEqual(run([[0, false], [10 * S, false], [29 * S, false]]), [false, false, true])
})

test('does not open for two spawns, nor three spread over 31 s', () => {
  assert.deepEqual(run([[0, false], [5 * S, false]]), [false, false])
  assert.deepEqual(run([[0, false], [16 * S, false], [31 * S, false]]), [false, false, false])
})

test('keeps only the spawns of the last thirty seconds', () => {
  let log: SpawnLog = EMPTY_LOG
  for (const at of [0, 1 * S, 40 * S]) log = onSpawn(log, at, false).log
  assert.deepEqual(log.recent, [40 * S])
})
```

- [x] **Step 2: Rot** — Run: `node --test spec/open.spec.ts` → FAIL.

- [x] **Step 3: Implementieren**

`hooks/open.ts`:

```ts
export type SpawnLog = { teammateAt: number | null; recent: number[] }

export const EMPTY_LOG: SpawnLog = { teammateAt: null, recent: [] }

// A teammate after this long a silence starts a new run or generation.
export const TEAM_GAP_MS = 600_000
// This many spawns inside the window count as a swarm.
export const BURST = 3
export const BURST_MS = 30_000

export function onSpawn(log: SpawnLog, at: number, isTeammate: boolean): { log: SpawnLog; shouldOpen: boolean } {
  const recent = [...log.recent.filter((t) => at - t < BURST_MS), at]
  const isNewRun = isTeammate && (log.teammateAt === null || at - log.teammateAt > TEAM_GAP_MS)
  return {
    log: { teammateAt: isTeammate ? at : log.teammateAt, recent },
    shouldOpen: isNewRun || recent.length >= BURST,
  }
}
```

- [x] **Step 4: Grün** — Run: `node --test spec/open.spec.ts` → PASS; `npm test` → 100 % für `hooks/open.ts`.

- [x] **Step 5: Commit** — `Decide when a spawn reopens the panel: a new team run or a swarm`

---

### Task 6: Verdrahtung im Mod

**Files:**
- Modify: `hooks/register.ts`, `hooks/register.test.ts`

**Interfaces:**
- Consumes: alles aus Tasks 2–5; bestehend `parseResult`, `startError`, `reportedCost`, `scriptArgs`, `dirsOf`, `toggle`, `isOpen`, `rowLine`, `detailLine`, `glyphColor`, `groupLine`.

- [x] **Step 1: Kit-Tests ergänzen** (in `hooks/register.test.ts`; `LEAD` bekommt `effort: 'xhigh'`; eine zweite Agent-Zusammenfassung `TEAM` mit `runId: 'r1'`, einem Lead und einem `implementer-backend`-Agent `a1`)

```ts
const AGENT = { ...LEAD, id: 'a1', kind: 'agent', name: 'impl-T1', role: 'implementer-backend', task: 'impl T1', model: 'claude-sonnet-5-5', effort: 'medium' }
const TEAM = JSON.stringify({ runId: 'r1', generations: ['s1'], agents: [LEAD, AGENT], unreadableLines: 0, problems: [] })
const WIDE = (surface: 'terminal' | 'desktop') => ({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 80 } })
const NARROW = (surface: 'terminal' | 'desktop') => ({ ...PANE, surface, props: { ...PANE.props, bodyColumns: 50 } })

test('the desktop draws SVG pieces and a crab per role when wide', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [{ key: 'theme', value: 'dark' }] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('desktop'))
  expect(await ui.find({ key: 'svg-tiles' })).toBeDefined()
  expect(await ui.find({ key: 'crab-implementer-backend' })).toBeDefined()
  const narrow = await $.ui.mount(NARROW('desktop'))
  expect(await narrow.find({ key: 'crab-implementer-backend' })).toBeUndefined()
})

test('the terminal draws block bars and raster crabs when wide', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('terminal'))
  expect(await ui.find({ key: 'crab-implementer-backend' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
})

test('the section buttons fold the overview and the agents, and hide finished rows', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ value: [] }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(NARROW('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Kosten ≈/ })).toBeDefined()
  await ui.press({ key: 'sec-overview' })
  expect(await ui.find({ type: 'Text', text: /^Kosten ≈/ })).toBeUndefined()
  expect(await ui.find({ key: 'r-a1' })).toBeDefined()
  await ui.press({ key: 'hide-done' })
  expect(await ui.find({ key: 'r-a1' })).toBeUndefined()
  await ui.press({ key: 'sec-agents' })
  expect(await ui.find({ key: 'g-implementer-backend' })).toBeUndefined()
})

test('a new team run reopens the panel after it was closed', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), opened, [], [])
  on('config.list', () => ({ value: [] }))
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await $.command.run(TOGGLE)
  await $.agent.spawn({ subagentType: 'implementer-backend', description: 'x', prompt: 'x', isTeammate: true })
  expect(opened).toEqual(['agent-panel', 'agent-panel'])
})

test('a failed theme read falls back to the light palette and still draws', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: TEAM, stderr: '' }), [], [], [])
  on('config.list', () => ({ deny: 'no config' }))
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('desktop'))
  // A failed theme read falls back to light and still draws.
  expect(await ui.find({ key: 'svg-tiles' })).toBeDefined()
})
```

Die bisherigen Tests, die nach `type: 'Text', text: /^≈ \$0\.02/` suchen, auf das neue Kachel-Layout umstellen: im Terminal steht die Übersicht als Text `Kosten ≈ $0.02 · Tokens … · Zeit …` (siehe Step 3), in der Desktop-App als `Svg` mit Schlüssel `svg-tiles`. Den Fall „Zeichnung wirft“ deckt die Fehlerbehandlung in Step 3 ab; einen echten Wurf aus `art.ts` kann kein Kit-Stub auslösen, er bleibt dem Rauchtest. Der letzte Test prüft stattdessen, dass ein verweigertes `config.list` nicht stört.

- [x] **Step 2: Rot** — Run: `npm run kit` → FAIL (Schlüssel `svg-tiles`, `crab-…`, `sec-overview`, `hide-done` fehlen).

- [x] **Step 3: Implementieren** (`hooks/register.ts`)

Zusätzliche Imports:

```ts
import { blockBar, costBarSvg, crabRaster, crabSvg, paletteOf, STATUS_COLOR, statusSvg, stripeSvg, tilesSvg, tokenColors, type Palette } from './art.ts'
import { EMPTY_LOG, onSpawn, type SpawnLog } from './open.ts'
import { costumeOf } from './sprites.ts'
import { countsLine, statusLine, visibleRows, type Group, type Row, type Shares, type View } from './view.ts'
```

Neuer Modulzustand:

```ts
const WIDE_COLUMNS = 70
let palette: Palette = paletteOf(undefined)
let spawnLog: SpawnLog = EMPTY_LOG
let isOverviewOpen = true
let isAgentsOpen = true
let isHidingDone = false
```

Theme lesen (oberste Ebene, `$` erlaubt):

```ts
async function readTheme($: EngineInterface): Promise<void> {
  try {
    palette = paletteOf((await $.config.list()).find((row) => row.key === 'theme')?.value)
  } catch {
    palette = paletteOf(undefined)
  }
}
```

`readTheme($)` am Anfang von `session.start` und in `refresh` direkt nach dem `isOpen`-Check aufrufen.

`agent.spawn` ersetzen:

```ts
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    const decision = onSpawn(spawnLog, await $.clock.now(), e.isTeammate === true)
    spawnLog = decision.log
    const isShown = isOpen(await $.ui.panes(), PANE)
    if (!isShown && (!hasOpened || decision.shouldOpen)) await openPane($, false)
    else void refresh($)
    return started
  })
```

(Die Regel „erster Spawn der Sitzung öffnet“ aus der ersten Spec bleibt; A und B kommen hinzu.)

`ui.render` neu aufbauen. Gerüst (Desktop und Terminal gemeinsam; `isDesktop = e.surface === 'desktop'`, `isWide = (e.props.bodyColumns ?? 0) >= WIDE_COLUMNS`, `cols = Math.max(10, (e.props.bodyColumns ?? 40) - 4)`):

```ts
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Svg, Raster } = $.ui.resolve(e)
    const v = buildView({ summary, live, reportedCostUsd: reported, costIncludesAgents: REPORTED_COST_INCLUDES_AGENTS, now: await $.clock.now(), error })
    const isDesktop = e.surface === 'desktop'
    const isWide = (e.props.bodyColumns ?? 0) >= WIDE_COLUMNS
    const cols = Math.max(10, (e.props.bodyColumns ?? 40) - 4)
    const redraw = () => $.ui.invalidate('ui.render')
    const bar = (key: string, parts: { share: number; color: string }[], svg: string) => isDesktop
      ? Svg({ key, source: svg, alt: key })
      : Box({ key, flexDirection: 'row', children: blockBar(parts, cols, palette.track).map((s) => Text({ color: s.color, children: [s.text] })) })
    const shareParts = (s: Shares) => {
      const c = tokenColors(palette)
      return [{ share: s.input, color: c.input }, { share: s.output, color: c.output }, { share: s.cacheRead, color: c.cacheRead }, { share: s.cacheWrite, color: c.cacheWrite }]
    }
    const crab = (g: Group) => isDesktop
      ? Svg({ key: `crab-${g.role}`, source: crabSvg(costumeOf(g.role), g.isRunning), alt: `Krabbe ${g.title}` })
      : Raster({ key: `crab-${g.role}`, ...crabRaster(costumeOf(g.role)) })
    const row = (r: Row) => [
      Box({ flexDirection: 'row', children: [
        Text({ color: STATUS_COLOR[r.status], children: [`${r.glyph} `] }),
        Button({ key: `r-${r.key}`, plain: true, label: r.label, onPress: () => { toggle(expanded, r.key); redraw() } }),
        Text({ dimColor: true, wrap: 'truncate-end', children: [`  ${r.meta}`] }),
      ] }),
      bar(`stripe-${r.key}`, shareParts(r.shares), stripeSvg(palette, r.shares, 6)),
      ...(expanded.has(r.key) ? [Text({ dimColor: true, children: [detailLine(r)] })] : []),
    ]
    const group = (g: Group) => {
      const isGroupOpen = !collapsed.has(g.key)
      const body = [
        Box({ flexDirection: 'row', justifyContent: 'space-between', children: [
          Button({ key: `g-${g.key}`, plain: true, label: `${isGroupOpen ? '▾' : '▸'} ${g.title}  ${countsLine(g.counts)}`, onPress: () => { toggle(collapsed, g.key); redraw() } }),
          Text({ bold: true, children: [g.cost] }),
        ] }),
        ...(isGroupOpen ? [bar(`cost-${g.key}`, [{ share: g.costShare, color: '#8f8cf4' }], costBarSvg(palette, g.costShare)), ...visibleRows(g, isHidingDone).flatMap(row)] : []),
      ]
      return Box({ key: `card-${g.key}`, flexDirection: 'row', borderStyle: 'round', paddingX: 1, columnGap: 1, children: [
        ...(isWide ? [crab(g)] : []),
        Box({ flexDirection: 'column', flexGrow: 1, children: body }),
      ] })
    }
    return Box({ flexDirection: 'column', children: [
      Text({ bold: true, wrap: 'truncate-end', children: [v.title] }),
      ...v.notices.map((n) => Text({ color: 'warning', wrap: 'truncate-end', children: [n] })),
      Button({ key: 'sec-overview', plain: true, label: `${isOverviewOpen ? '▾' : '▸'} Übersicht${isOverviewOpen ? '' : `   ${v.overview.line}`}`, onPress: () => { isOverviewOpen = !isOverviewOpen; redraw() } }),
      ...(isOverviewOpen ? [
        isDesktop
          ? Svg({ key: 'svg-tiles', source: tilesSvg(palette, [{ label: 'Kosten', value: v.overview.cost }, { label: 'Tokens', value: v.overview.tokens }, { label: 'Zeit', value: v.overview.time }]), alt: v.overview.line })
          : Text({ bold: true, children: [`Kosten ${v.overview.cost} · Tokens ${v.overview.tokens} · Zeit ${v.overview.time}`] }),
        bar('stripe-total', shareParts(v.overview.shares), stripeSvg(palette, v.overview.shares, 10)),
        Text({ dimColor: true, children: [`in ${v.overview.amounts.input} · out ${v.overview.amounts.output} · cache read ${v.overview.amounts.cacheRead} · cache write ${v.overview.amounts.cacheWrite}`] }),
      ] : []),
      Box({ flexDirection: 'row', justifyContent: 'space-between', children: [
        Button({ key: 'sec-agents', plain: true, label: `${isAgentsOpen ? '▾' : '▸'} Agents${isAgentsOpen ? '' : `   ${countsLine(v.status)}`}`, onPress: () => { isAgentsOpen = !isAgentsOpen; redraw() } }),
        ...(isAgentsOpen ? [Box({ flexDirection: 'row', columnGap: 1, children: [
          Button({ key: 'hide-done', plain: true, label: isHidingDone ? '[x] Fertige ausblenden' : '[ ] Fertige ausblenden', onPress: () => { isHidingDone = !isHidingDone; redraw() } }),
          Button({ key: 'fold-all', plain: true, label: 'Alle einklappen', onPress: () => { for (const g of v.groups) collapsed.add(g.key); redraw() } }),
          Button({ key: 'open-all', plain: true, label: 'Alle ausklappen', onPress: () => { collapsed.clear(); redraw() } }),
        ] })] : []),
      ] }),
      ...(isAgentsOpen ? [
        bar('status', (['running', 'done', 'failed', 'aborted'] as const).map((k) => ({ share: total(v) > 0 ? v.status[k] / total(v) : 0, color: STATUS_COLOR[k] })), statusSvg(palette, v.status)),
        Text({ dimColor: true, children: [statusLine(v.status)] }),
        ...v.groups.map(group),
      ] : []),
    ] })
  })
```

mit einer Hilfsfunktion auf oberster Ebene (keine Logik, nur Summe):

```ts
const total = (v: View): number => v.status.running + v.status.done + v.status.failed + v.status.aborted
```

Fehlerfall „Zeichnung wirft“: den Rumpf des `ui.render`-Hooks in `try { … } catch (err) { … }` fassen; im `catch` den bisherigen Text-Aufbau (Titel, `v.totals`, `v.counts`, Notices, Gruppen mit `groupLine`/`rowLine`) zurückgeben, davor `Text({ color: 'warning', children: [`⚠ Grafik: ${err instanceof Error ? err.message : String(err)}`] })`. Den bisherigen Text-Aufbau dafür in eine Funktion auf oberster Ebene `textTree(ui, v)` verschieben (sie bekommt die aufgelösten Elemente, nicht `$`).

Hinweise für die Umsetzung:
- Prüfe in `.claude-plugin/types/claude-code/index.d.ts`, ob `Box` `paddingX`, `columnGap`, `flexGrow`, `justifyContent` kennt und ob `Raster` und `Svg` in der Element-Tabelle der jeweiligen Oberfläche stehen; heißen Props anders, die Namen aus den Typen nehmen.
- `Svg` wird nur für `isDesktop`, `Raster` nur für das Terminal erzeugt (die jeweils andere Oberfläche hat das Element nicht).
- `Text({ color: 'warning' })` nutzt den Theme-Schlüssel; die Farben der Balken sind Hex-Werte.

- [x] **Step 4: Grün** — Run: `npm run kit` → alle Tests PASS; `npm run validate` → passed; `npm run typecheck` → exit 0; `npm test` → PASS, 100 %.

- [x] **Step 5: Ansehen** — `claude --plugin-dir plugins-src/agent-panel` in einem Terminal starten (Typen werden dabei neu geschrieben), `/agent-panel`, einen Subagenten starten; Screenshot bzw. Beschreibung von Terminal schmal und breit in den Bericht. Desktop-App sieht der Nutzer im Rauchtest (Task 7).

- [x] **Step 6: Commit** — `Draw the panel graphically: tiles, stripes, status bar, role cards with crabs`

---

### Task 7: README und Rauchtest

**Files:**
- Modify: `README.md` (Repo-Wurzel), `plugins-src/agent-panel/.claude-plugin/plugin.json`
- Create: `docs/.superpowers/smoke/2026-10-09-agent-panel-optik-rauchtest.md`

- [x] **Step 1: Version** — In `plugin.json` `"version": "0.2.0"`, damit die installierte Kopie sich erneuert (`claude plugin install agent-panel@claude-config` nach dem Merge).

- [x] **Step 2: README** — Im Abschnitt „Agent-Panel“ nach dem ersten Absatz einfügen:

```markdown
In der Desktop-App zeichnet das Panel Kacheln, einen Token-Streifen
(in / out / cache read / cache write), einen Status-Balken und je Rolle eine
Karte; im breiten Fenster (ab 70 Spalten) sitzt in jeder Karte eine
Pixel-Krabbe mit dem Kostüm der Rolle, die läuft, solange ein Agent der Rolle
läuft. Das Terminal zeigt denselben Aufbau mit Blockzeichen. Übersicht,
Agents und jede Rolle lassen sich einklappen; „Fertige ausblenden“ blendet
erledigte Agents aus. Das Panel folgt dem hellen oder dunklen Theme von
Claude Code und öffnet sich von selbst, wenn ein Team-Lauf startet oder
mindestens drei Agents in 30 Sekunden starten.
```

- [x] **Step 3: Rauchtest-Protokoll** — Checkliste mit Erwartung je Punkt, Beobachtung leer („offen — vom Nutzer“), für: Desktop hell, Desktop dunkel, Terminal schmal (< 70), Terminal breit (≥ 144, Krabben), Einklappen aller drei Ebenen, „Fertige ausblenden“, Team-Lauf öffnet das Panel nach Schließen erneut, drei Subagenten in 30 s öffnen es, ein Lauf mit vielen Agents bleibt flüssig.

- [x] **Step 4: Commit** — `Document the panel's new look and add its smoke checklist`
