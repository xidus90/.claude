# Claude-Code-Konfiguration

Dieses Repo *ist* `C:\Users\micro\.claude`. Es gibt keine Kopie und keinen
Sync-Schritt: Was Claude Code liest, ist genau das, was hier eingecheckt ist.

Versioniert wird nur die **Nutzerebene** — Einstellungen, Statusline, eigene
Skills und Agenten, Skripte, Dokumentation. Sitzungen, Verlauf, Zugangsdaten,
Caches und die Plugin-Zustandsdateien bleiben draußen.

Welche Plugins und MCP-Server ein *Projekt* nutzt, entscheidet das Projekt in
seiner eigenen `.claude/settings.json`. Hier steht ausschließlich, was auf
allen Rechnern gleich sein soll.

## Inbetriebnahme auf einem neuen PC

Voraussetzungen, die das Skript **nicht** installiert: **git**, **Claude Code**
und **PowerShell 7** (`pwsh`).

`git clone` funktioniert hier nicht — der Ordner existiert auf einem frischen
PC bereits und ist nicht leer. Stattdessen:

```powershell
cd $HOME\.claude
git init -b main
git remote add origin <url>
git fetch
git checkout -f main
pwsh -NoProfile -File scripts\install.ps1
```

`checkout -f` überschreibt die Standarddateien, die ein frisch installiertes
Claude Code angelegt hat. Laufzeitdaten bleiben unberührt, weil sie nicht Teil
des Repos sind.

Danach **Claude Code neu starten**, damit Statusline und Plugins greifen.

## ⚠ Kein `git clean`

In diesem Repo ist `git clean` verboten. `git clean -fdx` würde alle
Sitzungen, den Verlauf und `.credentials.json` löschen — sie sind ungetrackt,
und das ist Absicht. Zum Verwerfen von Änderungen `git restore` verwenden.

## Was das Install-Skript tut

`scripts\install.ps1` ist idempotent; ein zweiter Lauf meldet nur, was er
überspringt. Mit `-WhatIf` läuft es trocken.

1. prüft `git` und `claude` und bricht sonst mit klarer Meldung ab
2. installiert `uv`, `cship` und `starship`, sofern sie fehlen
3. registriert die Plugin-Marketplaces und installiert die Plugins, die in
   `settings.json` unter `enabledPlugins` auf `true` stehen
4. verknüpft `~/.config/cship.toml` mit `statusline/cship.toml`
5. setzt `STARSHIP_CONFIG` auf dieselbe Datei
6. installiert den `pre-commit`-Hook
7. gibt eine Versionsübersicht aus

## Die Statusline

Zwei Zeilen, gerendert von `cship` mit `starship` als Unterprozess:

```
18:00 │ space │  main │ +47 -12
🤖 Opus 5 │ ⚡ low │ 💰 $0.42 │ ░░░░░░░░░░ 6% │ ⌛ 5h 28% │ 📅 7d 7% │ ⏰ Peak │ v2.1.220
```

Drei Dinge daran sind nicht offensichtlich und kosten sonst Stunden:

**`starship` muss *erreichbar* sein, nicht nur installiert.** cship rendert
seine eigenen `cship.*`-Module selbst und reicht alle übrigen an das
starship-Binary weiter. Fehlt es im PATH, bleibt Zeile 1 **lautlos leer** —
keine Fehlermeldung, nichts.

Die Tücke: winget legt starship in ein Paketverzeichnis und hängt dieses an
den **Benutzer-PATH** an. Ein bereits laufender Prozess liest den nie nach,
und Claude Code erbt den PATH der Shell, aus der es gestartet wurde — die
kann Tage alt sein. Deshalb legt `install.ps1` einen Link auf `starship.exe`
neben `cship.exe`: dieses Verzeichnis ist nachweislich im PATH jedes
Prozesses, der überhaupt `cship` ausführen kann.

**`STARSHIP_CONFIG` ist Pflicht.** cship überschreibt den Konfigurationspfad
für den starship-Prozess, den es startet — starships übliche Suche nach
`~/.config/starship.toml` findet also nie statt. Ohne die Variable rendert
Zeile 1 starships Standard-Prompt (`space on  main`) statt der hiesigen
Konfiguration. Ein Link auf `~/.config/starship.toml` hilft dagegen **nicht**;
das ist gemessen, nicht vermutet.

Auch diese Variable ist eine Benutzer-Variable, die ein laufender Prozess
nicht nachlädt. Nach dem ersten `install.ps1` muss Claude Code deshalb aus
einer **neu geöffneten** Shell gestartet werden.

**Die starship-Schlüssel müssen am Dateianfang stehen.** Rutschen `format`
und `add_newline` ans Ende, bindet TOML sie an die zuletzt geöffnete
`[cship.*]`-Sektion, und Zeile 1 fällt wieder aus. Ein Kommentar in der Datei
warnt davor; ein Test prüft es nicht.

## Bekannte PC-Abhängigkeiten

**Der Link auf `~/.config/cship.toml` ist auf diesem PC ein Hardlink**, kein
Symlink — Windows verweigert Symlinks ohne Administratorrechte oder
Entwicklermodus. Ein Hardlink teilt den Inhalt, aber nicht die Identität:
Sobald `git checkout` die Datei im Repo **ersetzt** statt sie zu ändern, zeigt
der Link auf den alten Inhalt weiter. Die Statusline wird dann still veraltet,
ohne Fehlermeldung. Deshalb nach jedem Checkout, der `statusline/cship.toml`
anfasst, `scripts\install.ps1` erneut laufen lassen — es vergleicht Hashes
statt bloßer Existenz und legt den Link neu.

Wer den Entwicklermodus einschaltet, bekommt beim nächsten Lauf einen echten
Symlink und ist das Problem los.

`STARSHIP_CONFIG` enthält einen absoluten Pfad und ist damit rechnerabhängig.
Das Skript setzt ihn bei jedem Lauf neu.

## Warum die Plugin-Manifeste fehlen

`plugins/installed_plugins.json` und `plugins/known_marketplaces.json` sind
bewusst **nicht** versioniert. Es sind Zustandsdateien: absolute
Installationspfade, Zeitstempel, und Einträge für Plugins, die einzelne
fremde Projekte aktiviert haben. Auf einem zweiten PC zeigen die Pfade ins
Leere, und jedes Projekt, das ein Plugin aktiviert, erzeugte einen
Merge-Konflikt.

Versioniert wird stattdessen die *Absicht*: `enabledPlugins` und
`extraKnownMarketplaces` in `settings.json`, beide maschinenunabhängig. Das
Install-Skript stellt den Zustand daraus her.

## Was wo liegt

| Pfad | Inhalt |
|---|---|
| `settings.json` | Nutzereinstellungen, Plugins, Marketplaces, Hooks |
| `CLAUDE.md` | Globale Anweisungen für alle Projekte |
| `statusline/cship.toml` | Statusline — von cship *und* starship gelesen |
| `scripts/install.ps1` | Einrichtung eines neuen PCs, idempotent |
| `scripts/pre-commit.ps1` | Verhindert Commits mit Secrets |
| `scripts/write-cc-version.ps1` | SessionStart-Hook für die Versionsanzeige |
| `scripts/tests/` | Pester-5-Tests zu allem oben |
| `docs/superpowers/` | Specs und Implementierungspläne |

## Agent-Team

Ein Gespann aus dreizehn Rollen (`agents/`) baut einen freigegebenen Plan als
Agent-Team bis zum PR-reifen Feature-Zweig. Entwurf:
`docs/.superpowers/specs/2026-10-08-agent-team-design.md`.

**Voraussetzungen:** git ≥ 2.56, `uv`, und im Projekt eine Datei
`.claude/team-gate` mit einer Zeile: dem Befehl, der das Tor des Projekts
fährt (Tests, Lint, Coverage). Der verifier führt ihn aus.

**Planen** — im Projekt:

```
claude --agent planner --teammate-mode in-process
```

Der planner führt durch Brainstorming, Spec und Plan, lässt beides vom
verifier prüfen, holt die Freigaben ein und committet Spec und Plan auf einem
neuen Feature-Zweig.

**Bauen** — auf dem Feature-Zweig, Arbeitsbaum sauber:

```
pwsh -File "$HOME/.claude/scripts/claude-team.ps1" docs/.superpowers/plans/<plan>.md
```

Der Starter legt `<repo>/.team-runs/<lauf>/` an (von git ignoriert), schreibt
die Settings des Laufs nach `~/.claude/team-settings/` (unversioniert) und
startet den Orchestrator als Lead. Push und Merge bleiben beim Menschen.

- Lead abgestürzt: `claude-team.ps1 -Resume <lauf>`
- Lauf aufgeben und aufräumen: `claude-team.ps1 -Cleanup <lauf>` (Exit 1,
  wenn etwas übrig bleibt)

Die Hooks des Laufs (`scripts/team-gate.py`) prüfen Task-Titel, Urteile und
Torprotokolle und verweigern Push, Merge, `--no-verify` und Löschen mit Zwang.
Sie gelten nur in Sitzungen, die der Starter öffnet.

**Tests:**

```
uv run --no-project --python 3.13 --with pytest --with pytest-cov --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate -q -n 8 --cov=scripts --cov-branch --cov-fail-under=100
```

## Tests

```powershell
Invoke-Pester scripts\tests -Output Detailed
```

Pester 5 oder neuer wird benötigt; das mit Windows gelieferte Pester 3.4.0
genügt nicht:

```powershell
Install-Module Pester -MinimumVersion 5.5.0 -Scope CurrentUser -Force -SkipPublisherCheck
```

Die Statusline-Tests brauchen `starship` im PATH. Nach einer frischen
winget-Installation liegt es nur im Benutzer-PATH, den eine laufende Shell
noch nicht kennt — dann eine neue Shell öffnen.

Code-Coverage wird **nicht** gemessen: Für PowerShell fehlt das Werkzeug in
diesem Setup. Ersatzregel, maschinell geprüft in `Repo.Tests.ps1`: Jedes
Skript unter `scripts/` hat ein Testmodul.
