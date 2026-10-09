# Agent-Panel: Kosten, Tokens, Zeit und Status je Agent

Stand: 2026-10-09. Status: Entwurf zur Freigabe.

## 1. Ziel

Ein Claude-Code-Plugin zeigt rechts ein Panel mit allem, was die laufende
Sitzung an Agents gespawnt hat: je Agent Rolle, Task, Status, Modell, Kosten,
Tokens und Dauer, dazu die Summe. Gebaut für das Agent-Team
(`2026-10-08-agent-team-design.md`), nutzbar in jeder Sitzung.

Was der Nutzer festgelegt hat:

- **Oberfläche:** Terminal-TUI und Desktop-App (Code-Tab), derselbe Code.
- **Klassifizierung:** Rolle als Gruppe (`implementer-backend`, `verifier`, …),
  Task als Zeile darunter (`impl T3`, `verify:rebase T3`).
- **Umfang:** Team-Läufe mit Rollen-/Task-Gliederung; normale Sitzungen mit
  ihren Subagenten als flache Liste.
- **Kosten:** Tokens × eigene Preistabelle (API-Gegenwert), nach Token-Art
  getrennt, inklusive Cache-Write 5m/1h; dazu als Abgleich der Wert, den
  Claude Code selbst für die laufende Sitzung meldet (Abschnitt 5).
- **Zeitraum:** die laufende Sitzung, und zwar einschließlich allem vor einer
  Unterbrechung: `claude --resume`/`--continue` derselben Sitzung **und** alle
  Generationen eines Team-Laufs nach `claude-team.ps1 -Resume`.
- **Lead zählt mit:** Die Hauptsitzung (Orchestrator bzw. das Gespräch) ist
  eine eigene Gruppe und Teil der Summe.

### Nicht-Ziele

- Keine Historie früherer Sitzungen oder Läufe, kein Export, kein Bericht.
- Keine Rechnung: Die Kosten sind eine Schätzung, das Panel sagt es (≈).
- Kein Umbau von savvy-progress. Läuft es parallel, gibt es zwei Panels; das
  wird je Projekt über `enabledPlugins` gelöst, nicht im Code.

## 2. Grundlagen

Gelesen und gemessen am 2026-10-09.

1. **Mods.** Ein Plugin mit `hooks/hooks.json` → `{"modules": ["./register.ts"]}`
   exportiert `register(on, options)`. `$.ui.open({id, title})` öffnet ein
   Panel, `on('ui.render', {component: 'Pane', requestId}, …)` zeichnet es aus
   `Box`/`Text`/`Button`. Im breiten Terminal steht es als Dock rechts (selbst
   geöffnet ab 144 Spalten), in der Desktop-App rechts; `e.surface` ist
   `terminal` oder `desktop`. Neuzeichnen über `$.ui.invalidate`,
   `$.clock.every(ms, …)` oder reaktiven `$.state`. Docs:
   `code.claude.com/docs/en/plugins/mods/`, Typen: `mods/types/claude-code.d.ts`.
2. **Live-Status.** `$.agent.list()` liefert Subagenten und Teammates der
   Sitzung als `AgentInfo` mit `id`, `name`, `status`
   (`pending|running|waiting|idle|completed|failed|killed`). `id` ist laut
   `claude-code.d.ts` dieselbe Zeichenkette wie `agentId` in den
   `tool.call`-Ereignissen; in den Transkripten steht sie als `agentId` in
   jeder Zeile und als Stamm des Dateinamens (`agent-<id>.jsonl`).
   `$.session.usage()` liefert `cost` der laufenden Sitzung,
   `$.command.register` legt einen Slash-Befehl an.
3. **`claude --session-id <uuid>`** existiert und legt das Transkript unter
   `projects/<proj>/<uuid>.jsonl` ab (Probelauf am 2026-10-09).
4. **Keine Dollarbeträge.** Weder Hooks noch Transkripte enthalten Kosten je
   Agent, nur `usage` je Assistant-Nachricht.
5. **Ablage auf der Platte.** Lead: `~/.claude/projects/<proj>/<session>.jsonl`.
   Agents: `~/.claude/projects/<proj>/<session>/subagents/agent-<id>.jsonl`
   und daneben `agent-<id>.meta.json` mit `name`, `agentType`,
   `customAgentType` (die Rolle aus `agents/`), `model`, `taskKind`
   (`in_process_teammate` u. a.), `teamName`. Teammates eines Team-Laufs liegen
   unter der Sitzung des Leads. `<proj>` ist das kodierte cwd und weicht bei
   Worktrees und Temp-Pfaden ab; gesucht wird deshalb über die Session-ID.
6. **Mehrere Zeilen je Antwort (gemessen).** Eine Antwort steht als mehrere
   Zeilen mit derselben `message.id` im Transkript. Im e2e-Lauf vom
   2026-10-09: Lead 469 Zeilen auf 276 IDs, alle Wiederholungen mit gleicher
   `usage`; Teammates (`fix-B1`: 50 auf 31, `impl-T1`: 85 auf 46) mit gleichen
   Input- und Cache-Werten, aber wachsendem `output_tokens` (etwa 5 → 234).
   Die letzte Zeile einer ID trägt den Endstand.
7. **Vorbild.** savvy-progress 1.2.0 zählt live über `agent.spawn`,
   `turn.step`, `turn.complete` im Speicher. Es kennt weder Resume noch
   Generationen noch Rollen, und sein Preis-Fallback für unbekannte Modelle
   ist still.

## 3. Ansatz

**Die Platte ist die einzige Wahrheit.** Das Panel liest bei jedem Durchlauf
die Transkripte der zugehörigen Sitzungen inkrementell und rechnet daraus.
Live-Hooks lösen nur das Neuzeichnen aus; `$.agent.list()` ergänzt den Status
der laufenden Sitzung. Resume und Generationen fallen damit ohne eigenen Code
ab, und es gibt keinen zweiten Zählweg, der auseinanderlaufen kann.

Verworfen: live mitzählen plus Nachladen beim Start (zwei Wege zur selben
Zahl); savvy-progress erweitern (fremdes Plugin, Updates überschreiben es).

## 4. Aufbau

**Ablage:** `plugins-src/agent-panel/` in diesem Repo, eingebunden über einen
lokalen Marketplace in `settings.json` (`extraKnownMarketplaces`,
`enabledPlugins`), damit `install.ps1` es auf jedem PC herstellt.

| Datei | Aufgabe | Hängt ab von |
|---|---|---|
| `scan.ts` | Sitzungen der laufenden Sitzung bestimmen: die eigene ID; führt ein `<cwd>/.team-runs/*/run.json` sie in `sessions`, alle Sitzungen dieses Laufs. Dateien je Sitzung über die ID finden. | Dateisystem |
| `transcript.ts` | Eine `.jsonl` inkrementell lesen: Tokens je Art und Modell, erste/letzte Zeit, Endzustand. | — |
| `price.ts` | Preistabelle je Modell (Input, Output, Cache-Read, Cache-Write 5m, Cache-Write 1h) → USD. | — |
| `classify.ts` | Rolle aus `customAgentType`, sonst `agentType`; Task-Art und Wurzel aus dem Namen. | — |
| `model.ts` | Anzeige bauen: Kopf, Gruppen, Zeilen; Live-Status einmischen. | die vier oben |
| `register.ts` | Verdrahtung: Panel beim ersten `agent.spawn` öffnen; Slash-Befehl `/agent-panel` schaltet es an und aus (im Terminal öffnet sich das Dock von selbst erst ab 144 Spalten, von Hand ab 110); Neuzeichnen per `$.clock.every(2000)` und bei `agent.spawn`/`turn.complete`, `ui.render`. UI über Funktionsaufrufe, kein JSX. | `model.ts` |

**Änderung am Agent-Team:** `claude-team.ps1` erzeugt die Session-ID des Leads
selbst, startet ihn mit `claude --session-id <uuid>` und hängt sie in
`run.json` an ein Feld `sessions` (Liste, eine ID je Generation) an — beim
Start und bei jedem `-Resume`. Ein `run.json` ohne `sessions` (ältere Läufe)
ist gültig.

## 5. Anzeige

```
Agents · Lauf 20261009-113117 (Gen 1–2)
≈ $4.12   1.8M Tok   38:12   ● 2  ✓ 9  ✗ 1
────────────────────────────────────────
▾ Lead (Orchestrator)    $0.95  420k  38:12
▾ implementer-backend    $1.40  610k  14:02
   ● impl T3    Sonnet 5.5   $0.31  140k  3:10
   ✓ fix B1     Sonnet 5.5   $0.22   98k  2:41
▾ verifier               $0.90  …
   ✗ verify:rebase T3  Opus 5.5  …  API-Fehler
▸ code-reviewer (3)      $0.55  …
```

- **Kopf:** bei Team-Läufen Lauf-ID und Generationen; dann Kosten (≈), Tokens,
  Zeit und Zähler je Status.
- **Gruppen:** je Rolle mit Teilsumme, zuklappbar. Gruppen mit laufenden Agents
  oben, sonst nach Kosten absteigend. Der Lead ist eine eigene Gruppe, je
  Generation eine Zeile.
- **Zeilen:** Glyphe, Task, Modell, Kosten, Tokens, Dauer; bei Fehler oder
  Abbruch der Grund, soweit erkennbar.
- **Normale Sitzung:** keine Rollen-Gruppen; Lead-Zeile, dann alle Agents flach,
  benannt nach `name` bzw. `description`.

### Größen

- **Zählung je Antwort:** je `message.id` zählt nur die letzte Zeile
  (Abschnitt 2, Punkt 6). Zeilen ohne `message.id` zählen einzeln.
- **Tokens** = Input + Output + Cache-Write + Cache-Read. Die Aufschlüsselung
  steht im Detail (Desktop: Tooltip, Terminal: ausgeklappte Zeile).
- **Kosten** = Σ Token-Art × Preis des Modells der jeweiligen Nachricht.
- **Dauer je Agent** = erste bis letzte Nachricht; läuft er, bis jetzt.
- **Zeit im Kopf** = Wanduhr vom frühesten Start bis zum spätesten Ende (oder
  jetzt), nicht die Summe der Einzeldauern — parallele Agents zählten sonst
  doppelt. Pausen zwischen Generationen zählen mit.

### Status

| Glyphe | Bedeutung | Quelle laufende Sitzung | Quelle frühere Generation |
|---|---|---|---|
| ● | läuft (auch `pending`, `waiting`, `idle`) | `$.agent.list()` | — |
| ✓ | fertig | `completed` | letzte Assistant-Nachricht ohne Fehler |
| ✗ | gescheitert | `failed`, `killed` | letzte Nachricht ist ein API-Fehler |
| ⊘ | abgebrochen | — | weder Antwort noch Fehler am Ende (Lead starb) |

**Zuordnung:** Ein Eintrag aus `$.agent.list()` gehört zu der Datei, deren
`agentId` (Stamm des Dateinamens) gleich seiner `id` ist. Ein Agent, den
`$.agent.list()` nicht kennt — aus einer früheren Generation oder aus
derselben Sitzung vor einem `--resume`, denn beide sind nach dem Neustart
nicht mehr im Speicher —, bekommt den Status aus dem Transkript.

### Abgleich mit dem gemeldeten Wert

Die Lead-Zeile der laufenden Generation zeigt neben dem errechneten Betrag den
Wert aus `$.session.usage().cost`. Weichen beide um mehr als 10 % ab, steht
dort „⚠ Preistabelle prüfen“. Verglichen wird der Wert mit dem Umfang, den
Claude Code tatsächlich meldet: Die erste Aufgabe des Plans misst, ob `cost`
die Agents der Sitzung einschließt. Schließt er sie ein, ist die
Vergleichsgröße die errechnete Summe der laufenden Sitzung (Lead + ihre
Agents); sonst nur der Lead der laufenden Generation.

### Klassifizierung

Die Rolle ist `customAgentType` aus `meta.json`, ohne Plugin-Präfix (`x:y` →
`y`); fehlt sie, `agentType`. Die Task-Zeile entsteht aus dem Namen nach den
Titelformen von Abschnitt 5 der Team-Spec (`impl-T3` → `impl T3`,
`verify-rebase-T3` → `verify:rebase T3`, `hunt-R1-P2` → `hunt R1.P2`). Passt
der Name auf keine Form, steht er unverändert da.

## 6. Fehlerfälle und Leistung

- **Halbe letzte Zeile** (ohne `\n`): wird nicht gelesen, der Offset bleibt
  davor.
- **Ungültiges JSON** mitten in der Datei: übersprungen und gezählt; das Panel
  zeigt „⚠ n Zeilen unlesbar“.
- **Antwort über die Lesegrenze hinweg:** Kommen weitere Zeilen einer
  `message.id` erst im nächsten Durchlauf, ersetzt ihre `usage` die gemerkte;
  je Datei bleibt dafür die `usage` der jüngsten ID im Speicher.
- **Unbekanntes Modell:** Tokens zählen, Kosten der Zeile „?“, der Kopf sagt
  „ohne n Agents“. Kein stiller Ersatzpreis.
- **`run.json` fehlt, ist unlesbar oder hat kein `sessions`:** nur die eigene
  Sitzung, ohne Fehler.
- **Datei kleiner als der gemerkte Offset:** ersetzt; neu von vorn lesen.
- **Leistung:** Je Datei bleiben Offset, Größe und Teilsummen im Speicher; ein
  Durchlauf liest nur neue Bytes.
- **Kein Wurf nach außen:** Jeder Fehler im Lesen wird eine Zeile im Panel; die
  Sitzung wird nie gestört.

## 7. Tests

- **Werkzeug:** Node 24 (führt TypeScript direkt aus) mit `node --test
  --experimental-test-coverage --test-coverage-lines=100
  --test-coverage-branches=100 --test-coverage-functions=100`. Typprüfung mit
  `tsc --noEmit --strict`; einzige Dev-Abhängigkeit `typescript`, die
  Mod-Typen liegen als `claude-code.d.ts` im Plugin. Kein `any`. Node entfernt
  Typen nur, statt zu übersetzen: Die `tsconfig` setzt
  `erasableSyntaxOnly`, also keine `enum`, keine Parameter-Properties, keine
  Namespaces.
- **Fixtures:** gekürzte echte Transkripte und `meta.json` aus dem e2e-Lauf,
  bereinigt, unter `test/fixtures/`. Fälle: mehrere Zeilen je `message.id` mit
  wachsendem Output, Antwort über die Lesegrenze, halbe letzte Zeile, kaputte
  Zeile, unbekanntes Modell, API-Fehler am Ende, abgebrochenes Ende.
- **Je Einheit:** `transcript` (inkrementell, Offset, geschrumpfte Datei,
  letzte Zeile je ID), `price` (jede Token-Art × jedes Modell, 5m/1h),
  `classify` (jede Titelform der Team-Spec, unbekannter Name), `scan` (Lauf
  mit zwei Generationen, `run.json` ohne `sessions`, fremde Sitzung, Sitzung
  in anderem Projektordner), `model` (Wanduhr bei parallelen Agents,
  Sortierung, Lead-Gruppe, flache Liste, Zuordnung über `id`, Abgleich unter
  und über 10 %), `register` mit gefälschtem `$` (Panel öffnet,
  `/agent-panel` schaltet um, Neuzeichnen bei Ereignis, Fehler wird Zeile).
- **Starter:** Pester-Test unter `scripts/tests/`: `--session-id` steht in der
  Befehlszeile, `sessions` wächst bei `-Resume`.
- **Rauchtest von Hand** mit Protokoll unter `docs/.superpowers/`: ein echter
  Mini-Lauf mit `-Resume`, Panel im Terminal (≥ 144 Spalten) und in der
  Desktop-App, Summe gegen eine Nachrechnung aus den Transkripten per Skript.
- **Preise** bei der Umsetzung von der offiziellen Preisseite, mit Datum in
  `price.ts`.
