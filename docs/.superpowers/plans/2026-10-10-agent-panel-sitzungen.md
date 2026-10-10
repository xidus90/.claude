# Agent-Panel: andere Sitzungen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Agent-Panel bietet oben rechts ein Dropdown mit den 20 zuletzt aktiven Sitzungen beider Konten und zeigt die gewählte Sitzung so an wie die eigene, nur ohne Live-Werte.

**Architecture:** `cli/sessions.ts` listet Sitzungen aus den Konfigurationsordnern; `cli/summarize.ts` bekommt dafür den Modus `--list`. `hooks/view.ts` prüft und beschriftet die Liste und kennt eine fremde Sitzung (`foreign`); `hooks/register.ts` hält Liste und Auswahl, lädt die Liste alle 10 s bei offenem Panel und zeichnet das `Select`.

**Tech Stack:** TypeScript ohne Build (Node ≥ 22.18), Claude-Code-Mods-API (`Select`, `Box`, `Text`), `node --test` mit Coverage, `claude plugin test`.

**Spec:** `docs/.superpowers/specs/2026-10-10-agent-panel-sitzungen-design.md`

## Global Constraints

- Alle Pfade relativ zu `plugins-src/agent-panel/`, außer sie beginnen mit `docs/`.
- `hooks/` spricht kein Node-API; Imports nur relativ mit `.ts`-Endung und `claude-code`.
- Coverage 100 % (Zeilen, Zweige, Funktionen) für `cli/**` und `hooks/view.ts`, `hooks/art.ts`, `hooks/sprites.ts`, `hooks/open.ts`; `hooks/register.ts` bleibt ausgeschlossen und ohne eigene Logik.
- Kein `any`, `erasableSyntaxOnly`, `noUncheckedIndexedAccess`.
- Grenze 20 Sitzungen; „läuft“ = Transkript jünger als 60 000 ms; Liste alle 10 000 ms; Kopf 16 KB, Ende 64 KB; Texte auf 60 Zeichen.
- Code und Kommentare englisch, Panel-Texte deutsch. Commits per Nachrichtendatei und `git commit -F`, kein `Co-Authored-By`.
- Tor: `npm test`, `npm run typecheck`, `npm run kit` in `plugins-src/agent-panel`.

## Review Focus

1. **Transkript ohne `cwd`-Zeile im gelesenen Teil** (frische oder riesige Sitzung): Projekt fällt auf den Ordnernamen unter `projects/` zurück, kein Wurf → Test in Task 1 („falls back to the project folder“).
2. **Gewählte Sitzung zur eigenen geworden** (Auswahl ist die eigene ID aus der Liste): wird als eigene behandelt, mit Live-Werten → Test in Task 3 (`foreign` nur bei fremder ID) und Task 4.
3. **Zweites Konto ohne `projects/`** oder fehlendes Home: Liste kommt aus dem vorhandenen Ordner, kein Fehler → Test in Task 1 und Task 2.
4. **Titel mit Steuerzeichen oder 10 000 Zeichen**: gesäubert und gekürzt → Test in Task 3 (`sessionLabel`).
5. **Zeit in der Zukunft** (Uhrzeit verstellt, `lastAt > now`): „gerade eben“ statt negativer Minuten → Test in Task 3.

---

### Task 1: Sitzungen auflisten (`cli/sessions.ts`)

**Files:**
- Create: `cli/sessions.ts`
- Modify: `shared/summary.ts`
- Test: `spec/sessions.spec.ts`

**Interfaces:**
- Produces in `shared/summary.ts`:
  `export type SessionInfo = { id: string; config: string; project: string; title: string; cwd: string; lastAt: number; isLive: boolean }`
- Produces in `cli/sessions.ts`:
  `export function listSessions(configs: string[], now: number): SessionInfo[]`
  `export function configsOf(home: string, own: string): string[]`

- [ ] **Step 1: Tests**

`spec/sessions.spec.ts`:

```ts
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
  session(a, 'C--r', 'titled', [{ type: 'custom-title', customTitle: 'Agent-team fortsetzen' }, { type: 'last-prompt', lastPrompt: 'later' }], NOW - 5000_000)
  session(a, 'C--r', 'untitled', [{ type: 'custom-title', customTitle: 'Untitled session' }, { type: 'last-prompt', lastPrompt: 'Fix the bars' }], NOW - 5001_000)
  session(a, 'C--r', 'new', [{ type: 'custom-title', customTitle: 'New session' }], NOW - 5002_000)
  session(a, 'C--r', 'abcdef1234', [{ type: 'user' }], NOW - 5003_000)
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
  assert.deepEqual(listSessions([a, join(a, 'missing')], NOW).map((s) => s.id), ['lead'])
})

test('finds the config folders in the home, the own one first and none twice', () => {
  const home = tempDir()
  for (const d of ['.claude', '.claude-b', '.claudex', '.claude-c']) mkdirSync(join(home, d), { recursive: true })
  for (const d of ['.claude', '.claude-b', '.claudex']) mkdirSync(join(home, d, 'projects'), { recursive: true })
  assert.deepEqual(configsOf(home, join(home, '.claude-b')), [join(home, '.claude-b'), join(home, '.claude')])
  assert.deepEqual(configsOf(join(home, 'missing'), '/own'), ['/own'])
})
```

- [ ] **Step 2: Rot** — Run: `node --test spec/sessions.spec.ts` → FAIL („Cannot find module '../cli/sessions.ts'“).

- [ ] **Step 3: Typ** — in `shared/summary.ts` anhängen:

```ts
/** One session of the picker, read from the head and tail of its transcript. */
export type SessionInfo = {
  id: string
  /** The config folder its transcript lives in, as passed to --config. */
  config: string
  project: string
  title: string
  cwd: string
  lastAt: number
  isLive: boolean
}
```

- [ ] **Step 4: Umsetzung** — `cli/sessions.ts`:

```ts
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
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
        try {
          const st = statSync(path)
          return st.isFile() ? [{ path, config, folder, id: name.slice(0, -6), mtime: st.mtimeMs }] : []
        } catch {
          return []
        }
      }),
  )
}

// The head can hold the app's title; the tail the newest title, prompt and cwd.
function edges(path: string): string {
  const fd = openSync(path, 'r')
  try {
    const size = statSync(path).size
    const read = (from: number, length: number): string => {
      const buf = Buffer.alloc(Math.max(0, length))
      readSync(fd, buf, 0, buf.length, from)
      return buf.toString('utf8')
    }
    if (size <= HEAD + TAIL) return read(0, size)
    return `${read(0, HEAD)}\n${read(size - TAIL, TAIL)}`
  } finally {
    closeSync(fd)
  }
}

function infoOf(f: Found, now: number): SessionInfo {
  let title = ''
  let prompt = ''
  let cwd = ''
  let text = ''
  try {
    text = edges(f.path)
  } catch {
    text = ''
  }
  for (const raw of text.split('\n')) {
    let line: unknown
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    if (typeof line !== 'object' || line === null || Array.isArray(line)) continue
    const l = line as Record<string, unknown>
    if (l.type === 'custom-title' && typeof l.customTitle === 'string' && !PLACEHOLDER.has(l.customTitle)) title = l.customTitle
    if (l.type === 'last-prompt' && typeof l.lastPrompt === 'string') prompt = l.lastPrompt
    if (typeof l.cwd === 'string') cwd = l.cwd
  }
  const project = cwd ? basename(cwd.replace(/[\\/]+$/, '')) : f.folder
  return { id: f.id, config: f.config, project, title: title || prompt || f.id.slice(0, 8), cwd, lastAt: f.mtime, isLive: now - f.mtime <= LIVE_MS }
}

export function listSessions(configs: string[], now: number): SessionInfo[] {
  const recent = configs.flatMap(transcripts).sort((x, y) => y.mtime - x.mtime).slice(0, LIMIT)
  return recent.map((f) => infoOf(f, now)).sort((x, y) => Number(y.isLive) - Number(x.isLive) || y.lastAt - x.lastAt)
}
```

Hinweis: `basename` mit `/`- und `\`-Pfaden — unter Windows trennt `node:path` beide. Bricht der Test „project 'wt'“ unter POSIX mit `C:/work/wt`, `cwd.split(/[\\/]/).filter(Boolean).pop()` statt `basename` nehmen.

- [ ] **Step 5: Grün** — Run: `node --test spec/sessions.spec.ts` → PASS; `npm test` → 100 % für `cli/sessions.ts` (fehlt ein Zweig, etwa der `catch` in `edges`, einen Test mit einer Datei ergänzen, die zwischen `statSync` und Lesen verschwindet, oder `transcripts` eine Datei geben, die ein Ordner mit `.jsonl`-Endung ist); `npm run typecheck` → exit 0.

- [ ] **Step 6: Commit** — Nachricht: „List the recent sessions of every config folder for the panel's picker“.

---

### Task 2: Modus `--list` in `cli/summarize.ts`

**Files:**
- Modify: `cli/summarize.ts`
- Test: `spec/summarize.spec.ts`

**Interfaces:**
- Consumes: `listSessions(configs, now)`, `configsOf(home, own)` aus Task 1.
- Produces: Aufruf `node summarize.ts --list --home <dir> --config <dir>` druckt `JSON.stringify(SessionInfo[]) + '\n'`, Exit 0; fehlt `--home` oder `--config`, Exit 2 mit USAGE.

- [ ] **Step 1: Tests** — in `spec/summarize.spec.ts` anhängen:

```ts
test('lists the sessions of the own and the other config folders with --list', () => {
  const w = world()
  lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  const other = join(w.home, '.claude-b')
  mkdirSync(join(other, 'projects', 'C--x'), { recursive: true })
  writeFileSync(join(other, 'projects', 'C--x', 's2.jsonl'), JSON.stringify({ type: 'custom-title', customTitle: 'Zweites Konto' }) + '\n')
  let out = ''
  const code = main(['--list', '--home', w.home, '--config', w.config], (s) => (out += s), () => {})
  assert.equal(code, 0)
  const list = JSON.parse(out) as { id: string; title: string }[]
  assert.deepEqual(list.map((s) => s.id).sort(), ['s1', 's2'])
  assert.equal(list.find((s) => s.id === 's2')?.title, 'Zweites Konto')
})

test('refuses --list without a home or a config', () => {
  let err = ''
  assert.equal(main(['--list', '--home', 'h'], () => {}, (s) => (err += s)), 2)
  assert.equal(main(['--list', '--config', 'c'], () => {}, () => {}), 2)
  assert.match(err, /--list --home/)
})
```

- [ ] **Step 2: Rot** — Run: `node --test spec/summarize.spec.ts` → FAIL (unbekannte Option `--list`, Exit 2).

- [ ] **Step 3: Umsetzung** — in `cli/summarize.ts`:

Import ergänzen:

```ts
import { configsOf, listSessions } from './sessions.ts'
```

`USAGE` ersetzen:

```ts
const USAGE =
  'usage: summarize.ts --session <id> --cwd <dir> --config <dir> --cache <file>\n' +
  '       summarize.ts --list --home <dir> --config <dir>\n'
```

In `main` die Optionen um `list: { type: 'boolean' }` und `home: { type: 'string' }` erweitern, `values` als `Partial<Options> & { list?: boolean; home?: string }` typisieren, und direkt nach dem `parseArgs`-Block:

```ts
  if (values.list) {
    if (!values.home || !values.config) {
      fail(USAGE)
      return 2
    }
    write(JSON.stringify(listSessions(configsOf(values.home, values.config), Date.now())) + '\n')
    return 0
  }
```

- [ ] **Step 4: Grün** — Run: `npm test` → PASS, 100 %; `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit** — Nachricht: „Print the session list with summarize --list“.

---

### Task 3: Anzeige-Daten (`hooks/view.ts`)

**Files:**
- Modify: `hooks/view.ts`
- Test: `spec/view.spec.ts`

**Interfaces:**
- Consumes: `SessionInfo` aus `shared/summary.ts`.
- Produces:
  - `export const OWN = ''` — Wert der Auswahl „Diese Sitzung“.
  - `export function sessionsOf(r: { exitCode: number; stdout: string }): SessionInfo[] | null` — `null` bei Fehler oder falschen Typen.
  - `export function sessionLabel(s: SessionInfo, now: number): string`
  - `export function listArgs(script: string, home: string, config: string): string[]`
  - `dirsOf` liefert zusätzlich `home: string`.
  - `ViewInput.foreign: { title: string; isLive: boolean } | null`; `View.subtitle: string`.

- [ ] **Step 1: Tests** — in `spec/view.spec.ts`: Import um `sessionsOf, sessionLabel, listArgs, OWN` erweitern, `input()` um `foreign: null` in der Vorgabe ergänzen (`{ summary, live: [], reportedCostUsd: null, costIncludesAgents: true, now: 10 * MIN, error: '', foreign: null, ...p }`), den Test „dirsOf …“ auf `{ home, config, tmp }` umstellen:

```ts
  assert.deepEqual(dirsOf({ USERPROFILE: 'U', HOME: 'H', TEMP: 'T', TMPDIR: 'D' }), { home: 'U', config: 'U/.claude', tmp: 'T' })
  assert.deepEqual(dirsOf({ HOME: 'H', TMPDIR: 'D' }), { home: 'H', config: 'H/.claude', tmp: 'D' })
  assert.deepEqual(dirsOf({}), { home: '', config: '/.claude', tmp: '/tmp' })
```

und den Test zu `CLAUDE_CONFIG_DIR` entsprechend (`home: 'U'` ergänzen). Dann anhängen:

```ts
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
  const long = sessionLabel(info({ title: `a${'\u001b'}[31m${'x'.repeat(10_000)}` }), now)
  assert.doesNotMatch(long, /\u001b/)
  assert.ok(long.length < 120)
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
  const idle = buildView(input(s, { foreign: { title: 'Agent-team fortsetzen', isLive: false }, reportedCostUsd: null }))
  assert.equal(idle.title, 'Sitzung: Agent-team fortsetzen')
  assert.equal(idle.subtitle, 'nur aus dem Transkript')
  assert.equal(idle.groups.find((g) => g.key === 'lead')?.rows[0]?.glyph, '✓')
  assert.ok(idle.notices.every((n) => !n.includes('Preistabelle')))
  const busy = buildView(input(s, { foreign: { title: 'x', isLive: true } }))
  assert.equal(busy.groups.find((g) => g.key === 'lead')?.rows[0]?.glyph, '●')
  assert.equal(buildView(input(s)).subtitle, '')
})
```

`SessionInfo` aus `../shared/summary.ts` mit importieren.

- [ ] **Step 2: Rot** — Run: `node --test spec/view.spec.ts` → FAIL (fehlende Exporte).

- [ ] **Step 3: Umsetzung** — in `hooks/view.ts`:

`SessionInfo` importieren; `ViewInput` um `foreign: { title: string; isLive: boolean } | null` erweitern; der `View`-Typ bekommt `subtitle: string` (auch im Rückgabewert für `summary === null`: `subtitle: ''`).

`glyphOf` bekommt `foreign` mitgereicht:

```ts
function glyphOf(a: AgentSummary, live: Map<string, string>, current: string, foreign: ViewInput['foreign']): Glyph {
  // Another session has no live signal; its lead runs while its transcript is fresh.
  if (a.kind === 'lead' && a.sessionId === current) return foreign && !foreign.isLive ? byTranscript(a) : '●'
  if (a.kind === 'lead') return byTranscript(a)
```

(Rest unverändert; Aufruf in `buildView`: `glyphOf(a, live, current, input.foreign)`.)

Titel und Untertitel im Rückgabewert von `buildView`:

```ts
    title: input.foreign ? `Sitzung: ${tidy(input.foreign.title)}` : isTeam ? `Lauf ${s.runId}${gens > 1 ? ` (Gen 1–${gens})` : ''}` : 'Diese Sitzung',
    subtitle: input.foreign ? 'nur aus dem Transkript' : '',
```

Neue Exporte (bei den übrigen Hilfen am Dateiende):

```ts
export const OWN = ''

const ageOf = (ms: number): string => {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return 'gerade eben'
  if (min < 60) return `vor ${min} min`
  if (min < 48 * 60) return `vor ${Math.floor(min / 60)} h`
  return `vor ${Math.floor(min / 1440)} d`
}

// The second account's folder is `.claude-b`: its sessions carry the `b`.
const accountOf = (config: string): string => /[\\/]\.claude-([^\\/]+)[\\/]?$/.exec(config)?.[1] ?? ''

export function sessionLabel(s: SessionInfo, now: number): string {
  const account = accountOf(s.config)
  return `${s.isLive ? '●' : '○'} ${tidy(s.title).slice(0, 60)} · ${tidy(s.project).slice(0, 60)} · ${ageOf(now - s.lastAt)}${account ? ` · ${tidy(account)}` : ''}`
}

const sessionOf = (v: unknown): SessionInfo | null =>
  isRecord(v) && ['id', 'config', 'project', 'title', 'cwd'].every((k) => typeof v[k] === 'string') &&
  typeof v.lastAt === 'number' && typeof v.isLive === 'boolean'
    ? (v as SessionInfo)
    : null

export function sessionsOf(r: { exitCode: number; stdout: string }): SessionInfo[] | null {
  if (r.exitCode !== 0) return null
  try {
    const data: unknown = JSON.parse(r.stdout)
    if (!Array.isArray(data)) return null
    const list = data.map(sessionOf)
    return list.every((s) => s !== null) ? (list as SessionInfo[]) : null
  } catch {
    return null
  }
}

export function listArgs(script: string, home: string, config: string): string[] {
  return ['node', script, '--list', '--home', home, '--config', config]
}
```

`dirsOf` liefert `home` mit:

```ts
export const dirsOf = (env: DirEnv): { home: string; config: string; tmp: string } => {
  const home = env.USERPROFILE ?? env.HOME ?? ''
  return { home, config: env.CLAUDE_CONFIG_DIR || `${home}/.claude`, tmp: env.TEMP ?? env.TMPDIR ?? '/tmp' }
}
```

`tidy` steht schon in `view.ts` (Steuerzeichen, Kappung); falls seine Kappung über 60 liegt, schneidet `slice(0, 60)` nach.

- [ ] **Step 4: Grün** — Run: `npm test` → PASS, 100 % für `hooks/view.ts`; `npm run typecheck` → exit 0 (der Aufruf von `buildView` in `hooks/register.ts` braucht schon jetzt `foreign: null`, sonst meldet `tsc` die fehlende Eigenschaft — dort eintragen).

- [ ] **Step 5: Commit** — Nachricht: „Label, check and show another session in the view data“.

---

### Task 4: Dropdown und Verdrahtung (`hooks/register.ts`)

**Files:**
- Modify: `hooks/register.ts`, `hooks/register.test.ts`, `.claude-plugin/plugin.json`, `README.md` (Repo-Wurzel, Abschnitt Agent-Panel), `docs/.superpowers/specs/2026-10-10-agent-panel-sitzungen-design.md` (nur falls die Umsetzung abweicht)
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `OWN`, `sessionsOf`, `sessionLabel`, `listArgs`, `dirsOf` (mit `home`), `ViewInput.foreign`, `View.subtitle` aus Task 3.

- [ ] **Step 1: Kit-Tests** — in `hooks/register.test.ts`:

Die Funktion `stub` zählt nur Zusammenfassungen; Listenaufrufe gehen in ein eigenes Feld und bekommen eine Liste als Antwort. `stub` um einen Parameter `sessions: object[] = []` und `lists: string[][] = []` erweitern und den `process.run`-Handler ersetzen:

```ts
  on('process.run', async ($, e) => {
    if (e.argv.includes('--list')) {
      lists.push(e.argv)
      return { value: { exitCode: 0, stdout: JSON.stringify(sessions), stderr: '' } }
    }
    runs.push(e.argv)
    return deny ? { deny } : { value: await answer() }
  })
```

Neue Tests anhängen:

```ts
const OTHER = { id: 's2', config: 'C:/Users/u/.claude-b', project: 'repo', title: 'Agent-team fortsetzen', cwd: 'C:/repo', lastAt: 0, isLive: false }

test('the title row offers this and the recent sessions in a Select', async ($, on) => {
  const clock = mock.clock(on)
  const lists: string[][] = []
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [], '', () => false, [OTHER], lists)
  await $.session.start(START)
  expect(lists.length).toBe(0)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  expect(lists[0]).toEqual(['node', expect.stringContaining('/cli/summarize.ts'), '--list', '--home', 'C:/Users/u', '--config', 'C:/Users/u/.claude-b'])
  const ui = await $.ui.mount(WIDE('terminal'))
  const select = await ui.find({ key: 'session' })
  expect(select?.type).toBe('Select')
  const options = select?.props.options as { value: string; label: string }[]
  expect(options[0]).toEqual({ value: '', label: 'Diese Sitzung' })
  expect(options[1]?.label).toMatch(/^○ Agent-team fortsetzen · repo · .* · b$/)
})

test('picking another session summarizes its transcript with its own config and cwd', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [], '', () => false, [OTHER])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('terminal'))
  await ui.select({ key: 'session', value: 's2' })
  await clock.advance(2000)
  const last = runs[runs.length - 1] ?? []
  expect(last.slice(2, 8)).toEqual(['--session', 's2', '--cwd', 'C:/repo', '--config', 'C:/Users/u/.claude-b'])
  expect(await ui.find({ type: 'Text', text: 'Sitzung: Agent-team fortsetzen' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /gemeldet/ })).toBeUndefined()
})

test('a picked session that left the list falls back to this one', async ($, on) => {
  const clock = mock.clock(on)
  let sessions: object[] = [OTHER]
  const runs: string[][] = []
  on('process.run', async ($, e) => {
    if (e.argv.includes('--list')) return { value: { exitCode: 0, stdout: JSON.stringify(sessions), stderr: '' } }
    runs.push(e.argv)
    return { value: { exitCode: 0, stdout: GOOD, stderr: '' } }
  })
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount(WIDE('terminal'))
  await ui.select({ key: 'session', value: 's2' })
  sessions = []
  await clock.advance(10_000)
  await clock.advance(2000)
  expect((runs[runs.length - 1] ?? []).slice(2, 4)).toEqual(['--session', 's1'])
  expect(await ui.find({ type: 'Text', text: 'Diese Sitzung' })).toBeDefined()
})

test('a narrow pane puts the session picker on a row of its own', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [], '', () => false, [OTHER])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const head = async () => JSON.stringify((await ui.find({ key: 'title-row' }))?.children ?? [])
  let ui = await $.ui.mount(NARROW('terminal'))
  expect(await head()).not.toContain('"session"')
  expect(await ui.find({ key: 'session' })).toBeDefined()
  await ui.unmount()
  ui = await $.ui.mount(WIDE('terminal'))
  expect(await head()).toContain('"session"')
})
```

Der zweite `process.run`-Handler im dritten Test steht vor `stub`: der zuerst registrierte antwortet. Fängt das Kit doppelte Registrierungen anders, den Test mit einem `stub`-Parameter für eine veränderliche Liste schreiben (`sessions` als Funktion `() => object[]`). Den Namen der Kit-Methode für eine Auswahl (`ui.select`) in `.claude-plugin/types/claude-code/index.d.ts` nachsehen (`grep -n "select:" … | grep -i mount`) und angleichen.

- [ ] **Step 2: Rot** — Run: `npm run kit` → die vier neuen Tests FAIL.

- [ ] **Step 3: Umsetzung** — in `hooks/register.ts`:

Zustand:

```ts
let sessions: SessionInfo[] = []
let picked = OWN
let lastList = Number.NEGATIVE_INFINITY
const LIST_MS = 10_000
```

In `refresh`, nach `dirsOf` (das jetzt `home` liefert) und vor dem Zusammenfassen:

```ts
    const now = await $.clock.now()
    if (now - lastList >= LIST_MS) {
      lastList = now
      const list = sessionsOf(await $.process.run(listArgs(`${$.plugin.root}/cli/summarize.ts`, home, config), { timeoutMs: 20_000 }))
      if (list) sessions = list.filter((s) => s.id !== session)
    }
    const other = picked === OWN ? undefined : sessions.find((s) => s.id === picked)
    if (picked !== OWN && !other) picked = OWN
    const argv = other
      ? scriptArgs(`${$.plugin.root}/cli/summarize.ts`, other.id, other.cwd || cwd, other.config, tmp)
      : scriptArgs(`${$.plugin.root}/cli/summarize.ts`, session, cwd, config, tmp)
```

`live` und `reported` nur für die eigene Sitzung:

```ts
    live = other ? [] : (await $.agent.list()).map((a) => ({ id: a.id, status: a.status }))
    reported = other ? null : reportedCost((await $.session.usage()).cost)
```

Beim Öffnen (`openPane`) `lastList = Number.NEGATIVE_INFINITY` setzen, damit die Liste sofort lädt.

In `ui.render` den `buildView`-Aufruf um `foreign` ergänzen:

```ts
    const other = picked === OWN ? undefined : sessions.find((s) => s.id === picked)
    v = buildView({ summary, live, reportedCostUsd: reported, costIncludesAgents: REPORTED_COST_INCLUDES_AGENTS, now: await $.clock.now(), error, foreign: other ? { title: other.title, isLive: other.isLive } : null })
```

Die Titelzeile (heute `Text({ bold: true, wrap: 'truncate-end', children: [v.title] })` im grafischen Baum) ersetzen:

```ts
      // The picker sits beside the title in a wide pane, on a row of its own in a narrow one.
      const picker = $.ui.resolve(e).Select({
        key: 'session',
        value: picked,
        options: [{ value: OWN, label: 'Diese Sitzung' }, ...sessions.map((s) => ({ value: s.id, label: sessionLabel(s, now) }))],
        onSelect: (value) => { picked = value; lastList = Number.NEGATIVE_INFINITY; void refresh($) },
      })
      const titleRow = Box({ key: 'title-row', flexDirection: 'row', justifyContent: 'space-between', columnGap: 2, children: [
        Text({ bold: true, wrap: 'truncate-end', children: [v.title] }),
        ...(isWide ? [picker] : []),
      ] })
```

und im Rückgabebaum an der Stelle des alten Titels:

```ts
        titleRow,
        ...(isWide ? [] : [picker]),
        ...(v.subtitle ? [Text({ dimColor: true, children: [v.subtitle] })] : []),
```

`now` ist der Wert aus `await $.clock.now()` von oben; `refresh` muss im Gültigkeitsbereich von `register` erreichbar sein (ist es). Die Textfassung (`textTree`) zeigt `v.subtitle` als gedimmte Zeile unter dem Titel; ein `Select` braucht sie nicht.

`.claude-plugin/plugin.json`: `"version": "0.3.0"`.

README, Abschnitt Agent-Panel, nach dem Satz zum Öffnen ergänzen: „Oben rechts wählt ein Dropdown eine der 20 zuletzt aktiven Sitzungen beider Konten (● läuft); das Panel zeigt sie dann aus ihrem Transkript, ohne Live-Werte.“

- [ ] **Step 4: Grün** — Run: `npm test`, `npm run typecheck`, `npm run kit` → alle grün, 100 %.

- [ ] **Step 5: Rauchtest von Hand** — `claude --plugin-dir plugins-src/agent-panel`, `/agent-panel`, Dropdown öffnen: die eigene und andere Sitzungen mit ●/○, eine andere wählen → Titel „Sitzung: …“, „nur aus dem Transkript“, Karten der anderen Sitzung; zurück auf „Diese Sitzung“.

- [ ] **Step 6: Commit** — Nachricht: „Pick another session from a Select in the panel's title row“.
