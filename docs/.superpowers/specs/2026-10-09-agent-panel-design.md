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
8. **Grenzen eines Mods.** Das Hooks-Modul hat keine Node-APIs und keinen
   eigenen Dateizugriff. `$.fs.read` liest eine Datei ganz und höchstens
   4 MiB; am 2026-10-09 lagen 76 von 4.509 Transkripten unter
   `~/.claude/projects` darüber, das größte bei 27,4 MiB. `$.process.run(argv)`
   startet ein Programm ohne Shell und liefert `{exitCode, stdout, stderr}`
   (Zeitlimit 30 s). Ein Hook darf 10 s eigene Rechenzeit verbrauchen. Das
   Modul importiert nur Dateien im Plugin-Verzeichnis über relative Pfade und
   `claude-code`; `$` darf nur an Funktionen derselben Datei gehen.
   `claude plugin validate` prüft das statisch, `claude plugin test` führt
   jede `*.test.ts` unter dem Plugin mit dem Test-Kit `claude-code/testing`
   aus (ohne Coverage-Messung).

## 3. Ansatz

**Die Platte ist die einzige Wahrheit.** Bei jedem Durchlauf liest ein
Node-Hilfsskript im Plugin die Transkripte der zugehörigen Sitzungen
inkrementell und gibt eine Zusammenfassung als JSON aus; der Mod ruft es per
`$.process.run(['node', <skript>, …])` auf. Live-Hooks lösen nur das
Neuzeichnen aus; `$.agent.list()` ergänzt den Status der laufenden Sitzung.
Resume und Generationen fallen damit ohne eigenen Code ab, und es gibt keinen
zweiten Zählweg, der auseinanderlaufen kann. Das Lesen liegt im Skript, weil
der Mod Dateien über 4 MiB nicht lesen kann (Abschnitt 2, Punkt 8).

Verworfen: live mitzählen plus Nachladen beim Start (zwei Wege zur selben
Zahl); savvy-progress erweitern (fremdes Plugin, Updates überschreiben es);
Lesen über `$.fs.read` (4-MiB-Grenze); ein dauerhaft laufender Helfer per
`$.process.spawn` (ob Claude Code ihn beim Neuladen oder Sitzungsende beendet,
ist nicht dokumentiert).

## 4. Aufbau

**Ablage:** `plugins-src/agent-panel/` in diesem Repo, eingebunden über einen
lokalen Marketplace in `settings.json` (`extraKnownMarketplaces`,
`enabledPlugins`), damit `install.ps1` es auf jedem PC herstellt.

Zwei Laufzeiten, zwei Ordner. `cli/` läuft unter Node und darf alles, was
Node kann; `hooks/` läuft im Mod und darf nur `$`.

| Datei | Aufgabe | Hängt ab von |
|---|---|---|
| `cli/summarize.ts` | Einstieg: `node summarize.ts --session <id> --cwd <dir> --home <dir> --cache <datei>`; druckt die Zusammenfassung als eine JSON-Zeile auf stdout, Exit 0 auch bei Lesefehlern (sie stehen in der Zusammenfassung). | die übrigen in `cli/` |
| `cli/scan.ts` | Sitzungen der laufenden Sitzung bestimmen: die eigene ID; führt ein `<cwd>/.team-runs/*/run.json` sie in `sessions`, alle Sitzungen dieses Laufs. Dateien je Sitzung über die ID unter `<home>/.claude/projects/*/` finden. | `node:fs` |
| `cli/transcript.ts` | Eine `.jsonl` ab gemerktem Byte-Offset lesen: Tokens je Art und Modell, erste/letzte Zeit, Endzustand, unlesbare Zeilen. | `node:fs` |
| `cli/cache.ts` | Offsets und Teilsummen je Datei in der Cache-Datei laden und speichern. | `node:fs` |
| `cli/price.ts` | Preistabelle je Modell (Input, Output, Cache-Read, Cache-Write 5m, Cache-Write 1h) → USD. | — |
| `cli/classify.ts` | Rolle aus `customAgentType`, sonst `agentType`; Task-Art und Wurzel aus dem Namen. | — |
| `hooks/view.ts` | Reine Funktionen ohne `$`: aus Zusammenfassung, Live-Status und Uhrzeit die Anzeige bauen (Kopf, Gruppen, Zeilen, Abgleich, Formatierung). | — |
| `hooks/register.ts` | Verdrahtung: beim `session.start` den Befehl `/agent-panel` registrieren und den Takt `$.clock.every(2000)` starten; je Takt — aber erst, wenn das Panel in dieser Sitzung einmal geöffnet wurde, damit Sitzungen ohne Agents nie ein `node` starten — `$.process.run(['node', …])`, Ergebnis parsen, `$.agent.list()` und `$.session.usage()` lesen, `$.ui.invalidate`; Panel beim ersten `agent.spawn` öffnen; `/agent-panel` schaltet es an und aus (im Terminal öffnet sich das Dock von selbst erst ab 144 Spalten, von Hand ab 110); `ui.render` zeichnet das Ergebnis von `view.ts`. UI über `$.ui.resolve(e)`-Elemente, kein JSX. Keine eigene Logik. | `hooks/view.ts` |

**Cache-Datei:** `<tmp>/agent-panel/<session-id>.json`, nicht unter dem
Plugin-Verzeichnis, das ein Update ersetzt. Fehlt oder ist sie unlesbar, liest
das Skript von vorn. Der Ordner wird mit Modus 0700 angelegt; einen
vorhandenen nutzt das Skript nur, wenn er ein echter Ordner (kein Link) ist und
— unter POSIX — dem aktuellen Nutzer gehört und Gruppe und Andere nicht darin
schreiben dürfen. Sonst — auch wenn an der Stelle eine Datei oder ein ins Leere
zeigender Link liegt — liest und schreibt es keinen Cache und fasst trotzdem
zusammen. Geschrieben wird über eine Temp-Datei mit zufälligem Namen, die
exklusiv (`wx`, Modus 0600) angelegt und dann umbenannt wird. Scheitert das
Anlegen des Ordners aus einem anderen Grund als dem Hindernis an der Stelle
(etwa Zugriff verweigert) oder das Schreiben, bleibt die Zusammenfassung und
erhält eine Problemzeile „Cache nicht gespeichert“.

**Voraussetzung:** `node` ≥ 22.18 (führt TypeScript ohne Flag aus) im PATH des
Claude-Code-Prozesses. Scheitert der Start, zeigt das Panel „node nicht
gefunden“ statt Zahlen.

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
  steht in einer Detailzeile, die ein Druck auf die Agent-Zeile auf- und
  zuklappt, auf beiden Oberflächen gleich (`in 68 · out 3.5k · read 1.4M ·
  write 163k/0`, Cache-Write als 5m/1h).
- **Kosten** = Σ Token-Art × Preis des Modells der jeweiligen Nachricht.
- **Dauer je Agent** = erste bis letzte Nachricht; läuft er, bis jetzt.
- **Zeit im Kopf** = Summe über die Generationen; je Generation die Wanduhr
  vom frühesten Start bis zum spätesten Ende (oder jetzt) ihres Leads und
  ihrer Agents. Nicht die Summe der Einzeldauern — parallele Agents zählten
  sonst doppelt —, und Pausen zwischen Generationen zählen nicht mit. Eine
  normale Sitzung ist eine Generation; die Pause vor einem `--resume`
  derselben Sitzung zählt dort mit.

### Status

| Glyphe | Bedeutung | Quelle laufende Sitzung | Quelle frühere Generation |
|---|---|---|---|
| ● | läuft (auch `pending`, `waiting`, `idle`) | `$.agent.list()` | — |
| ✓ | fertig | `completed` | mindestens eine abgeschlossene Antwort (`stop_reason: end_turn`), und die letzte Assistant-Zeile ist kein API-Fehler |
| ✗ | gescheitert | `failed`, `killed` | die letzte Assistant-Zeile ist ein API-Fehler (`isApiErrorMessage`) |
| ⊘ | abgebrochen | — | keine einzige abgeschlossene Antwort und kein API-Fehler am Ende |

Nicht „die letzte Zeile“: Ein Teammate endet im Transkript nach der
Shutdown-Nachricht des Leads mit einem Tool-Ergebnis, nicht mit seiner Antwort
(gemessen am e2e-Lauf vom 2026-10-09, `fix-B1` und `impl-T1`). Der Lead einer
früheren Generation folgt derselben Regel.

**Zuordnung:** Ein Eintrag aus `$.agent.list()` gehört zu der Datei, deren
`agentId` (Stamm des Dateinamens) gleich seiner `id` ist. Ein Agent, den
`$.agent.list()` nicht kennt — aus einer früheren Generation oder aus
derselben Sitzung vor einem `--resume`, denn beide sind nach dem Neustart
nicht mehr im Speicher —, bekommt den Status aus dem Transkript.

### Abgleich mit dem gemeldeten Wert

Die Lead-Zeile der laufenden Generation zeigt neben dem errechneten Betrag den
Wert aus `$.session.usage().cost`. Weichen beide um mehr als 10 % ab, steht
dort „⚠ Preistabelle prüfen“. Verglichen wird der Wert mit dem Umfang, den
Claude Code tatsächlich meldet: Eine Messaufgabe des Plans (nach dem Skript,
weil sie es braucht) misst, ob `cost`
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
  je Datei steht dafür die `usage` der jüngsten ID in der Cache-Datei.
- **Unbekanntes Modell:** Tokens zählen, Kosten der Zeile „?“, der Kopf sagt
  „ohne n Agents“. Kein stiller Ersatzpreis.
- **`run.json` fehlt, ist unlesbar oder hat kein `sessions`:** nur die eigene
  Sitzung, ohne Fehler.
- **Datei kleiner als der gemerkte Offset:** ersetzt; neu von vorn lesen.
- **Leistung:** Je Datei stehen Offset, Größe und Teilsummen in der
  Cache-Datei; ein Durchlauf liest nur neue Bytes. Der Takt von 2 s gilt unter
  der Bedingung, dass ein Skriptaufruf mit warmem Cache unter 500 ms bleibt;
  die erste Aufgabe des Plans misst das, und liegt er darüber, wird der Takt
  auf das Vierfache der gemessenen Dauer gesetzt.
- **Skript scheitert** (Start, Exit ≠ 0, stdout kein JSON, Zeitlimit): das
  Panel behält die letzte gute Zusammenfassung und zeigt den Fehler als Zeile.
- **Überlappende Aufrufe:** Läuft ein Aufruf noch, wenn der Takt kommt, fällt
  der neue aus.
- **Kein Wurf nach außen:** Jeder Fehler im Lesen wird eine Zeile im Panel; die
  Sitzung wird nie gestört.

## 7. Tests

- **Zwei Läufer.** `cli/` und `hooks/view.ts` prüft `node --test
  --experimental-test-coverage --test-coverage-lines=100
  --test-coverage-branches=100 --test-coverage-functions=100`; die Testdateien
  heißen `*.spec.ts`, weil `claude plugin test` jede `*.test.ts` unter dem
  Plugin selbst ausführt. `hooks/register.ts` prüft `claude plugin test` mit
  dem Kit in `hooks/register.test.ts` (Stubs für `process.run`, `agent.list`,
  `session.usage`, `ui.open`, `command.register`, `mock.clock` für den Takt),
  dazu `claude plugin validate --strict`.
- **Ausschluss mit Begründung:** `hooks/register.ts` steht nicht in der
  Coverage-Messung, weil das Kit keine misst und die Datei unter Node nicht
  läuft (sie spricht nur `$`). Dafür enthält sie keine Logik: jede
  Entscheidung (Formatierung, Sortierung, Abgleich, Fehlertext) liegt in
  `view.ts`; das Kit prüft nur, dass jede Verdrahtung einmal feuert.
- **Typen:** `tsc --noEmit --strict`; Dev-Abhängigkeiten nur `typescript` und
  `@types/node` (für `cli/`).
  Die Mod-Typen in `.claude-plugin/types/` schreibt Claude Code nur, wenn eine
  interaktive Sitzung das Plugin mit `claude --plugin-dir` lädt (nicht
  `claude -p`); sie bringen ihre eigene `.gitignore` mit und werden nicht
  eingecheckt. `npm run typecheck` braucht daher vorher ein solches Laden.
  Kein `any`. Node entfernt Typen nur, statt zu übersetzen: Die
  `tsconfig` setzt `erasableSyntaxOnly`, also keine `enum`, keine
  Parameter-Properties, keine Namespaces.
- **Fixtures:** gekürzte echte Transkripte und `meta.json` aus dem e2e-Lauf,
  bereinigt, unter `test/fixtures/`. Fälle: mehrere Zeilen je `message.id` mit
  wachsendem Output, Antwort über die Lesegrenze, halbe letzte Zeile, kaputte
  Zeile, unbekanntes Modell, API-Fehler am Ende, abgebrochenes Ende.
- **Je Einheit:** `transcript` (inkrementell, Offset, geschrumpfte Datei,
  letzte Zeile je ID), `price` (jede Token-Art × jedes Modell, 5m/1h),
  `classify` (jede Titelform der Team-Spec, unbekannter Name), `scan` (Lauf
  mit zwei Generationen, `run.json` ohne `sessions`, fremde Sitzung, Sitzung
  in anderem Projektordner), `cache` (fehlt, unlesbar, Rundreise),
  `summarize` (Argumente, JSON auf stdout, Exit 0 bei Lesefehlern), `view`
  (Wanduhr bei parallelen Agents, zwei Generationen mit Pause, Sortierung,
  Lead-Gruppe, flache Liste, Zuordnung über `id`, Abgleich unter und über
  10 %, Skriptfehler mit letzter guter Zusammenfassung), `register` im Kit
  (Panel öffnet beim ersten `agent.spawn`, `/agent-panel` schaltet um, Takt
  ruft das Skript, kein zweiter Aufruf während eines laufenden, Fehler wird
  Zeile).
- **Starter:** Pester-Test unter `scripts/tests/`: `--session-id` steht in der
  Befehlszeile, `sessions` wächst bei `-Resume`.
- **Rauchtest von Hand** mit Protokoll unter `docs/.superpowers/`: ein echter
  Mini-Lauf mit `-Resume`, Panel im Terminal (≥ 144 Spalten) und in der
  Desktop-App, Summe gegen eine Nachrechnung aus den Transkripten per Skript,
  `node` im PATH des Claude-Code-Prozesses.
- **Preise** bei der Umsetzung von der offiziellen Preisseite, mit Datum in
  `price.ts`.
