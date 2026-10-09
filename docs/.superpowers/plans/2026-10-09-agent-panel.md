# Agent-Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Claude-Code-Mod zeigt rechts ein Panel mit Kosten, Tokens, Zeit und Status je gespawntem Agent und in der Summe, über alle Generationen eines Team-Laufs.

**Architecture:** Ein Node-Skript (`cli/summarize.ts`) liest die Transkripte der Sitzung und aller Generationen des Laufs ab einem gecachten Byte-Offset und druckt eine JSON-Zusammenfassung. Der Mod (`hooks/register.ts`) ruft es alle 2 s per `$.process.run`, mischt den Live-Status aus `$.agent.list()` ein und zeichnet, was die reinen Funktionen in `hooks/view.ts` bauen. Der Starter `claude-team.ps1` vergibt die Session-ID des Leads selbst und führt sie in `run.json` unter `sessions`.

**Tech Stack:** TypeScript, ausgeführt von Node ≥ 22.18 ohne Build; Claude-Code-Mods-API; `node --test` mit Coverage-Schwellen; `claude plugin test`/`validate`; PowerShell 7 + Pester 5.

**Spec:** `docs/.superpowers/specs/2026-10-09-agent-panel-design.md`

## Global Constraints

- Plugin-Verzeichnis: `plugins-src/agent-panel/`. Alle Pfade unten ohne führendes `/` sind relativ dazu, außer sie beginnen mit `scripts/`, `docs/`, `settings.json`, `.gitignore`, `.claude-plugin/marketplace.json` oder `README.md` (dann relativ zur Repo-Wurzel).
- `node` ≥ 22.18 im PATH; TypeScript läuft ohne Übersetzung, also `erasableSyntaxOnly`: keine `enum`, keine Parameter-Properties, keine Namespaces. Relative Imports mit `.ts`-Endung.
- `hooks/` spricht nur `$`, kein Node-API. Ein Mod importiert nur relative Dateien im Plugin und `claude-code`; `$` geht nur an Funktionen auf oberster Ebene derselben Datei; Ereignisnamen sind String-Literale; `$` und seine Namensräume nie in Variablen.
- Node-Tests heißen `*.spec.ts` und liegen unter `spec/`; `*.test.ts` ist dem Kit (`claude plugin test`) vorbehalten.
- Coverage 100 % (Zeilen, Zweige, Funktionen) für `cli/**` und `hooks/view.ts`. Ausgeschlossen mit Begründung: `hooks/register.ts` (läuft nur im Mod, das Kit misst keine Coverage; enthält keine Logik) und die drei Einstiegszeilen von `cli/summarize.ts` (laufen nur als Kindprozess, ein Spawn-Test deckt sie ab).
- Kein `any`, kein `@ts-ignore`. `tsc` mit `strict`, `noUncheckedIndexedAccess`.
- Dev-Abhängigkeiten nur `typescript` und `@types/node`.
- Preise: platform.claude.com/docs/en/about-claude/pricing, gelesen am 2026-10-09 (Tabelle in Task 2).
- Code, Code-Kommentare, Bezeichner, Commits englisch; Panel-Texte und Doku deutsch.
- Commits: Nachricht per Datei und `git commit -F`; kein `Co-Authored-By`, keine Werbezeile. Vor jedem Commit Zweig und HEAD lesen.

## Review Focus

1. **Umlaut über die Lesegrenze:** Byte-Offsets bei mehrbyte-UTF-8 dürfen nicht verrutschen, wenn zwischen zwei Durchläufen weitergeschrieben wird → Test in Task 4 („keeps byte offsets right across multibyte text“).
2. **Lead aus einem Unterordner gestartet:** `.team-runs` liegt über dem cwd → `findRun` sucht aufwärts (Task 6, „finds the run from a subfolder“).
3. **Eine Generation ohne Transkript** (Lead startete nie, Datei aufgeräumt) → Zeile in `problems`, die übrigen Generationen zählen weiter (Task 7, „reports a generation without transcript and keeps the rest“).
4. **Skript langsamer als der Takt** → kein zweiter Aufruf, solange einer läuft (Task 10, Kit-Test „a tick while the script still runs starts no second one“).
5. **Transkript ersetzt und kürzer** (`/clear`-artige Neuschrift, Kopie) → von vorn lesen statt Unsinn ab altem Offset (Task 4, „rereads a file that shrank“).

---

## Dateien

| Datei | Verantwortung |
|---|---|
| `.claude-plugin/plugin.json` | Manifest |
| `.claude-plugin/types/` | von Claude Code erzeugte Mod-Typen (eingecheckt) |
| `hooks/hooks.json` | zeigt auf `register.ts` |
| `hooks/register.ts` | Verdrahtung, keine Logik |
| `hooks/register.test.ts` | Kit-Tests der Verdrahtung |
| `hooks/view.ts` | Anzeige, Formatierung, Status, Abgleich, Ergebnis-Parsing |
| `shared/summary.ts` | Typen der Zusammenfassung (nur Typen) |
| `cli/price.ts` | Preistabelle, Kosten je Nachricht |
| `cli/classify.ts` | Rolle und Task-Zeile |
| `cli/transcript.ts` | inkrementelles Lesen einer `.jsonl` |
| `cli/cache.ts` | Cache-Datei laden/speichern |
| `cli/scan.ts` | Lauf, Lead-Transkript, Agent-Dateien finden |
| `cli/summarize.ts` | Einstieg und Zusammenbau |
| `spec/*.spec.ts`, `spec/helpers.ts`, `spec/fixtures/` | Node-Tests |
| `package.json`, `package-lock.json`, `tsconfig.json` | Werkzeuge |
| `.claude-plugin/marketplace.json` (Repo-Wurzel) | lokaler Marketplace |
| `scripts/claude-team.ps1`, `scripts/tests/ClaudeTeam.Tests.ps1` | Session-ID je Generation |
| `scripts/install.ps1`, `scripts/tests/Install.Tests.ps1` | Marketplace registrieren |
| `settings.json`, `scripts/tests/Settings.Tests.ps1` | Plugin einschalten |
| `.gitignore`, `scripts/tests/Gitignore.Tests.ps1` | neue Pfade zulassen |
| `README.md` | Abschnitt „Agent-Panel“ |

---

### Task 1: Plugin-Gerüst, Typen, Werkzeuge

**Files:**
- Create: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`, `package.json`, `tsconfig.json`, `shared/summary.ts`
- Modify: `.gitignore`, `scripts/tests/Gitignore.Tests.ps1`

**Interfaces:**
- Produces: die Typen in `shared/summary.ts` (unten, wörtlich), die alle späteren Tasks nutzen; `.claude-plugin/types/` mit `claude-code/index.d.ts`.

- [ ] **Step 1: Gitignore-Test erweitern (rot)**

In `scripts/tests/Gitignore.Tests.ps1` im Block `'tracks nothing outside the permitted set'` die Listen ersetzen:

```powershell
        $permittedFiles = @('.gitignore', '.gitattributes', 'README.md', 'CLAUDE.md', 'settings.json', 'keybindings.json')
        $permittedRoots = @('skills', 'agents', 'statusline', 'scripts', 'docs', 'plugins-src', '.claude-plugin')
```

Im Context `'configuration is tracked'` die Fälle ergänzen:

```powershell
            @{ Path = 'plugins-src/agent-panel/hooks/register.ts' }
            @{ Path = '.claude-plugin/marketplace.json' }
```

Im Context `'runtime data stays out of the repo'` ergänzen:

```powershell
            @{ Path = 'plugins-src/agent-panel/node_modules/typescript/package.json' }
```

(`.gitattributes` fehlt heute in `$permittedFiles`, ist aber versioniert; der Test war deshalb schon rot.)

- [ ] **Step 2: Test laufen lassen**

Run: `pwsh -NoProfile -Command "Invoke-Pester scripts/tests/Gitignore.Tests.ps1 -Output Detailed"`
Expected: FAIL bei `does not ignore plugins-src/agent-panel/hooks/register.ts` und `.claude-plugin/marketplace.json`.

- [ ] **Step 3: `.gitignore` erweitern**

Nach `!/docs/` einfügen:

```gitignore
!/plugins-src/
!/.claude-plugin/

# Dev tooling of the plugins; package-lock.json pins it.
/plugins-src/*/node_modules/
```

- [ ] **Step 4: Gerüst anlegen**

`plugins-src/agent-panel/.claude-plugin/plugin.json`:

```json
{
  "name": "agent-panel",
  "version": "0.1.0",
  "description": "Side panel with cost, tokens, time and status of every agent the session spawned, across the generations of an agent-team run",
  "author": { "name": "Christoph Wübbels" }
}
```

`plugins-src/agent-panel/hooks/hooks.json`:

```json
{
  "description": "The agent-panel hooks module",
  "modules": ["./register.ts"]
}
```

`plugins-src/agent-panel/hooks/register.ts`:

```ts
import type { Register } from 'claude-code'

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-panel',
      description: 'Show or hide the panel of agents with cost, tokens, time and status',
    })
    return next(e)
  })

  on('command.run', { command: 'agent-panel' }, async () => ({ text: 'agent-panel skeleton' }))
}
```

`plugins-src/agent-panel/shared/summary.ts`:

```ts
export type TokenCounts = {
  input: number
  output: number
  cacheRead: number
  cacheWrite5m: number
  cacheWrite1h: number
}

/** answered: at least one finished answer; error: the last assistant line is an API error; open: neither. */
export type EndState = 'answered' | 'error' | 'open'

export type AgentSummary = {
  /** `lead:<sessionId>` for a lead, else the agent id from the file name `agent-<id>.jsonl`. */
  id: string
  sessionId: string
  kind: 'lead' | 'agent'
  name: string
  role: string
  task: string
  model: string
  tokens: TokenCounts
  costUsd: number
  /** True when some message used a model without a price; costUsd then covers only the priced ones. */
  unpriced: boolean
  firstAt: number | null
  lastAt: number | null
  end: EndState
  errorText: string
}

export type Summary = {
  runId: string | null
  /** Session ids in generation order; a plain session is one generation. */
  generations: string[]
  agents: AgentSummary[]
  unreadableLines: number
  problems: string[]
}
```

- [ ] **Step 5: Typen erzeugen lassen**

Run (Repo-Wurzel): `claude -p "/agent-panel" --plugin-dir plugins-src/agent-panel`
Expected: Ausgabe `agent-panel: agent-panel skeleton`; danach existiert `plugins-src/agent-panel/.claude-plugin/types/claude-code/index.d.ts` und `plugins-src/agent-panel/.claude-plugin/types/tsconfig.json`. Legt Claude Code dabei eine `tsconfig.json` an der Plugin-Wurzel an, wird sie in Step 6 überschrieben.

- [ ] **Step 6: Werkzeuge**

`plugins-src/agent-panel/package.json`:

```json
{
  "name": "agent-panel-dev",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test --experimental-test-coverage --test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100 --test-coverage-include=cli/** --test-coverage-include=hooks/view.ts \"spec/**/*.spec.ts\"",
    "typecheck": "tsc -p .",
    "kit": "claude plugin test .",
    "validate": "claude plugin validate . --strict"
  }
}
```

Run (in `plugins-src/agent-panel`): `npm install -D typescript @types/node`
Expected: `devDependencies` in `package.json`, `package-lock.json` entsteht, `node_modules/` ist von git ignoriert (`git status --short` zeigt es nicht).

`plugins-src/agent-panel/tsconfig.json`:

```json
{
  "extends": "./.claude-plugin/types/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "noUncheckedIndexedAccess": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2023",
    "types": ["node"],
    "skipLibCheck": true
  },
  "include": ["cli", "hooks", "shared", "spec", ".claude-plugin/types"]
}
```

- [ ] **Step 7: Prüfen**

Run (in `plugins-src/agent-panel`): `npm run typecheck`
Expected: exit 0. Meldet `tsc`, dass `claude-code` nicht gefunden wird, die `compilerOptions.paths` aus `.claude-plugin/types/tsconfig.json` lesen und in die eigene `tsconfig.json` übernehmen (sie überschreibt sonst nichts davon), bis exit 0.

Run: `npm run validate`
Expected: `✔ Validation passed`, Zeile `hooks: session.start, command.run{command=agent-panel}`.

Run: `pwsh -NoProfile -Command "Invoke-Pester scripts/tests/Gitignore.Tests.ps1 -Output Detailed"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add .gitignore scripts/tests/Gitignore.Tests.ps1 plugins-src/agent-panel
git commit -F <scratch>/msg.txt
```

Nachricht: `Add the agent-panel plugin skeleton with its generated mod types`

---

### Task 2: Preise

**Files:**
- Create: `cli/price.ts`, `spec/price.spec.ts`

**Interfaces:**
- Consumes: `TokenCounts` aus `shared/summary.ts`
- Produces: `modelKey(model: string): string`, `costOf(model: string, t: TokenCounts): number | null` (USD für **eine** Nachricht; `null` bei unbekanntem Modell)

- [ ] **Step 1: Test schreiben**

`spec/price.spec.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costOf, modelKey } from '../cli/price.ts'
import type { TokenCounts } from '../shared/summary.ts'

const t = (p: Partial<TokenCounts>): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, ...p })
const M = 1_000_000

test('normalizes model ids', () => {
  assert.equal(modelKey('claude-opus-5-5'), 'opus-5-5')
  assert.equal(modelKey('claude-opus-5[1m]'), 'opus-5')
  assert.equal(modelKey('claude-haiku-4-5-20251001'), 'haiku-4-5')
  assert.equal(modelKey('Claude-Sonnet-5-5'), 'sonnet-5-5')
})

test('prices each token kind of Opus 5.5', () => {
  assert.equal(costOf('claude-opus-5-5', t({ input: M })), 4)
  assert.equal(costOf('claude-opus-5-5', t({ output: M })), 20)
  assert.equal(costOf('claude-opus-5-5', t({ cacheRead: M })), 0.2)
  assert.equal(costOf('claude-opus-5-5', t({ cacheWrite5m: M })), 5)
  assert.equal(costOf('claude-opus-5-5', t({ cacheWrite1h: M })), 8)
})

test('knows every current and older model on the pricing page', () => {
  const cases: [string, number][] = [
    ['claude-fable-5-1', 10], ['claude-mythos-5-1', 10], ['claude-fable-5', 10], ['claude-mythos-5', 10],
    ['claude-opus-5', 5], ['claude-opus-4-8', 5], ['claude-opus-4-7', 5], ['claude-opus-4-6', 5], ['claude-opus-4-5', 5],
    ['claude-opus-4-1', 15], ['claude-opus-4', 15],
    ['claude-sonnet-5-5', 2], ['claude-sonnet-5', 2], ['claude-sonnet-4-6', 3], ['claude-sonnet-4-5', 3], ['claude-sonnet-4', 3],
    ['claude-haiku-5-5', 0.1], ['claude-haiku-4-5-20251001', 1], ['claude-haiku-3-5', 0.8],
  ]
  for (const [model, input] of cases) assert.equal(costOf(model, t({ input: M })), input, model)
})

test('uses the reduced cache-read rates of Fable 5.1 and Sonnet 5.5', () => {
  assert.equal(costOf('claude-fable-5-1', t({ cacheRead: M })), 0.25)
  assert.equal(costOf('claude-sonnet-5-5', t({ cacheRead: M })), 0.1)
  assert.equal(costOf('claude-sonnet-5', t({ cacheRead: M })), 0.2)
})

test('bills Haiku 5.5 at the long-prompt rates above 100,000 prompt tokens', () => {
  assert.equal(costOf('claude-haiku-5-5', t({ input: 100_000, output: M })), 0.01 + 0.5)
  assert.equal(costOf('claude-haiku-5-5', t({ input: 60_000, cacheRead: 50_000, output: M })), 0.03 + 0.0025 + 2.5)
})

test('returns null for a model without a price', () => {
  assert.equal(costOf('opus', t({ input: M })), null)
  assert.equal(costOf('<synthetic>', t({})), null)
})
```

- [ ] **Step 2: Rot prüfen**

Run (in `plugins-src/agent-panel`): `node --test spec/price.spec.ts`
Expected: FAIL, `Cannot find module '…/cli/price.ts'`.

- [ ] **Step 3: Implementieren**

`cli/price.ts`:

```ts
import type { TokenCounts } from '../shared/summary.ts'

// USD per million tokens: input, output, cache read, cache write 5m, cache write 1h.
// Source: platform.claude.com/docs/en/about-claude/pricing, read 2026-10-09.
type Rates = readonly [number, number, number, number, number]

const OPUS_4_5_TO_5: Rates = [5, 25, 0.5, 6.25, 10]
const OPUS_4_AND_4_1: Rates = [15, 75, 1.5, 18.75, 30]
const SONNET_4_TO_4_6: Rates = [3, 15, 0.3, 3.75, 6]

const RATES: Record<string, Rates> = {
  'fable-5-1': [10, 50, 0.25, 12.5, 20],
  'mythos-5-1': [10, 50, 0.25, 12.5, 20],
  'fable-5': [10, 50, 1, 12.5, 20],
  'mythos-5': [10, 50, 1, 12.5, 20],
  'opus-5-5': [4, 20, 0.2, 5, 8],
  'opus-5': OPUS_4_5_TO_5,
  'opus-4-8': OPUS_4_5_TO_5,
  'opus-4-7': OPUS_4_5_TO_5,
  'opus-4-6': OPUS_4_5_TO_5,
  'opus-4-5': OPUS_4_5_TO_5,
  'opus-4-1': OPUS_4_AND_4_1,
  'opus-4': OPUS_4_AND_4_1,
  'sonnet-5-5': [2, 10, 0.1, 2.5, 4],
  'sonnet-5': [2, 10, 0.2, 2.5, 4],
  'sonnet-4-6': SONNET_4_TO_4_6,
  'sonnet-4-5': SONNET_4_TO_4_6,
  'sonnet-4': SONNET_4_TO_4_6,
  'haiku-5-5': [0.1, 0.5, 0.01, 0.125, 0.2],
  'haiku-4-5': [1, 5, 0.1, 1.25, 2],
  'haiku-3-5': [0.8, 4, 0.08, 1, 1.6],
}

// Haiku 5.5 bills a whole request at these rates once its prompt exceeds the threshold.
const HAIKU_5_5_LONG: Rates = [0.5, 2.5, 0.05, 0.625, 1]
const HAIKU_LONG_PROMPT = 100_000

export function modelKey(model: string): string {
  return model.toLowerCase().replace(/\[.*\]$/, '').replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

export function costOf(model: string, t: TokenCounts): number | null {
  const key = modelKey(model)
  const base = RATES[key]
  if (!base) return null
  const prompt = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h
  const r = key === 'haiku-5-5' && prompt > HAIKU_LONG_PROMPT ? HAIKU_5_5_LONG : base
  const micro = t.input * r[0] + t.output * r[1] + t.cacheRead * r[2] + t.cacheWrite5m * r[3] + t.cacheWrite1h * r[4]
  return micro / 1e6
}
```

- [ ] **Step 4: Grün prüfen**

Run: `node --test spec/price.spec.ts`
Expected: PASS. Scheitert ein Fließkomma-Vergleich (z. B. `0.0325` gegen `0.03250000000000001`), im Test `assert.ok(Math.abs(a - b) < 1e-9)` statt `assert.equal` nehmen — nicht die Implementierung runden.

- [ ] **Step 5: Commit** — `Price each message by model and token kind`

---

### Task 3: Rolle und Task-Zeile

**Files:**
- Create: `cli/classify.ts`, `spec/classify.spec.ts`

**Interfaces:**
- Produces: `type Meta = { name?: string; description?: string; agentType?: string; customAgentType?: string }`, `roleOf(meta: Meta): string`, `taskOf(name: string): string`

- [ ] **Step 1: Test schreiben**

`spec/classify.spec.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roleOf, taskOf } from '../cli/classify.ts'

test('takes the role from the custom agent type, without a plugin prefix', () => {
  assert.equal(roleOf({ customAgentType: 'implementer-backend', agentType: 'fix-B1' }), 'implementer-backend')
  assert.equal(roleOf({ customAgentType: 'savvy-flow:savvy-light' }), 'savvy-light')
  assert.equal(roleOf({ agentType: 'Explore' }), 'Explore')
  assert.equal(roleOf({}), 'agent')
})

test('turns team names into task lines', () => {
  const cases: [string, string][] = [
    ['impl-T3', 'impl T3'],
    ['fix-B1', 'fix B1'],
    ['fix-B3-4', 'fix B3 #4'],
    ['fix-conflict-T3', 'fix:conflict T3'],
    ['verify-T2-1', 'verify T2 #1'],
    ['verify-rebase-T3', 'verify:rebase T3'],
    ['verify-final-F', 'verify:final F'],
    ['review-code-B2', 'review:code B2'],
    ['review-sec-T1-1', 'review:security T1 #1'],
    ['merge-T3', 'merge T3'],
    ['hunt-R1-P2', 'hunt R1.P2'],
    ['final', 'final'],
    ['cleanup', 'cleanup'],
  ]
  for (const [name, task] of cases) assert.equal(taskOf(name), task, name)
})

test('leaves names that fit no form unchanged', () => {
  for (const name of ['code-review', 'ux', 'hunt', 'hunt-R1', 'verify-T3-x', 'impl-T3-1-2', 'fix-conflict', '']) {
    assert.equal(taskOf(name), name, name)
  }
})
```

- [ ] **Step 2: Rot prüfen** — Run: `node --test spec/classify.spec.ts` → FAIL, Modul fehlt.

- [ ] **Step 3: Implementieren**

`cli/classify.ts`:

```ts
export type Meta = { name?: string; description?: string; agentType?: string; customAgentType?: string }

export function roleOf(meta: Meta): string {
  const raw = meta.customAgentType || meta.agentType || ''
  return raw.replace(/^[^:]*:/, '') || 'agent'
}

// The task title forms of the agent-team spec, section 5, as the orchestrator abbreviates them in names.
const KINDS: Record<string, string> = {
  impl: 'impl',
  fix: 'fix',
  verify: 'verify',
  merge: 'merge',
  'review-code': 'review:code',
  'review-sec': 'review:security',
  final: 'final',
  cleanup: 'cleanup',
}
const NAME = /^(review-code|review-sec|impl|fix|verify|merge|hunt|final|cleanup)(?:-(.+))?$/
const ROOT = /^(?:[TB]\d+|F)$/

export function taskOf(name: string): string {
  const m = NAME.exec(name)
  if (!m) return name
  const head = m[1] as string
  const rest = m[2]
  if (head === 'hunt') {
    const h = /^R(\d+)-P(\d+)$/.exec(rest ?? '')
    return h ? `hunt R${h[1]}.P${h[2]}` : name
  }
  const kind = KINDS[head] as string
  if (rest === undefined) return kind
  const parts = rest.split('-')
  const at = parts.findIndex((p) => ROOT.test(p))
  if (at < 0) return name
  const after = parts.slice(at + 1)
  if (after.length > 1 || (after.length === 1 && !/^\d+$/.test(after[0] as string))) return name
  const label = [kind, ...parts.slice(0, at)].join(':')
  return `${label} ${parts[at]}${after.length === 1 ? ` #${after[0]}` : ''}`
}
```

- [ ] **Step 4: Grün prüfen** — Run: `node --test spec/classify.spec.ts` → PASS.

- [ ] **Step 5: Commit** — `Classify agents by role and team task`

---

### Task 4: Transkript inkrementell lesen

**Files:**
- Create: `cli/transcript.ts`, `spec/helpers.ts`, `spec/transcript.spec.ts`, `spec/fixtures/teammate.jsonl`

**Interfaces:**
- Consumes: `costOf` (Task 2), `TokenCounts`, `EndState`
- Produces:
  - `type FileState` (Felder unten)
  - `emptyState(): FileState`
  - `applyLines(prev: FileState, text: string): FileState` — `text` sind vollständige Zeilen
  - `readTranscript(path: string, prev: FileState): FileState`
  - `totals(s: FileState): { tokens: TokenCounts; costUsd: number; unpriced: boolean }`
  - `endOf(s: FileState): EndState`
  - aus `spec/helpers.ts`: `tempDir(): string`, `assistant(o: LineOpts): string`, `apiError(text: string, at?: string): string`, `user(at?: string): string`

- [ ] **Step 1: Fixture aus dem echten e2e-Lauf erzeugen**

Skript im Scratchpad, `strip.mjs`:

```js
// Keeps only what the panel reads: line kind, time, error flag, message id, model, stop reason, usage.
import { readFileSync, writeFileSync } from 'node:fs'
const [src, dst] = process.argv.slice(2)
const out = readFileSync(src, 'utf8').split('\n').filter(Boolean).map((raw) => {
  const o = JSON.parse(raw)
  const m = o.message
  const message = m && o.type === 'assistant'
    ? { id: m.id, model: m.model, stop_reason: m.stop_reason, usage: m.usage, content: o.isApiErrorMessage ? m.content : [] }
    : undefined
  return JSON.stringify({ type: o.type, timestamp: o.timestamp, isApiErrorMessage: o.isApiErrorMessage, message })
})
writeFileSync(dst, out.join('\n') + '\n')
```

Run: `node <scratch>/strip.mjs "$HOME/.claude/projects/C--Users-micro-AppData-Local-Temp-claude-C--Users-micro--claude--claude-worktrees-agent-team-fortsetzen-ea0e29-4d54801e-5953-493c-8e72-2505eec8b27f-scratchpad-e2e-repo/2f6c9657-f9e1-44ba-b005-12dd24346526/subagents/agent-afix-B1-f1341b8579c70ddf.jsonl" spec/fixtures/teammate.jsonl`

Erwartete Werte, am 2026-10-09 mit einem unabhängigen Zählskript (letzte Zeile je `message.id`) ermittelt: 143 Zeilen, 31 Nachrichten, Modell `claude-sonnet-5-5`, Tokens `input 68, output 3517, cacheRead 1430684, cacheWrite5m 163348, cacheWrite1h 0`, `firstAt 1791548983015`, `lastAt 1791549963815`, Kosten `0.5867444` USD, drei `end_turn`. Fehlt die Quelle, ein anderes Teammate-Transkript nehmen und die Zahlen mit diesem Zählskript neu bestimmen (im Scratchpad als `expect.js`):

```js
const fs = require('fs')
const lines = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map(JSON.parse)
const byId = new Map(); let n = 0, first = null, last = null
for (const o of lines) {
  const at = Date.parse(o.timestamp ?? ''); if (!Number.isNaN(at)) { first = first ?? at; last = at }
  if (o.type !== 'assistant' || !o.message?.usage || o.message.model === '<synthetic>' || o.isApiErrorMessage) continue
  byId.set(o.message.id ?? `anon${n++}`, o.message)
}
const t = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }
for (const m of byId.values()) { const u = m.usage, c = u.cache_creation
  t.input += u.input_tokens ?? 0; t.output += u.output_tokens ?? 0; t.cacheRead += u.cache_read_input_tokens ?? 0
  t.cacheWrite5m += c ? c.ephemeral_5m_input_tokens ?? 0 : u.cache_creation_input_tokens ?? 0
  t.cacheWrite1h += c ? c.ephemeral_1h_input_tokens ?? 0 : 0 }
console.log(JSON.stringify({ messages: byId.size, lines: lines.length, t, first, last }))
```

- [ ] **Step 2: Hilfen und Test schreiben**

`spec/helpers.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'agent-panel-'))
}

export type LineOpts = {
  id?: string
  model?: string
  usage?: Record<string, unknown>
  at?: string
  stop?: string | null
}

const AT = '2026-10-09T10:00:00.000Z'

export function assistant(o: LineOpts): string {
  const message = {
    id: o.id,
    model: o.model ?? 'claude-opus-5-5',
    stop_reason: o.stop === undefined ? 'end_turn' : o.stop,
    usage: o.usage ?? { input_tokens: 10, output_tokens: 20 },
  }
  return JSON.stringify({ type: 'assistant', timestamp: o.at ?? AT, message }) + '\n'
}

export function apiError(text: string, at = AT): string {
  const message = { id: 'e1', model: '<synthetic>', stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text }] }
  return JSON.stringify({ type: 'assistant', isApiErrorMessage: true, timestamp: at, message }) + '\n'
}

export function user(at = AT): string {
  return JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: 'x' } }) + '\n'
}
```

`spec/transcript.spec.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyLines, emptyState, endOf, readTranscript, totals } from '../cli/transcript.ts'
import { apiError, assistant, tempDir, user } from './helpers.ts'

const read = (text: string) => applyLines(emptyState(), text)

test('counts only the last line of a streamed message', () => {
  const s = read(
    assistant({ id: 'm1', stop: null, usage: { input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 100 } }) +
      assistant({ id: 'm1', stop: 'tool_use', usage: { input_tokens: 2, output_tokens: 234, cache_read_input_tokens: 100 } }),
  )
  assert.deepEqual(totals(s).tokens, { input: 2, output: 234, cacheRead: 100, cacheWrite5m: 0, cacheWrite1h: 0 })
})

test('adds distinct messages and lines without an id', () => {
  const s = read(assistant({ id: 'm1' }) + assistant({ id: 'm2' }) + assistant({}) + assistant({}))
  assert.equal(totals(s).tokens.output, 80)
})

test('splits cache writes by duration, and counts an undivided write as five minutes', () => {
  const s = read(
    assistant({ id: 'a', usage: { cache_creation_input_tokens: 30, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 } } }) +
      assistant({ id: 'b', usage: { cache_creation_input_tokens: 7 } }) +
      assistant({ id: 'c', usage: { cache_creation: {} } }),
  )
  assert.deepEqual(totals(s).tokens, { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 17, cacheWrite1h: 20 })
})

test('prices each message by its own model and flags an unpriced one', () => {
  const s = read(
    assistant({ id: 'a', model: 'claude-opus-5-5', usage: { output_tokens: 1_000_000 } }) +
      assistant({ id: 'b', model: 'opus' }) +
      assistant({ id: 'c', usage: { output_tokens: 0 } }),
  )
  const t = totals(s)
  assert.equal(t.costUsd, 20)
  assert.equal(t.unpriced, true)
  assert.equal(t.tokens.output, 1_000_020)
})

test('flags an unpriced message that is still streaming', () => {
  assert.equal(totals(read(assistant({ id: 'a', model: 'opus' }))).unpriced, true)
  assert.equal(totals(read(assistant({ id: 'a' }))).unpriced, false)
})

test('ignores synthetic lines and assistant lines without a message', () => {
  const s = read(assistant({ id: 'a' }) + assistant({ id: 's', model: '<synthetic>' }) + JSON.stringify({ type: 'assistant' }) + '\n')
  assert.equal(totals(s).tokens.output, 20)
  assert.equal(s.model, 'claude-opus-5-5')
})

test('is answered once any message ended its turn', () => {
  assert.equal(endOf(read(assistant({ id: 'a', stop: 'tool_use' }))), 'open')
  assert.equal(endOf(read(assistant({ id: 'a' }) + user() + assistant({ id: 'b', stop: null }) + user())), 'answered')
})

test('is an error while the last assistant line is an API error, with its text', () => {
  const s = read(assistant({ id: 'a' }) + apiError("You've hit your session limit · resets 10:50pm"))
  assert.equal(endOf(s), 'error')
  assert.equal(s.errorText, "You've hit your session limit · resets 10:50pm")
  assert.equal(endOf(applyLines(s, assistant({ id: 'b' }))), 'answered')
})

test('keeps the error text short and copes with an error without text', () => {
  assert.equal(read(apiError('x'.repeat(200))).errorText.length, 80)
  const bare = JSON.stringify({ type: 'assistant', isApiErrorMessage: true, message: { content: 'not a list' } }) + '\n'
  assert.equal(read(bare).errorText, 'API-Fehler')
  const noText = JSON.stringify({ type: 'assistant', isApiErrorMessage: true, message: { content: [null, 'x', { type: 'image' }] } }) + '\n'
  assert.equal(read(noText).errorText, 'API-Fehler')
})

test('tracks first and last time and skips lines without a valid time', () => {
  const s = read(user('2026-10-09T10:00:00.000Z') + JSON.stringify({ type: 'system', timestamp: 'nonsense' }) + '\n' + assistant({ id: 'a', at: '2026-10-09T10:05:00.000Z' }))
  assert.equal(s.firstAt, Date.parse('2026-10-09T10:00:00.000Z'))
  assert.equal(s.lastAt, Date.parse('2026-10-09T10:05:00.000Z'))
})

test('counts unreadable lines and reads on', () => {
  const s = read('{"type":\n' + '\n' + assistant({ id: 'a' }))
  assert.equal(s.unreadable, 1)
  assert.equal(totals(s).tokens.output, 20)
})

test('reads only new bytes, and leaves a half-written last line for later', () => {
  const dir = tempDir()
  const file = join(dir, 't.jsonl')
  const second = assistant({ id: 'm2' })
  writeFileSync(file, assistant({ id: 'm1' }) + second.slice(0, 15))
  const s1 = readTranscript(file, emptyState())
  assert.equal(totals(s1).tokens.output, 20)
  appendFileSync(file, second.slice(15))
  const s2 = readTranscript(file, s1)
  assert.equal(totals(s2).tokens.output, 40)
  assert.equal(readTranscript(file, s2), s2)
})

test('replaces a message whose lines span two reads', () => {
  const dir = tempDir()
  const file = join(dir, 't.jsonl')
  writeFileSync(file, assistant({ id: 'm1', stop: null, usage: { output_tokens: 5 } }))
  const s1 = readTranscript(file, emptyState())
  appendFileSync(file, assistant({ id: 'm1', usage: { output_tokens: 234 } }))
  assert.equal(totals(readTranscript(file, s1)).tokens.output, 234)
})

test('keeps byte offsets right across multibyte text', () => {
  const dir = tempDir()
  const file = join(dir, 't.jsonl')
  const umlaut = JSON.stringify({ type: 'user', timestamp: '2026-10-09T10:00:00.000Z', message: { content: 'Prüfung über Größe' } }) + '\n'
  writeFileSync(file, umlaut + assistant({ id: 'a' }))
  const s1 = readTranscript(file, emptyState())
  appendFileSync(file, umlaut + assistant({ id: 'b' }))
  const s2 = readTranscript(file, s1)
  assert.equal(s2.unreadable, 0)
  assert.equal(totals(s2).tokens.output, 40)
})

test('rereads a file that shrank', () => {
  const dir = tempDir()
  const file = join(dir, 't.jsonl')
  writeFileSync(file, assistant({ id: 'a' }) + assistant({ id: 'b' }))
  const s1 = readTranscript(file, emptyState())
  writeFileSync(file, assistant({ id: 'c', usage: { output_tokens: 1 } }))
  assert.equal(totals(readTranscript(file, s1)).tokens.output, 1)
})

test('reads a file without any complete line as nothing yet', () => {
  const dir = tempDir()
  const file = join(dir, 't.jsonl')
  writeFileSync(file, '{"type":"assis')
  const s = readTranscript(file, emptyState())
  assert.equal(s.offset, 0)
  assert.equal(totals(s).tokens.output, 0)
})

test('matches the independent tally of a real teammate transcript', () => {
  const s = readTranscript(join(import.meta.dirname, 'fixtures', 'teammate.jsonl'), emptyState())
  const t = totals(s)
  assert.deepEqual(t.tokens, { input: 68, output: 3517, cacheRead: 1430684, cacheWrite5m: 163348, cacheWrite1h: 0 })
  assert.ok(Math.abs(t.costUsd - 0.5867444) < 1e-9)
  assert.equal(s.model, 'claude-sonnet-5-5')
  assert.equal(s.firstAt, 1791548983015)
  assert.equal(s.lastAt, 1791549963815)
  assert.equal(endOf(s), 'answered')
})
```

- [ ] **Step 3: Rot prüfen** — Run: `node --test spec/transcript.spec.ts` → FAIL, Modul fehlt.

- [ ] **Step 4: Implementieren**

`cli/transcript.ts`:

```ts
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs'
import { costOf } from './price.ts'
import type { EndState, TokenCounts } from '../shared/summary.ts'

type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

type Line = {
  type?: string
  timestamp?: string
  isApiErrorMessage?: boolean
  message?: { id?: string; model?: string; stop_reason?: string | null; usage?: Usage; content?: unknown }
}

type Pending = { id: string; model: string; tokens: TokenCounts }

export type FileState = {
  /** Bytes consumed, always just after a newline. */
  offset: number
  done: TokenCounts
  doneCost: number
  unpriced: boolean
  /** The newest message: later lines with its id replace it, a new id settles it into done. */
  pending: Pending | null
  model: string
  firstAt: number | null
  lastAt: number | null
  hasAnswer: boolean
  errorText: string
  unreadable: number
}

const zero = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })

const add = (a: TokenCounts, b: TokenCounts): TokenCounts => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
  cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
})

export function emptyState(): FileState {
  return { offset: 0, done: zero(), doneCost: 0, unpriced: false, pending: null, model: '', firstAt: null, lastAt: null, hasAnswer: false, errorText: '', unreadable: 0 }
}

function tokensOf(u: Usage): TokenCounts {
  const c = u.cache_creation
  return {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite5m: c ? (c.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0),
    cacheWrite1h: c ? (c.ephemeral_1h_input_tokens ?? 0) : 0,
  }
}

function settle(s: FileState): FileState {
  if (!s.pending) return s
  const cost = costOf(s.pending.model, s.pending.tokens)
  return { ...s, done: add(s.done, s.pending.tokens), doneCost: s.doneCost + (cost ?? 0), unpriced: s.unpriced || cost === null, pending: null }
}

function firstText(content: unknown): string {
  if (!Array.isArray(content)) return 'API-Fehler'
  const block = content.find((b): b is { text: string } => typeof b === 'object' && b !== null && typeof (b as { text?: unknown }).text === 'string')
  return block ? block.text.slice(0, 80) : 'API-Fehler'
}

function applyAssistant(s: FileState, line: Line): FileState {
  const msg = line.message ?? {}
  if (line.isApiErrorMessage) return { ...s, errorText: firstText(msg.content) }
  const hasAnswer = s.hasAnswer || msg.stop_reason === 'end_turn'
  const model = msg.model ?? ''
  if (!msg.usage || model === '<synthetic>') return { ...s, hasAnswer, errorText: '' }
  const id = msg.id ?? ''
  const next: Pending = { id, model, tokens: tokensOf(msg.usage) }
  const base = s.pending && id !== '' && s.pending.id === id ? s : settle(s)
  return { ...base, pending: next, model, hasAnswer, errorText: '' }
}

export function applyLines(prev: FileState, text: string): FileState {
  let s = prev
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    let line: Line
    try {
      line = JSON.parse(raw) as Line
    } catch {
      s = { ...s, unreadable: s.unreadable + 1 }
      continue
    }
    const at = Date.parse(line.timestamp ?? '')
    if (!Number.isNaN(at)) s = { ...s, firstAt: s.firstAt ?? at, lastAt: at }
    if (line.type === 'assistant') s = applyAssistant(s, line)
  }
  return s
}

export function readTranscript(path: string, prev: FileState): FileState {
  // POSIX opens a directory and reports size 0, which would read as an empty transcript.
  if (statSync(path).isDirectory()) throw new Error('ist ein Ordner')
  const fd = openSync(path, 'r')
  try {
    const size = fstatSync(fd).size
    const shrunk = size < prev.offset
    const base = shrunk ? emptyState() : prev
    if (size === base.offset) return base
    const buf = Buffer.alloc(size - base.offset)
    readSync(fd, buf, 0, buf.length, base.offset)
    const end = buf.lastIndexOf(0x0a)
    if (end < 0) return base
    const next = applyLines(base, buf.subarray(0, end + 1).toString('utf8'))
    return { ...next, offset: base.offset + end + 1 }
  } finally {
    closeSync(fd)
  }
}

export function totals(s: FileState): { tokens: TokenCounts; costUsd: number; unpriced: boolean } {
  if (!s.pending) return { tokens: s.done, costUsd: s.doneCost, unpriced: s.unpriced }
  const cost = costOf(s.pending.model, s.pending.tokens)
  return { tokens: add(s.done, s.pending.tokens), costUsd: s.doneCost + (cost ?? 0), unpriced: s.unpriced || cost === null }
}

export function endOf(s: FileState): EndState {
  if (s.errorText !== '') return 'error'
  return s.hasAnswer ? 'answered' : 'open'
}
```

- [ ] **Step 5: Grün prüfen** — Run: `node --test spec/transcript.spec.ts` → PASS.

Run: `npm test`
Expected: PASS, Coverage-Bericht ohne Fehlschlag für `cli/price.ts`, `cli/classify.ts`, `cli/transcript.ts` (alle 100 %). Fehlt ein Zweig, einen Test ergänzen, der ihn trifft — nicht die Schwelle senken.

- [ ] **Step 6: Commit** — `Read transcripts from a byte offset, counting each message once`

---

### Task 5: Cache-Datei

**Files:**
- Create: `cli/cache.ts`, `spec/cache.spec.ts`

**Interfaces:**
- Consumes: `FileState` (Task 4), `Meta` (Task 3)
- Produces: `type Cache = { version: 1; files: Record<string, FileState>; metas: Record<string, Meta>; leads: Record<string, string> }`, `emptyCache(): Cache`, `loadCache(path: string): Cache`, `saveCache(path: string, cache: Cache): void`

- [ ] **Step 1: Test schreiben**

`spec/cache.spec.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyCache, loadCache, saveCache } from '../cli/cache.ts'
import { emptyState } from '../cli/transcript.ts'
import { tempDir } from './helpers.ts'

test('starts empty when the file is missing, unreadable or of another version', () => {
  const dir = tempDir()
  assert.deepEqual(loadCache(join(dir, 'none.json')), emptyCache())
  writeFileSync(join(dir, 'bad.json'), '{')
  assert.deepEqual(loadCache(join(dir, 'bad.json')), emptyCache())
  writeFileSync(join(dir, 'old.json'), JSON.stringify({ version: 0, files: {}, metas: {}, leads: {} }))
  assert.deepEqual(loadCache(join(dir, 'old.json')), emptyCache())
  writeFileSync(join(dir, 'part.json'), JSON.stringify({ version: 1, files: {} }))
  assert.deepEqual(loadCache(join(dir, 'part.json')), emptyCache())
  writeFileSync(join(dir, 'noleads.json'), JSON.stringify({ version: 1, files: {}, metas: {} }))
  assert.deepEqual(loadCache(join(dir, 'noleads.json')), emptyCache())
})

test('saves into a new folder and loads back what it saved, leaving no temp file', () => {
  const dir = join(tempDir(), 'agent-panel')
  const path = join(dir, 's1.json')
  const cache = { ...emptyCache(), files: { 'a.jsonl': emptyState() }, metas: { 'a.meta.json': { name: 'impl-T1' } }, leads: { s1: 'lead.jsonl' } }
  saveCache(path, cache)
  assert.deepEqual(loadCache(path), cache)
  assert.deepEqual(readdirSync(dir), ['s1.json'])
})
```

- [ ] **Step 2: Rot prüfen** — Run: `node --test spec/cache.spec.ts` → FAIL.

- [ ] **Step 3: Implementieren**

`cli/cache.ts`:

```ts
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Meta } from './classify.ts'
import type { FileState } from './transcript.ts'

export type Cache = {
  version: 1
  files: Record<string, FileState>
  metas: Record<string, Meta>
  /** Session id to the path of its lead transcript. */
  leads: Record<string, string>
}

export function emptyCache(): Cache {
  return { version: 1, files: {}, metas: {}, leads: {} }
}

export function loadCache(path: string): Cache {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Partial<Cache>
    return data.version === 1 && data.files && data.metas && data.leads ? (data as Cache) : emptyCache()
  } catch {
    return emptyCache()
  }
}

export function saveCache(path: string, cache: Cache): void {
  mkdirSync(dirname(path), { recursive: true })
  // A rename replaces the file whole, so a reader never sees half of it.
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(cache))
  renameSync(tmp, path)
}
```

- [ ] **Step 4: Grün prüfen** — Run: `node --test spec/cache.spec.ts` → PASS.

- [ ] **Step 5: Commit** — `Keep read offsets and partial sums in a cache file per session`

---

### Task 6: Lauf, Lead und Agent-Dateien finden

**Files:**
- Create: `cli/scan.ts`, `spec/scan.spec.ts`

**Interfaces:**
- Produces:
  - `type Run = { runId: string; sessions: string[] }`
  - `findRun(cwd: string, sessionId: string): Run | null`
  - `findLead(projects: string, sessionId: string, known: string | undefined): string | null`
  - `type AgentFile = { id: string; transcript: string; meta: string }`
  - `agentFiles(leadPath: string): AgentFile[]`

- [ ] **Step 1: Test schreiben**

`spec/scan.spec.ts`:

```ts
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
```

- [ ] **Step 2: Rot prüfen** — Run: `node --test spec/scan.spec.ts` → FAIL.

- [ ] **Step 3: Implementieren**

`cli/scan.ts`:

```ts
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
```

- [ ] **Step 4: Grün prüfen** — Run: `node --test spec/scan.spec.ts` → PASS.

- [ ] **Step 5: Commit** — `Find the run, lead transcripts and agent files of a session`

---

### Task 7: Zusammenfassung und Einstieg

**Files:**
- Create: `cli/summarize.ts`, `spec/summarize.spec.ts`

**Interfaces:**
- Consumes: alles aus Tasks 2–6
- Produces:
  - `type Options = { session: string; cwd: string; home: string; cache: string }`
  - `summarize(o: Options): Summary`
  - `main(argv: string[], write: (s: string) => void, fail: (s: string) => void): number`
  - Kommandozeile: `node cli/summarize.ts --session <id> --cwd <dir> --home <dir> --cache <datei>` → eine JSON-Zeile auf stdout, Exit 0; Exit 2 bei falschen Argumenten.

- [ ] **Step 1: Test schreiben**

`spec/summarize.spec.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { main, summarize } from '../cli/summarize.ts'
import type { Summary } from '../shared/summary.ts'
import { apiError, assistant, tempDir } from './helpers.ts'

type World = { home: string; repo: string; cache: string; projects: string }

function world(): World {
  const home = tempDir()
  const repo = tempDir()
  const projects = join(home, '.claude', 'projects')
  return { home, repo, cache: join(tempDir(), 'agent-panel', 's.json'), projects }
}

function lead(w: World, folder: string, session: string, body: string): string {
  mkdirSync(join(w.projects, folder), { recursive: true })
  const path = join(w.projects, folder, `${session}.jsonl`)
  writeFileSync(path, body)
  return path
}

function agent(leadPath: string, id: string, meta: object | string, body: string): void {
  const dir = join(leadPath.replace(/\.jsonl$/, ''), 'subagents')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `agent-${id}.jsonl`), body)
  writeFileSync(join(dir, `agent-${id}.meta.json`), typeof meta === 'string' ? meta : JSON.stringify(meta))
}

function teamRun(w: World, sessions: string[]): void {
  mkdirSync(join(w.repo, '.team-runs', 'r1'), { recursive: true })
  writeFileSync(join(w.repo, '.team-runs', 'r1', 'run.json'), JSON.stringify({ generation: sessions.length, sessions }))
}

const opts = (w: World, session: string) => ({ session, cwd: w.repo, home: w.home, cache: w.cache })

test('summarizes a plain session: the lead and its subagents', () => {
  const w = world()
  const l = lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  agent(l, 'a1', { name: 'probe', agentType: 'Explore' }, assistant({ id: 'x1', model: 'claude-haiku-5-5' }))
  const s = summarize(opts(w, 's1'))
  assert.equal(s.runId, null)
  assert.deepEqual(s.generations, ['s1'])
  assert.deepEqual(s.agents.map((a) => [a.id, a.kind, a.name, a.role, a.task]), [
    ['lead:s1', 'lead', 'Lead', 'lead', ''],
    ['a1', 'agent', 'probe', 'Explore', 'probe'],
  ])
  assert.equal(s.agents[1]?.model, 'claude-haiku-5-5')
  // A second call takes the meta from the cache file.
  assert.deepEqual(summarize(opts(w, 's1')).agents.map((a) => a.name), ['Lead', 'probe'])
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

test('reads only what was added since the last call, and sums unreadable lines', () => {
  const w = world()
  const l = lead(w, 'C--repo', 's1', assistant({ id: 'm1' }) + '{oops\n')
  assert.equal(summarize(opts(w, 's1')).agents[0]?.tokens.output, 20)
  writeFileSync(l, assistant({ id: 'm1' }) + '{oops\n' + assistant({ id: 'm2' }))
  const s = summarize(opts(w, 's1'))
  assert.equal(s.agents[0]?.tokens.output, 40)
  assert.equal(s.unreadableLines, 1)
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

test('main prints one JSON line and returns 0', () => {
  const w = world()
  lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  let out = ''
  const code = main(['--session', 's1', '--cwd', w.repo, '--home', w.home, '--cache', w.cache], (s) => (out += s), () => {})
  assert.equal(code, 0)
  assert.ok(out.endsWith('\n'))
  assert.equal((JSON.parse(out) as Summary).agents.length, 1)
})

test('main reports a failure inside the summary and still returns 0', () => {
  const w = world()
  lead(w, 'C--repo', 's1', assistant({ id: 'm1' }))
  let out = ''
  const blocked = join(tempDir(), 'file-not-dir')
  writeFileSync(blocked, '')
  const code = main(['--session', 's1', '--cwd', w.repo, '--home', w.home, '--cache', join(blocked, 'c.json')], (s) => (out += s), () => {})
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
  const r = spawnSync(process.execPath, [script, '--session', 's1', '--cwd', w.repo, '--home', w.home, '--cache', w.cache], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal((JSON.parse(r.stdout) as Summary).agents[0]?.id, 'lead:s1')
})
```

- [ ] **Step 2: Rot prüfen** — Run: `node --test spec/summarize.spec.ts` → FAIL.

- [ ] **Step 3: Implementieren**

`cli/summarize.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { loadCache, saveCache } from './cache.ts'
import { roleOf, taskOf, type Meta } from './classify.ts'
import { agentFiles, findLead, findRun } from './scan.ts'
import { emptyState, endOf, readTranscript, totals, type FileState } from './transcript.ts'
import type { AgentSummary, Summary } from '../shared/summary.ts'

export type Options = { session: string; cwd: string; home: string; cache: string }

type Source = { id: string; transcript: string; meta: string | null }

function metaOf(path: string, known: Record<string, Meta>): Meta | null {
  const cached = known[path]
  if (cached) return cached
  try {
    const meta = JSON.parse(readFileSync(path, 'utf8')) as Meta
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
        state = readTranscript(src.transcript, cache.files[src.transcript] ?? emptyState())
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
```

- [ ] **Step 4: Grün prüfen**

Run: `node --test spec/summarize.spec.ts` → PASS.
Run: `npm test` → PASS mit 100 % für `cli/**`.
Run: `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit** — `Summarize every generation of a run as one JSON line`

---

### Task 8: Messung — Kosten-Umfang, AgentInfo, Startzeit, Ausgabegrenze

Kein Produktcode; das Ergebnis ist ein Protokoll, auf das Tasks 9 und 10 sich berufen.

**Files:**
- Create: `docs/.superpowers/smoke/2026-10-09-agent-panel-probe.md`
- Wegwerf (Scratchpad, nicht committen): `probe/.claude-plugin/plugin.json`, `probe/hooks/hooks.json`, `probe/hooks/register.js`

**Interfaces:**
- Produces (im Protokoll, je als eigene Zeile `Ergebnis: …`):
  1. `REPORTED_COST_INCLUDES_AGENTS = true|false`
  2. Form von `$.session.usage().cost` (Zahl oder Objekt mit welchem Feld)
  3. Felder eines `AgentInfo` aus `$.agent.list()`, ob `id` gleich dem Stamm von `agent-<id>.jsonl` ist
  4. ob `$.plugin.root` ein Wert oder eine Methode ist (aus `.claude-plugin/types/claude-code/index.d.ts`)
  5. `nodeStartMs`, Länge einer 3-MB-Ausgabe nach `$.process.run`
  6. Dauer von `summarize` kalt und warm auf dem größten lokalen Transkript; daraus `TICK_MS` (2000, wenn warm < 500 ms, sonst das Vierfache der warmen Dauer, auf 500 ms aufgerundet)

- [ ] **Step 1: Probe-Mod anlegen** (Scratchpad `probe/`)

`probe/.claude-plugin/plugin.json`: `{ "name": "agent-panel-probe", "version": "0.0.1", "description": "throwaway probe" }`

`probe/hooks/hooks.json`: `{ "modules": ["./register.js"] }`

`probe/hooks/register.js`:

```js
export function register(on) {
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const t0 = await $.clock.now()
    const version = await $.process.run(['node', '--version'])
    const t1 = await $.clock.now()
    const big = await $.process.run(['node', '-e', 'process.stdout.write("x".repeat(3000000))'])
    const facts = {
      sessionId: await $.session.id(),
      usage: await $.session.usage(),
      agents: await $.agent.list(),
      nodeVersion: version.stdout.trim(),
      nodeStartMs: t1 - t0,
      bigStdoutLength: big.stdout.length,
    }
    await $.fs.write('agent-panel-probe.json', JSON.stringify(facts, null, 2))
    return result
  })
}
```

- [ ] **Step 2: Probelauf** (kostet wenige Cent; in einem leeren Scratch-Ordner `probe-run/` als cwd)

Run: `claude -p --model haiku --plugin-dir <scratch>/probe "Use the Agent tool exactly once: subagent_type general-purpose, model haiku, prompt 'Reply only with: ok'. Then reply only with: done."`
Expected: Ausgabe `done`; `probe-run/agent-panel-probe.json` existiert mit `sessionId`, `usage`, `agents` (ein Eintrag), `nodeVersion` ≥ v22.18.

- [ ] **Step 3: Kosten-Umfang bestimmen**

Run (in `plugins-src/agent-panel`): `node cli/summarize.ts --session <sessionId aus der Probe> --cwd <probe-run> --home "$HOME" --cache <scratch>/probe-cache.json`

Rechnen: `lead` = `costUsd` der Lead-Zeile, `alle` = Summe aller `costUsd`. Gemeldet = Wert aus `usage.cost` (Form notieren). Liegt der gemeldete Wert näher an `alle` als an `lead`, gilt `REPORTED_COST_INCLUDES_AGENTS = true`, sonst `false`. Weicht der nähere Wert um mehr als 10 % ab, das im Protokoll festhalten: dann stimmt die Preistabelle oder die Zählregel nicht, und das ist vor Task 9 zu klären, nicht zu überspielen.

Zusätzlich prüfen: `agents[0].id` aus der Probe gleich dem Stamm der Datei unter `<lead>/subagents/agent-<id>.jsonl`.

- [ ] **Step 4: `$.plugin.root` nachschlagen**

Run: `grep -n -A3 "root" plugins-src/agent-panel/.claude-plugin/types/claude-code/index.d.ts | grep -n -i "plugin" | head`
Notieren, ob `root` als `root: string` (Wert) oder `root(): Promise<string>` (Methode) deklariert ist. Ebenso die Signatur von `process.run` (zweites Argument mit `timeoutMs`?) und von `session.usage` (`cost`-Typ).

- [ ] **Step 5: Laufzeit messen**

Das größte lokale Lead-Transkript finden: `find "$HOME/.claude/projects" -maxdepth 2 -name "*.jsonl" -printf "%s %p\n" | sort -n | tail -1`. Seine Session-ID ist der Dateiname ohne `.jsonl`, sein cwd egal (kein Lauf).

Run zweimal hintereinander mit derselben Cache-Datei:
`time node cli/summarize.ts --session <id> --cwd <scratch> --home "$HOME" --cache <scratch>/big-cache.json > /dev/null`
Erster Lauf = kalt, zweiter = warm. `TICK_MS` nach der Regel oben.

- [ ] **Step 6: Protokoll schreiben und committen**

`docs/.superpowers/smoke/2026-10-09-agent-panel-probe.md`: Datum, Claude-Code-Version (`claude --version`), Befehle, Rohwerte, die sechs `Ergebnis:`-Zeilen. Commit: `Record what the mod API reports for cost, agents and processes`

---

### Task 9: Anzeige bauen (`hooks/view.ts`)

**Files:**
- Create: `hooks/view.ts`, `spec/view.spec.ts`

**Interfaces:**
- Consumes: `Summary`, `AgentSummary`, `TokenCounts` aus `shared/summary.ts`; die Form von `usage().cost` aus dem Protokoll (Task 8, Ergebnis 2)
- Produces:
  - `type LiveAgent = { id: string; status: string }`
  - `type Glyph = '●' | '✓' | '✗' | '⊘'`
  - `type Row = { key: string; glyph: Glyph; label: string; model: string; cost: string; tokens: string; time: string; note: string; detail: string }`
  - `type Group = { key: string; title: string; cost: string; tokens: string; time: string; costUsd: number; isRunning: boolean; rows: Row[] }`
  - `type View = { title: string; totals: string; counts: string; notices: string[]; groups: Group[] }`
  - `type ViewInput = { summary: Summary | null; live: LiveAgent[]; reportedCostUsd: number | null; costIncludesAgents: boolean; now: number; error: string }`
  - `buildView(input: ViewInput): View`
  - `groupLine(g: Group, isCollapsed: boolean): string`, `rowLine(r: Row): string` (ohne Glyphe), `detailLine(r: Row): string`, `glyphColor(g: Glyph): string`
  - `parseResult(r: { exitCode: number; stdout: string; stderr: string }): { summary: Summary | null; error: string }`
  - `startError(err: unknown): string`
  - `reportedCost(cost: unknown): number | null`
  - `scriptArgs(script: string, session: string, cwd: string, home: string, tmp: string): string[]`
  - `fmtCost(usd: number): string`, `fmtTokens(n: number): string`, `fmtTime(ms: number): string`

- [ ] **Step 1: Test schreiben**

`spec/view.spec.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildView, detailLine, fmtCost, fmtTime, fmtTokens, glyphColor, groupLine, parseResult, reportedCost, rowLine, scriptArgs, startError, type ViewInput } from '../hooks/view.ts'
import type { AgentSummary, Summary } from '../shared/summary.ts'

const MIN = 60_000

function agent(p: Partial<AgentSummary>): AgentSummary {
  return {
    id: 'a', sessionId: 's1', kind: 'agent', name: 'impl-T1', role: 'implementer-backend', task: 'impl T1', model: 'claude-sonnet-5-5',
    tokens: { input: 1000, output: 2000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    costUsd: 0.5, unpriced: false, firstAt: 0, lastAt: MIN, end: 'answered', errorText: '', ...p,
  }
}

const lead = (p: Partial<AgentSummary>) => agent({ id: 'lead:s1', kind: 'lead', name: 'Lead', role: 'lead', task: '', model: 'claude-opus-5-5', ...p })

function input(summary: Summary | null, p: Partial<ViewInput> = {}): ViewInput {
  return { summary, live: [], reportedCostUsd: null, costIncludesAgents: true, now: 10 * MIN, error: '', ...p }
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
})

test('lists a plain session flat, under Lead and Agents, by start time', () => {
  const v = buildView(input(plain([lead({}), agent({ id: 'b', name: 'second', firstAt: 5 }), agent({ id: 'a', name: 'first', firstAt: 1 })])))
  assert.equal(v.title, 'Diese Sitzung')
  assert.deepEqual(v.groups.map((g) => g.title), ['Lead', 'Agents'])
  assert.deepEqual(v.groups[1]?.rows.map((r) => r.label), ['first', 'second'])
})

test('takes live status first, then the transcript', () => {
  const v = buildView(input(plain([
    agent({ id: 'p', name: 'p' }), agent({ id: 'w', name: 'w' }), agent({ id: 'c', name: 'c', end: 'open' }),
    agent({ id: 'f', name: 'f' }), agent({ id: 'k', name: 'k' }), agent({ id: 'u', name: 'u' }),
    agent({ id: 'e', name: 'e', end: 'error', errorText: 'rate_limit' }), agent({ id: 'o', name: 'o', end: 'open' }),
  ]), { live: [
    { id: 'p', status: 'pending' }, { id: 'w', status: 'idle' }, { id: 'c', status: 'completed' },
    { id: 'f', status: 'failed' }, { id: 'k', status: 'killed' }, { id: 'u', status: 'something-new' },
  ] }))
  const rows = Object.fromEntries((v.groups[1]?.rows ?? []).map((r) => [r.label, [r.glyph, r.note]]))
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
  assert.equal(v.title, 'Lauf r1 (Gen 1–4)')
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
  assert.deepEqual(buildView(input(null)), { title: 'Agents', totals: 'lade …', counts: '', notices: [], groups: [] })
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
})

test('builds the script call', () => {
  assert.deepEqual(scriptArgs('P/cli/summarize.ts', 's1', 'C:/repo', 'C:/Users/u', 'C:/tmp'), [
    'node', 'P/cli/summarize.ts', '--session', 's1', '--cwd', 'C:/repo', '--home', 'C:/Users/u', '--cache', 'C:/tmp/agent-panel/s1.json',
  ])
})
```

Den Test `reads the reported cost` an das Protokoll (Task 8, Ergebnis 2) anpassen: Die Fälle für die gemessene Form bleiben, `reportedCost` muss sie lesen; die übrigen Fälle sichern die Toleranz und bleiben ebenfalls.

- [ ] **Step 2: Rot prüfen** — Run: `node --test spec/view.spec.ts` → FAIL.

- [ ] **Step 3: Implementieren**

`hooks/view.ts`:

```ts
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
const COST_FIELDS = ['totalUsd', 'usd', 'total_cost_usd'] as const

export function reportedCost(cost: unknown): number | null {
  if (typeof cost === 'number') return Number.isFinite(cost) ? cost : null
  if (typeof cost !== 'object' || cost === null) return null
  const record = cost as Record<string, unknown>
  for (const field of COST_FIELDS) {
    const value = record[field]
    if (typeof value === 'number') return value
  }
  return null
}

export function scriptArgs(script: string, session: string, cwd: string, home: string, tmp: string): string[] {
  return ['node', script, '--session', session, '--cwd', cwd, '--home', home, '--cache', `${tmp}/agent-panel/${session}.json`]
}
```

Nennt das Protokoll für `cost` ein Feld, das nicht in `COST_FIELDS` steht, dieses Feld vorn in `COST_FIELDS` aufnehmen und im Test einen Fall dafür ergänzen.

- [ ] **Step 4: Grün prüfen**

Run: `node --test spec/view.spec.ts` → PASS.
Run: `npm test` → PASS, 100 % auch für `hooks/view.ts`. Bleibt ein Zweig offen (etwa in der Sortierung), einen Testfall dafür schreiben.
Run: `npm run typecheck` → exit 0.

- [ ] **Step 5: Commit** — `Build the panel view from summary, live status and reported cost`

---

### Task 10: Verdrahtung im Mod

**Files:**
- Modify: `hooks/register.ts`
- Create: `hooks/register.test.ts`

**Interfaces:**
- Consumes: aus `hooks/view.ts` `buildView`, `groupLine`, `rowLine`, `glyphColor`, `parseResult`, `startError`, `reportedCost`, `scriptArgs`, `LiveAgent`; `Summary`; aus dem Protokoll (Task 8) `REPORTED_COST_INCLUDES_AGENTS`, `TICK_MS`, die Form von `$.plugin.root`
- Produces: Befehl `/agent-panel`; Pane-ID `agent-panel`

- [ ] **Step 1: Kit-Test schreiben**

`hooks/register.test.ts`:

```ts
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agent-panel',
  component: 'Pane',
  requestId: 'agent-panel',
  viewport: { columns: 160, rows: 40 },
  props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const LEAD = {
  id: 'lead:s1', sessionId: 's1', kind: 'lead', name: 'Lead', role: 'lead', task: '', model: 'claude-opus-5-5',
  tokens: { input: 1000, output: 1000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
  costUsd: 0.024, unpriced: false, firstAt: 0, lastAt: 1000, end: 'answered', errorText: '',
}
const GOOD = JSON.stringify({ runId: null, generations: ['s1'], agents: [LEAD], unreadableLines: 0, problems: [] })

type Run = { exitCode: number; stdout: string; stderr: string }

function stub(
  on: Parameters<Parameters<typeof test>[1]>[1],
  runs: string[][],
  answer: () => Run | Promise<Run>,
  opened: string[],
  closed: string[],
  panes: string[],
  deny = '',
): void {
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', () => ({ value: undefined }))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
  mock.env(on, { USERPROFILE: 'C:/Users/u', TEMP: 'C:/tmp' })
  on('process.run', async ($, e) => {
    runs.push(e.argv)
    return deny ? { deny } : { value: await answer() }
  })
  on('agent.list', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 0, window: 1, percent: 0 }, rateLimits: [], cost: 0.024 } }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    panes.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    panes.splice(panes.indexOf(e.id), 1)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: panes.map((id) => ({ id })) }))
}

const START = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const
const TOGGLE = { command: 'agent-panel', args: '' } as const

test('a session that never opened the panel starts no node', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  await $.session.start(START)
  await clock.advance(10_000)
  expect(runs.length).toBe(0)
})

test('the tick runs the summary script with the session and draws its totals', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  expect(runs[0]?.slice(2, 4)).toEqual(['--session', 's1'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^≈ \$0\.02/ })).toBeDefined()
})

test('a tick while the script still runs starts no second one', async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[][] = []
  stub(on, runs, async () => {
    await clock.sleep(5000)
    return { exitCode: 0, stdout: GOOD, stderr: '' }
  }, [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  await clock.advance(2000)
  expect(runs.length).toBe(1)
})

test('/agent-panel opens the pane, and a second time closes it', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  const closed: string[] = []
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), opened, closed, [])
  await $.session.start(START)
  await $.command.run({ command: 'agent-panel', args: '' })
  await $.command.run({ command: 'agent-panel', args: '' })
  expect(opened).toEqual(['agent-panel'])
  expect(closed).toEqual(['agent-panel'])
})

test('the first spawned agent opens the pane, later ones do not', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), opened, [], [])
  on('agent.spawn', () => ({ agentId: 'a1', model: 'claude-sonnet-5-5' }))
  await $.session.start(START)
  await $.agent.spawn({ subagentType: 'implementer-backend', description: 'one', prompt: 'x', isTeammate: true })
  await $.agent.spawn({ subagentType: 'verifier', description: 'two', prompt: 'x', isTeammate: true })
  expect(opened).toEqual(['agent-panel'])
})

test('a failed script shows as a line and keeps the last good totals', async ($, on) => {
  const clock = mock.clock(on)
  let call = 0
  stub(on, [], () => (++call === 1 ? { exitCode: 0, stdout: GOOD, stderr: '' } : { exitCode: 1, stdout: '', stderr: 'boom' }), [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '⚠ summarize exit 1: boom' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^≈ \$0\.02/ })).toBeDefined()
})

test('a missing node shows as a line', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [], 'spawn node ENOENT')
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^⚠ node nicht gefunden/ })).toBeDefined()
})

test('a group button folds its rows away', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'r-lead:s1' })).toBeDefined()
  await ui.press({ key: 'g-lead' })
  expect(await ui.find({ key: 'r-lead:s1' })).toBeUndefined()
})

test('a row button shows and hides its token breakdown', async ($, on) => {
  const clock = mock.clock(on)
  stub(on, [], () => ({ exitCode: 0, stdout: GOOD, stderr: '' }), [], [], [])
  await $.session.start(START)
  await $.command.run(TOGGLE)
  await clock.advance(2000)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const detail = { type: 'Text', text: /^ {6}in 1k · out 1k · read 0 · write 0\/0$/ } as const
  expect(await ui.find(detail)).toBeUndefined()
  await ui.press({ key: 'r-lead:s1' })
  expect(await ui.find(detail)).toBeDefined()
  await ui.press({ key: 'r-lead:s1' })
  expect(await ui.find(detail)).toBeUndefined()
})
```

- [ ] **Step 2: Rot prüfen**

Run (in `plugins-src/agent-panel`): `npm run kit`
Expected: FAIL — der Skelett-Mod ruft kein Skript, öffnet kein Pane.

- [ ] **Step 3: Implementieren**

`hooks/register.ts` (ersetzt das Skelett; `TICK_MS`, `REPORTED_COST_INCLUDES_AGENTS` und die Schreibweise von `$.plugin.root` nach dem Protokoll aus Task 8 — unten steht die Fassung für `TICK_MS = 2000`, `true` und `root` als Wert):

```ts
import type { EngineInterface, Register } from 'claude-code'
import type { Summary } from '../shared/summary.ts'
import { buildView, detailLine, glyphColor, groupLine, parseResult, reportedCost, rowLine, scriptArgs, startError, type LiveAgent } from './view.ts'

const PANE = 'agent-panel'
// Measured in docs/.superpowers/smoke/2026-10-09-agent-panel-probe.md.
const TICK_MS = 2000
const REPORTED_COST_INCLUDES_AGENTS = true

let summary: Summary | null = null
let error = ''
let live: LiveAgent[] = []
let reported: number | null = null
let isBusy = false
let hasOpened = false
const collapsed = new Set<string>()
const expanded = new Set<string>()

async function refresh($: EngineInterface): Promise<void> {
  // A session that never showed the panel never pays for a node start.
  if (!hasOpened || isBusy) return
  isBusy = true
  try {
    const session = await $.session.id()
    const cwd = await $.session.cwd()
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? ''
    const tmp = (await $.env.get('TEMP')) ?? (await $.env.get('TMPDIR')) ?? '/tmp'
    const argv = scriptArgs(`${$.plugin.root}/cli/summarize.ts`, session, cwd, home, tmp)
    const parsed = parseResult(await $.process.run(argv, { timeoutMs: 20_000 }))
    if (parsed.summary) summary = parsed.summary
    error = parsed.error
    live = (await $.agent.list()).map((a) => ({ id: a.id, status: a.status }))
    reported = reportedCost((await $.session.usage()).cost)
  } catch (err) {
    error = startError(err)
  } finally {
    isBusy = false
  }
  $.ui.invalidate('ui.render')
}

async function openPane($: EngineInterface, byUser: boolean): Promise<void> {
  hasOpened = true
  await $.ui.open(byUser ? { id: PANE, title: 'Agents', focus: true, closeOnEscape: true } : { id: PANE, title: 'Agents' })
  void refresh($)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    $.clock.every(TICK_MS, () => refresh($))
    await $.command.register({
      name: 'agent-panel',
      description: 'Show or hide the panel of agents with cost, tokens, time and status',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'agent-panel' }, async ($) => {
    const isOpen = (await $.ui.panes()).some((p) => p.id === PANE)
    if (isOpen) await $.ui.close({ id: PANE })
    else await openPane($, true)
    return {}
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    if (!hasOpened) await openPane($, false)
    else void refresh($)
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    void refresh($)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = buildView({ summary, live, reportedCostUsd: reported, costIncludesAgents: REPORTED_COST_INCLUDES_AGENTS, now: await $.clock.now(), error })
    return Box({
      flexDirection: 'column',
      children: [
        Text({ bold: true, wrap: 'truncate-end', children: [v.title] }),
        Text({ wrap: 'truncate-end', children: [v.totals] }),
        Text({ dimColor: true, children: [v.counts] }),
        ...v.notices.map((n) => Text({ color: 'yellow', wrap: 'truncate-end', children: [n] })),
        ...v.groups.flatMap((g) => [
          Button({
            key: `g-${g.key}`,
            plain: true,
            label: groupLine(g, collapsed.has(g.key)),
            onPress: () => {
              if (collapsed.has(g.key)) collapsed.delete(g.key)
              else collapsed.add(g.key)
              $.ui.invalidate('ui.render')
            },
          }),
          ...(collapsed.has(g.key)
            ? []
            : g.rows.flatMap((r) => [
                Box({
                  flexDirection: 'row',
                  children: [
                    Text({ color: glyphColor(r.glyph), children: [`  ${r.glyph} `] }),
                    Button({
                      key: `r-${r.key}`,
                      plain: true,
                      label: rowLine(r),
                      onPress: () => {
                        if (expanded.has(r.key)) expanded.delete(r.key)
                        else expanded.add(r.key)
                        $.ui.invalidate('ui.render')
                      },
                    }),
                  ],
                }),
                ...(expanded.has(r.key) ? [Text({ dimColor: true, children: [detailLine(r)] })] : []),
              ])),
        ]),
      ],
    })
  })
}
```

Ist `$.plugin.root` laut Protokoll eine Methode, die Zeile zu `` `${await $.plugin.root()}/cli/summarize.ts` `` ändern und im Kit-Test den Stub `on('plugin.root', () => ({ value: 'P' }))` in `stub()` und in `a missing node shows as a line` ergänzen.

- [ ] **Step 4: Grün prüfen**

Run: `npm run kit` → alle neun Tests PASS. Meldet das Kit `no implementation for <name>`, fehlt in `stub()` ein Stub für diesen Aufruf: ihn nach der Tabelle in der Test-Doku (`code.claude.com/docs/en/plugins/mods/test.md`, „Look up what a stub returns“) ergänzen, nicht den Mod ändern.
Run: `npm run validate` → `✔ Validation passed`; die Zeile `hooks:` nennt `session.start, command.run{command=agent-panel}, agent.spawn, turn.complete, ui.render{component=Pane,requestId=agent-panel}`. Scheitert `--strict` an `gating hook without .catch: agent.spawn` (der Hook kann einen Spawn verweigern), an die Registrierung einen Fehler-Handler nach der Doku anhängen (`code.claude.com/docs/en/plugins/mods/events.md`, „Handle a hook that fails“), der den Spawn unverändert durchlässt — nicht `--strict` streichen.
Run: `npm run typecheck` → exit 0. Findet `tsc` das Modul `claude-code/testing` nicht, `"exclude": ["hooks/*.test.ts"]` in `tsconfig.json` setzen (das Kit prüft die Datei selbst).
Run: `npm test` → PASS (unverändert 100 %).

- [ ] **Step 5: Commit** — `Wire the panel: tick, command, auto-open and drawing`

---

### Task 11: Starter vergibt die Session-ID

**Files:**
- Modify: `scripts/claude-team.ps1` (`Get-LeadArgument`, `Invoke-ClaudeTeam`)
- Modify: `scripts/tests/ClaudeTeam.Tests.ps1`

**Interfaces:**
- Produces: `run.json` Feld `sessions: string[]` (eine Session-ID je Generation, älteste zuerst); `Get-LeadArgument -Run -Settings -Meta -SessionId` liefert `--session-id <id>` nach `--settings <pfad>`.

- [ ] **Step 1: Tests anpassen und ergänzen**

In `Describe 'Get-LeadArgument'` den Test ersetzen:

```powershell
    It 'starts the orchestrator in-process with the run folder, settings and session id' {
        $argv = Get-LeadArgument -Run 'C:/r' -Settings 'C:/s.json' -SessionId 'abc' -Meta @{ plan = 'p.md'; generation = 2; feature_branch = 'feat/x' }
        $argv[0..9] -join ' ' | Should -Be '--agent orchestrator --teammate-mode in-process --add-dir C:/r --settings C:/s.json --session-id abc'
        $argv[10] | Should -Match 'p\.md.*Run folder: C:/r.*Generation: 2.*Feature branch: feat/x.*Verdict rules: .*/docs/agent-team/verdicts\.md'
        $argv | Should -Not -Contain '--model'
    }
```

In `Describe 'Invoke-ClaudeTeam'` ergänzen:

```powershell
    It 'gives the lead a fresh session id and records it in run.json' {
        Invoke-ClaudeTeam -Plan 'docs/plan.md' | Should -Be 0
        $run = @(Get-ChildItem "$Repo/.team-runs" -Directory)[0]
        $sessions = @((Read-RunJson -Run $run.FullName).sessions)
        $sessions | Should -HaveCount 1
        $sessions[0] | Should -Match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        $Argv[[array]::IndexOf($Argv, '--session-id') + 1] | Should -Be $sessions[0]
    }
    It 'appends the session of each resumed generation' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1'
        Invoke-ClaudeTeam -Resume 'r1' | Should -Be 0
        Invoke-ClaudeTeam -Resume 'r1' | Should -Be 0
        $sessions = @((Read-RunJson -Run $run).sessions)
        $sessions | Should -HaveCount 2
        $sessions[0] | Should -Not -Be $sessions[1]
        $Argv[[array]::IndexOf($Argv, '--session-id') + 1] | Should -Be $sessions[1]
    }
```

- [ ] **Step 2: Rot prüfen**

Run: `pwsh -NoProfile -Command "Invoke-Pester scripts/tests/ClaudeTeam.Tests.ps1 -Output Detailed"`
Expected: FAIL in den drei Tests oben (`SessionId` unbekannt, `sessions` fehlt).

- [ ] **Step 3: Implementieren**

`Get-LeadArgument`: Parameter `[Parameter(Mandatory)][string]$SessionId` ergänzen und die Rückgabe ändern zu:

```powershell
    return @('--agent', 'orchestrator', '--teammate-mode', 'in-process', '--add-dir', $Run, '--settings', $Settings,
        '--session-id', $SessionId, $prompt)
```

`Invoke-ClaudeTeam`: zwischen dem `if ($Resume) { … } else { … }`-Block und `$settings = New-TeamSettings …` einfügen:

```powershell
    # The agent panel reads every generation's transcript; the run names them in order.
    $sessionId = [guid]::NewGuid().ToString()
    $meta.sessions = [string[]]@(@($meta['sessions']) | Where-Object { $_ }) + $sessionId
    Write-RunJson -Run $run -Meta $meta
```

und den Aufruf ändern zu:

```powershell
    $code = Invoke-WithoutEffortOverride -ArgumentList (Get-LeadArgument -Run $run -Settings $settings -Meta $meta -SessionId $sessionId)
```

- [ ] **Step 4: Grün prüfen**

Run: `pwsh -NoProfile -Command "Invoke-Pester scripts/tests/ClaudeTeam.Tests.ps1 -Output Detailed"` → PASS.
Run: `uv run --no-project --python 3.13 --with pytest --with pytest-cov --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate -q -n 8 --cov=scripts --cov-branch --cov-fail-under=100` → PASS (die Hooks lesen `run.json` und dürfen am neuen Feld nicht scheitern).

- [ ] **Step 5: Commit** — `Give each lead generation its own session id and record it in run.json`

---

### Task 12: Einbinden, installieren, dokumentieren

**Files:**
- Create: `.claude-plugin/marketplace.json` (Repo-Wurzel)
- Modify: `settings.json`, `scripts/install.ps1`, `scripts/tests/Install.Tests.ps1`, `scripts/tests/Settings.Tests.ps1`, `README.md`

**Interfaces:**
- Produces: Plugin-ID `agent-panel@claude-config`

- [ ] **Step 1: Tests ergänzen**

`scripts/tests/Install.Tests.ps1`, in `Describe 'Get-MarketplaceForPlugin'`:

```powershell
    It 'maps the plugins of this repo to the repo itself' {
        Get-MarketplaceForPlugin -Plugin 'agent-panel@claude-config' | Should -Be $script:RepoRoot
    }
```

(`$script:RepoRoot` setzt `install.ps1` beim Dot-Sourcing; steht er im Testkontext nicht bereit, im `BeforeAll` des Testmoduls nachsehen, wie es `install.ps1` lädt, und denselben Wert vergleichen.)

`scripts/tests/Settings.Tests.ps1`, in der `-ForEach`-Liste von `'enables the four user-level plugins'` den Fall ergänzen und den Titel zu `'enables the user-level plugins'` ändern:

```powershell
        @{ Plugin = 'agent-panel@claude-config' }
```

Neuer Test im selben `Describe`:

```powershell
    It 'lists agent-panel in the marketplace of this repo' {
        $market = Get-Content (Join-Path $script:RepoRoot '.claude-plugin/marketplace.json') -Raw | ConvertFrom-Json
        $market.name | Should -Be 'claude-config'
        ($market.plugins | Where-Object name -EQ 'agent-panel').source | Should -Be './plugins-src/agent-panel'
    }
```

- [ ] **Step 2: Rot prüfen**

Run: `pwsh -NoProfile -Command "Invoke-Pester scripts/tests/Install.Tests.ps1, scripts/tests/Settings.Tests.ps1 -Output Detailed"`
Expected: FAIL in den drei neuen Fällen.

- [ ] **Step 3: Implementieren**

`.claude-plugin/marketplace.json`:

```json
{
  "name": "claude-config",
  "owner": { "name": "Christoph Wübbels" },
  "plugins": [
    {
      "name": "agent-panel",
      "source": "./plugins-src/agent-panel",
      "description": "Side panel with cost, tokens, time and status of every agent the session spawned"
    }
  ]
}
```

`settings.json`, in `enabledPlugins`: `"agent-panel@claude-config": true`. (Kein Eintrag in `extraKnownMarketplaces`: dessen Quelle wäre ein absoluter Pfad, und `Settings.Tests.ps1` verbietet kontospezifische Pfade. `install.ps1` registriert den Marketplace.)

`scripts/install.ps1`, in `$script:Marketplaces`:

```powershell
    # This repo is its own marketplace for the plugins under plugins-src/.
    'claude-config'           = $script:RepoRoot
```

`README.md`, neuer Abschnitt nach „Agent-Team“:

```markdown
## Agent-Panel

Ein Mod (`plugins-src/agent-panel/`) zeigt rechts, was die Sitzung an Agents
gespawnt hat: je Agent Rolle, Task, Status, Modell, Kosten, Tokens und Dauer,
dazu die Summe — bei einem Team-Lauf über alle Generationen. `/agent-panel`
schaltet es an und aus; beim ersten gespawnten Agent öffnet es sich selbst
(im Terminal erst ab 144 Spalten). Entwurf:
`docs/.superpowers/specs/2026-10-09-agent-panel-design.md`.

Die Kosten sind eine Schätzung aus Tokens und einer Preistabelle
(`cli/price.ts`), kein Abrechnungswert. Weicht die Summe der laufenden Sitzung
um mehr als 10 % von dem ab, was Claude Code selbst meldet, sagt das Panel
„Preistabelle prüfen“.

**Voraussetzung:** `node` ≥ 22.18 im PATH.

**Entwickeln:** `claude --plugin-dir plugins-src/agent-panel` lädt das
Arbeitsverzeichnis und lädt bei jedem Speichern neu. Die installierte Kopie
legt Claude Code nach Version ab; nach einer Änderung `version` in
`.claude-plugin/plugin.json` erhöhen und `claude plugin install
agent-panel@claude-config` erneut ausführen.

**Tests** (in `plugins-src/agent-panel`, einmal `npm ci`):

    npm test            # Node-Tests, 100 % Coverage für cli/ und hooks/view.ts
    npm run kit         # Verdrahtung im Test-Kit von Claude Code
    npm run validate    # statische Prüfung des Mods
    npm run typecheck
```

In der Tabelle „Was wo liegt“ ergänzen:

```markdown
| `plugins-src/agent-panel/` | Mod: Agent-Panel mit Kosten, Tokens, Zeit, Status |
| `.claude-plugin/marketplace.json` | Lokaler Marketplace für die Plugins unter `plugins-src/` |
```

- [ ] **Step 4: Grün prüfen**

Run: `pwsh -NoProfile -Command "Invoke-Pester scripts/tests -Output Detailed"` → PASS (alle Module, auch `Repo.Tests.ps1` und `Gitignore.Tests.ps1`).

- [ ] **Step 5: Installieren und sehen**

Run: `pwsh -NoProfile -File scripts/install.ps1 -WhatIf` → nennt `add marketplace` für den Repo-Pfad und `install plugin agent-panel@claude-config`.
Run: `pwsh -NoProfile -File scripts/install.ps1` → `ok: agent-panel@claude-config`.

- [ ] **Step 6: Commit** — `Install the agent panel from this repo's own marketplace`

---

### Task 13: Rauchtest von Hand

**Files:**
- Create: `docs/.superpowers/smoke/2026-10-09-agent-panel-rauchtest.md`

- [ ] **Step 1: Mini-Lauf mit Resume**

In einem Spielzeug-Repo mit `.claude/team-gate` und einem Plan aus einem Task: `pwsh -File "$HOME/.claude/scripts/claude-team.ps1" docs/.superpowers/plans/<plan>.md` in einem Terminal mit ≥ 144 Spalten. Nach dem ersten gespawnten Teammate: Panel erscheint rechts von selbst. Lead mit Ctrl+C beenden, dann `claude-team.ps1 -Resume <lauf>`. Erwartet: Titel `Lauf <lauf> (Gen 1–2)`, Lead-Gruppe mit `Gen 1` (✓ oder ⊘) und `Gen 2` (●), die Teammates aus Generation 1 mit ihrem Status aus dem Transkript.

- [ ] **Step 2: Desktop-App**

Dieselbe Sitzung (`claude --resume <session>` aus der Desktop-App, Code-Tab) oder eine neue mit einem Subagenten: `/agent-panel` öffnet das Panel rechts, Zeilen und Summe wie im Terminal.

- [ ] **Step 3: Summe nachrechnen**

`node plugins-src/agent-panel/cli/summarize.ts --session <letzte Session> --cwd <repo> --home "$HOME" --cache <scratch>/check.json` und die `costUsd` aller Agents addieren; die Summe muss der Kopfzeile des Panels entsprechen. Gegenprobe: für zwei Agent-Transkripte das Zählskript `expect.js` aus Task 4 laufen lassen und Tokens vergleichen.

- [ ] **Step 4: Abgleich nach `--resume`**

Eine normale Sitzung mit einem Subagenten beenden, mit `claude --resume <session>` fortsetzen, `/agent-panel`. Notieren, ob `gemeldet $…` der Lead-Zeile den Verbrauch vor der Unterbrechung enthält. Enthält er ihn nicht, meldet der Abgleich nach jedem Resume „Preistabelle prüfen“, obwohl die Tabelle stimmt: dann im Protokoll festhalten und dem Nutzer vorlegen (Vorschlag: Abgleich nur über die Nachrichten seit dem letzten Start, `usage().startedAt`), nicht still ändern.

- [ ] **Step 5: node nicht im PATH**

Claude Code aus einer Shell mit `PATH` ohne Node starten (`$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -notmatch 'nodejs' }) -join ';'; claude`), `/agent-panel`: Panel zeigt `⚠ node nicht gefunden: …`, die Sitzung läuft normal weiter.

- [ ] **Step 6: Protokoll und Commit**

Protokoll mit Datum, Claude-Code-Version, je Schritt Erwartung, Beobachtung, Screenshot-Pfad (Scratchpad, nicht eingecheckt). Commit: `Record the agent panel smoke test`
