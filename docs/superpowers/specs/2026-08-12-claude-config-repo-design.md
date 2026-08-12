# Versionierte Claude-Code-Konfiguration

**Datum:** 2026-08-12
**Status:** Design abgenommen, Plan ausstehend

## Ziel

Die Claude-Code-Konfiguration dieses Nutzers soll auf mehreren PCs identisch
sein und ihre Geschichte behalten. Heute lebt sie ausschließlich lokal in
`C:\Users\micro\.claude`; ein zweiter Rechner bedeutet manuelles Nachbauen, und
eine kaputte Änderung ist nicht zurücknehmbar.

Erfolgskriterium: Auf einem frischen Windows-PC führen ein Checkout und ein
Skriptaufruf zu einer arbeitsfähigen, identischen Umgebung — inklusive
Statusline, Plugins und MCP-Servern.

## Nicht-Ziele

- Kein Sync von Sitzungsdaten, Verlauf, Zugangsdaten oder Caches.
- Keine plattformübergreifende Unterstützung. Das Setup ist Windows-only,
  solange es keinen zweiten Nicht-Windows-Rechner gibt.
- Keine Verwaltung von Claude Code selbst oder von `git`. Beide sind
  Voraussetzung, nicht Gegenstand.

## Architektur

### Das Repo ist der Konfigurationsordner

Das Git-Working-Tree **ist** `C:\Users\micro\.claude`. Es gibt keine Kopie,
keinen Sync-Schritt und keinen Symlink für die Hauptdateien: was Claude Code
liest, ist exakt das, was im Repo steht. Damit ist Divergenz zwischen
„versionierter" und „aktiver" Konfiguration strukturell ausgeschlossen.

Das Repo taucht bewusst **nicht** unter `C:\Users\micro\Documents\#GIT` auf —
weder als Kopie noch als Junction. Ein zweiter Pfad auf denselben Ordner wäre
reine Bequemlichkeit und würde eine Zweiteilung suggerieren, die es nicht
gibt.

Der Abgleich zwischen PCs läuft über ein Git-Remote, nicht über den
Ordnerpfad.

### Allowlist statt Blocklist

`~/.claude` besteht überwiegend aus Laufzeitdaten: `sessions/`, `projects/`,
`history.jsonl`, `.credentials.json`, `shell-snapshots/`, `worktrees/`,
`cache/`, `backups/`, `debug/` und weitere. Eine Blocklist wäre eine
Dauerbaustelle: Jede neue Claude-Code-Version kann einen Ordner hinzufügen,
der dann still im nächsten Commit landet — im schlimmsten Fall mit
Anmeldedaten.

Die `.gitignore` verbietet deshalb zuerst alles und erlaubt dann namentlich:

```gitignore
/*
!/.gitignore
!/README.md
!/CLAUDE.md
!/settings.json
!/keybindings.json
!/skills/
!/agents/
!/statusline/
!/scripts/
!/docs/
/statusline/.cc-version
```

Konsequenzen dieser Regel:

- `settings.local.json` ist ohne Zutun ausgeschlossen.
- `plugins/` bleibt vollständig draußen, siehe unten.
- `skills/` und `agents/` sind heute leer beziehungsweise nicht vorhanden.
  Sie werden als versionierte Ordner angelegt, damit künftige eigene Skills
  und Agenten ohne weitere Entscheidung mitwandern.
- Eine neu erlaubte Datei kostet genau eine Zeile. Eine vergessene
  Verbotszeile kostet nichts.

### Plugins: die Absicht wird versioniert, nicht der Zustand

`plugins/installed_plugins.json` und `known_marketplaces.json` bleiben
**ungetrackt**. Beide sind Zustandsdateien, keine Konfiguration: Sie enthalten
absolute Installationspfade und Zeitstempel, und `installed_plugins.json`
führt zusätzlich projektbezogene Einträge für fremde Repos:

```json
"frontend-design@claude-plugins-official": [
  { "scope": "project",
    "projectPath": "c:\\Users\\micro\\Documents\\#GIT\\iam_frontend", … } ]
```

Diese Datei zu versionieren hätte zwei Folgen, beide unerwünscht. Erstens
zeigten die Pfade auf einem zweiten PC ins Leere. Zweitens — und das wiegt
schwerer — würde jedes Projekt, das ein Plugin aktiviert, die
Nutzerkonfiguration verändern und einen Merge-Konflikt erzeugen. **Welche
Plugins und MCP-Server ein Projekt nutzt, entscheidet das Projekt**, in seiner
eigenen `.claude/settings.json`. Dieses Repo beschreibt ausschließlich die
Nutzerebene.

Versioniert wird stattdessen die *Absicht*: `enabledPlugins` in
`settings.json` nennt die gewünschten Plugins maschinenunabhängig, und das
Install-Skript stellt den Zustand daraus her. Auf Nutzerebene aktiv sind
`superpowers`, `code-review` und `security-guidance` aus dem offiziellen
Marketplace sowie `browser-use`; `browser-use@browser-use` kommt als neuer
Eintrag hinzu.

### Secrets

`settings.json` enthält heute einen Obsidian-API-Key in
`mcpServers.mcp-obsidian`. Dieser Server wird **ersatzlos entfernt**.
`browser-use` wandert in ein Plugin (siehe Install-Skript), womit der
`mcpServers`-Abschnitt vollständig entfällt. `settings.json` ist danach
secret-frei und lässt sich ganz versionieren.

Damit das so bleibt, kommt ein `pre-commit`-Hook dazu, der die gestageten
Dateien gegen bekannte Key-Muster und gegen lange Hex- beziehungsweise
Base64-Zeichenketten prüft und den Commit abbricht. Das ist die maschinelle
Umsetzung einer Regel, die sonst nur Prosa wäre und über genügend Sessions
zuverlässig gebrochen würde.

Der Hook liegt unter `scripts/pre-commit` im Repo; das Install-Skript
verknüpft ihn nach `.git/hooks/pre-commit`.

## Statusline

### Ausgangslage

Die vorhandene Konfiguration in `~/.config/cship.toml` definiert zwei Zeilen,
von denen die erste **nichts ausgibt**. Nachgewiesen:

```
$ cship  (echte Config, cwd = #GIT\space)
🤖 Opus 5 💰 $0.42 ░░░░░░░░░░ 0%
```

Ursache: cship rendert seine eigenen `cship.*`-Module selbst und delegiert
alle Starship-Module (`$directory`, `$git_branch`, `$time`, …) an das
Starship-Binary. `starship` ist auf diesem PC nicht installiert, also fällt
Zeile 1 lautlos weg.

Zweiter Befund: `$cship.version` liefert die **cship**-Version, nicht die von
Claude Code. Verifiziert durch einen Render mit `"version": "2.0.9"` in der
Eingabe-JSON, der weiterhin `1.8.0` ausgab.

### Sollzustand

Zeile 1 — Uhrzeit, Projektordner, Branch beziehungsweise Worktree,
Zeilenbilanz:

```
14:32 │ space │  main │ +47 -12
```

Zeile 2 — Modell, Effort, Sitzungspreis, Kontextfenster, Limits, Peak,
Version:

```
🤖 Opus 5 │ ⚡ low │ 💰 $0.42 │ ░░░░░░░░░░ 6% │ ⌛ 5h 28% (18m) │ 📅 7d 7% (6d11h) │ 📈 … │ v2.0.9
```

### Farben

Die Zeilenbilanz ist fest eingefärbt: hinzugefügte Zeilen grün, entfernte rot.
Das sind keine Schwellen, sondern die überall geltende Diff-Konvention.

Die Prozentschwellen bleiben modulweise verschieden und unverändert: **40 /
70** beim Kontextfenster, **60 / 80** bei den Nutzungslimits. Das ist
beabsichtigt, nicht historisch gewachsen — ein volles Kontextfenster tut früher
weh als ein angebrochenes Wochenlimit, also warnt es früher.

Der Sitzungspreis behält seine Grenzen bei 2 und 5 Dollar.

### Herkunft der Felder

| Feld | Quelle |
|---|---|
| Uhrzeit | starship `$time` |
| Projektordner | starship `$directory` |
| Branch | starship `$git_branch`, `$git_state` |
| Worktree | starship `custom`-Modul, siehe unten |
| +/- Zeilen | `$cship.cost.total_lines_added` / `_removed` |
| Modell | `$cship.model` |
| Effort | `$cship.effort` |
| Preis | `$cship.cost` |
| Kontextfenster | `$cship.context_bar` |
| 5h / 7d | `$cship.usage_limits` |
| Peak | `$cship.peak_usage` |
| Version | `custom`-Modul liest `statusline/.cc-version` |

### Worktree-Erkennung

Starship hat kein Worktree-Modul. Ein `custom`-Modul gibt nur dann einen
Marker aus, wenn `git rev-parse --git-common-dir` vom `--git-dir` abweicht —
das ist die verlässliche Unterscheidung zwischen Hauptarbeitsverzeichnis und
Worktree. Ein `git rev-parse` pro Render ist billig genug.

### Claude-Code-Version ohne Subprozess

cship stellt die Claude-Code-Version nicht bereit, und `claude --version` bei
jedem Render aufzurufen hieße, in einer Statusline einen Node-Prozess zu
starten. Stattdessen nutzen wir, dass Claude Code die Version ohnehin an seine
Hooks übergibt: Ein **SessionStart-Hook** schreibt sie einmal je Sitzung nach
`statusline/.cc-version`, ein `custom`-Modul liest die Datei.

`.cc-version` ist eine generierte Laufzeitdatei und ist trotz ihres Ortes in
einem versionierten Ordner ausgeschlossen.

### Ablage

Die Konfiguration lebt als `statusline/cship.toml` im Repo. Das Install-Skript
setzt `~/.config/cship.toml` als Symlink darauf. Danach sind Bearbeiten und
Versionieren derselbe Vorgang.

Eine einzige Datei genügt für beides: cship erwartet ohnehin eine
starship-kompatible TOML und liest die `[cship.*]`-Abschnitte zusätzlich.

Das `cship.exe` selbst gehört nicht ins Repo. Ein Binary ist Toolchain, keine
Konfiguration.

## Install-Skript

`scripts/install.ps1`. Idempotent: Jeder Schritt prüft zuerst, ob er nötig
ist, und meldet, was er getan oder übersprungen hat.

1. **Vorbedingungen** — `git` und `claude` müssen vorhanden sein. Fehlt eins,
   bricht das Skript mit klarer Meldung ab, statt zu raten.
2. **uv** — `irm https://astral.sh/uv/install.ps1 | iex`
3. **cship** — `irm https://cship.dev/install.ps1 | iex`
4. **starship** — `winget install --id Starship.Starship`, bei Fehlschlag
   Hinweis auf `cargo install starship`
5. **Marketplaces** — `claude plugin marketplace add` für
   `anthropics/claude-plugins-official` und
   `https://github.com/browser-use/plugins.git`
6. **Plugins** auf Nutzerebene — `claude plugin install` für
   `superpowers@claude-plugins-official`,
   `code-review@claude-plugins-official`,
   `security-guidance@claude-plugins-official` und
   `browser-use@browser-use`
7. **Symlink** `~/.config/cship.toml` → `~/.claude/statusline/cship.toml`
8. **Git-Hook** `scripts/pre-commit` → `.git/hooks/pre-commit`
9. **Report** mit den gefundenen Versionen

`browser-use` kommt als Plugin, nicht als handgeschriebener MCP-Eintrag. Der
bestehende `mcpServers.browser-use`-Block in `settings.json` wird deshalb
entfernt — zusammen mit `mcp-obsidian` verschwindet damit der gesamte
`mcpServers`-Abschnitt. Das Plugin bringt seine Serverdefinition selbst mit
und aktualisiert sich mit, statt einen fest verdrahteten Pfad nach
`~/.local/bin` zu konservieren.

Es stammt allerdings **nicht** aus dem offiziellen Marketplace — dessen
Katalog kennt kein `browser-use`. Der Anbieter betreibt einen eigenen unter
`https://github.com/browser-use/plugins.git`, dessen `marketplace.json` sich
`browser-use` nennt und die Plugins `browser-use` und `qa` führt. Daher der
eigene Registrierungsschritt; ohne ihn schlägt `claude plugin install
browser-use@browser-use` fehl.

Alle Aufrufe in Schritt 5 und 6 sind idempotent — ein bereits registrierter
Marketplace und ein bereits installiertes Plugin sind kein Fehlerfall. Die
Plugins werden ausdrücklich auf **Nutzerebene** installiert, passend zu
`enabledPlugins` in der versionierten `settings.json`. Projektbezogene
Plugins bleiben Sache des jeweiligen Projekts.

`uv` bleibt trotzdem Teil der Installation — es ist die Grundlage für alles
Python-Nahe, nicht nur für browser-use. Nirgends wird `pip` verwendet.

### Akzeptanztest

Nach dem Lauf muss cship mit einer Test-JSON **beide** Zeilen gefüllt
ausgeben. Das ist die Abnahme, nicht der Augenschein.

## Erstinbetriebnahme auf einem neuen PC

`git clone` verweigert den Dienst, weil `~/.claude` dort bereits existiert und
nicht leer ist. Die README beschreibt daher:

```
cd $HOME/.claude
git init
git remote add origin <url>
git fetch
git checkout -f main
pwsh scripts/install.ps1
```

`checkout -f` überschreibt die vom frischen Claude Code angelegten
Standarddateien. Vorhandene Laufzeitdaten bleiben unberührt, weil sie nicht
Teil des Repos sind.

## Tests

Zwei Skripte enthalten Logik: `install.ps1` und der `pre-commit`-Hook.

Der Hook ist der kritischere von beiden — ein stiller Fehler dort veröffentlicht
Zugangsdaten. Er bekommt Pester-Tests, die nachweisen, dass er einen echten Key
blockiert und eine harmlose Datei durchlässt.

`install.ps1` wird nicht end-to-end getestet, weil es das System verändert.
Stattdessen zerlegt: Prüf- und Pfadfunktionen einzeln per Pester, die
Installationsaufrufe hinter einem `-WhatIf`-Schalter, der in den Tests gesetzt
ist.

Coverage wird bei PowerShell nicht gemessen. Das ist dieselbe bewusst
dokumentierte Lücke wie bei GDScript im Projekt `space`: Wo die Sprache kein
Werkzeug hat, gilt ersatzweise „jedes Modul hat Tests".

## Änderung an der globalen CLAUDE.md

Im Abschnitt *Pläne* wird ergänzt, dass Superpowers-Specs und
-Implementierungspläne **immer im Repo des jeweiligen Projekts** liegen —
`docs/superpowers/specs/` beziehungsweise `plans/` — und nie in einem
zentralen Ablageort oder im Scratchpad. Ein Plan, der nicht neben dem Code
liegt, den er beschreibt, wird nicht wiedergefunden.

Dieses Dokument ist der erste Anwendungsfall der Regel.

## Offene Punkte

Keine.
