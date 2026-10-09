# Rauchtest Agent-Panel

- Datum: 2026-10-09
- Claude Code: `2.1.295 (Claude Code)`
- Zweig: `claude/untitled-session-a838d0`
- Screenshots: keine; Ausgaben liegen im Scratchpad unter `t13/` (nicht eingecheckt).

Die Schritte 1, 2, 4 und 5 brauchen ein interaktives Terminal, die Desktop-App
und einen laufenden Lead. Sie sind unten als Checkliste offen gelassen.

## Vorab: Panel in einer interaktiven Sitzung — vom Nutzer gesehen

`claude --plugin-dir plugins-src/agent-panel` im Terminal, dann `/agent-panel`:
Das Panel öffnet sich und sieht nach Aussage des Nutzers gut aus (2026-10-09).
Ein Team-Lauf, die Desktop-App, Resume und der Fall ohne `node` sind damit noch
nicht gesehen.

## Schritt 1: Mini-Lauf mit Resume — offen, vom Nutzer auszuführen

Erwartung: In einem Spielzeug-Repo mit `.claude/team-gate` und einem Plan aus
einem Task `pwsh -File "$HOME/.claude/scripts/claude-team.ps1" docs/.superpowers/plans/<plan>.md`
in einem Terminal mit ≥ 144 Spalten. Nach dem ersten gespawnten Teammate
erscheint das Panel rechts von selbst. Lead mit Ctrl+C beenden, dann
`claude-team.ps1 -Resume <lauf>`. Titel `Lauf <lauf> (Gen 1–2)`, Lead-Gruppe mit
`Gen 1` (✓ oder ⊘) und `Gen 2` (●), die Teammates aus Generation 1 mit ihrem
Status aus dem Transkript.

Beobachtung: —

## Schritt 2: Desktop-App — offen, vom Nutzer auszuführen

Erwartung: Dieselbe Sitzung (`claude --resume <session>` aus der Desktop-App,
Code-Tab) oder eine neue mit einem Subagenten: `/agent-panel` öffnet das Panel
rechts, Zeilen und Summe wie im Terminal.

Beobachtung: —

## Schritt 3: Summe nachrechnen — ausgeführt

Sitzung: e2e-Teamlauf `2f6c9657-f9e1-44ba-b005-12dd24346526` (Projektordner
`…-scratchpad-e2e-repo`), 1 Lead und 33 Subagenten.

```
node plugins-src/agent-panel/cli/summarize.ts --session 2f6c9657-f9e1-44ba-b005-12dd24346526 \
  --cwd <scratch>/t13 --home "$HOME" --cache <scratch>/t13/check.json
```

Exit 0, alle 34 Agents bepreist (`unpriced: false`), keine Hinweise.

| | USD |
|---|---|
| Lead | 20,5633 |
| 33 Subagenten | 25,1013 |
| Summe `costUsd` | **45,6646** |

Kopfzeile, die `buildView` daraus baut (`live = []`, `reportedCostUsd = null`,
`costIncludesAgents = true`):

```
title:  Diese Sitzung
totals: ≈ $45.7   125.8M Tok   5:04:21
counts: ● 0  ✓ 32  ✗ 0  ⊘ 1
```

Die Summe stimmt mit der Kopfzeile überein ($45,66 → `$45.7`). `counts` zählt
die 33 Subagenten ohne Lead: 32 beendet, einer mit `end: open` (⊘).

Gegenprobe mit `expect.js` (unabhängige Zählung, letzte Zeile je `message.id`):

| Agent | Quelle | input | output | cacheRead | cacheWrite5m | cacheWrite1h |
|---|---|---|---|---|---|---|
| `averify-B3-3-b4c2bb27db261770` | expect.js | 144 | 19191 | 6230176 | 134796 | 0 |
| | summarize | 144 | 19191 | 6230176 | 134796 | 0 |
| `aimpl-T1-68b88106e258a672` | expect.js | 102 | 13026 | 2595783 | 131011 | 0 |
| | summarize | 102 | 13026 | 2595783 | 131011 | 0 |

Beide stimmen exakt überein.

## Schritt 4: Abgleich nach `--resume` — offen, vom Nutzer auszuführen

Erwartung: Eine normale Sitzung mit einem Subagenten beenden, mit
`claude --resume <session>` fortsetzen, `/agent-panel`. Notieren, ob
`gemeldet $…` der Lead-Zeile den Verbrauch vor der Unterbrechung enthält.
Enthält er ihn nicht, meldet der Abgleich nach jedem Resume „Preistabelle
prüfen“, obwohl die Tabelle stimmt: dann hier festhalten und dem Nutzer
vorlegen (Vorschlag: Abgleich nur über die Nachrichten seit dem letzten Start,
`usage().startedAt`), nicht still ändern.

Beobachtung: —

## Schritt 5: node nicht im PATH — offen, vom Nutzer auszuführen

Erwartung: Claude Code aus einer Shell ohne Node im `PATH` starten
(`$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -notmatch 'nodejs' }) -join ';'; claude`),
`/agent-panel`: Das Panel zeigt `⚠ node nicht gefunden: …`, die Sitzung läuft
normal weiter.

Beobachtung: —
