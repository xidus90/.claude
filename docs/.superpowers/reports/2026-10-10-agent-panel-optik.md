# Bericht: Agent-Panel Optik

Plan: `docs/.superpowers/plans/2026-10-09-agent-panel-optik.md`
Lauf: `20261009-232002`, Generationen 1–3, Feature-Zweig
`claude/untitled-session-a838d0`.

## Ergebnis

Alle sieben Plan-Tasks und alle bestätigten Bugs der Bug-Suche sind auf dem
Feature-Zweig. Das Tor (`.claude/team-gate`: `npm ci`, `npm test`,
`npm run typecheck`) ist grün: 181 Node-Tests, 100 % Zeilen, Zweige und
Funktionen. Die Kit-Tests (`npm run kit`) laufen 33/33, die Pester-Tests des
Starters 38/38 (dreimal hintereinander).

Push und Pull Request liegen beim Menschen.

## Ablauf

- **Generation 1 und 2** wurden nach rund einer Minute beendet: Ein `-Resume`
  über `!` neben dem noch lebenden Lead hätte zwei Leads auf einem Lauf
  ergeben. Generation 3 lief durch bis zum Nutzungslimit des Kontos am
  10.10. um 10:19.
- **Ab dort von Hand** in einer Sitzung ohne Team-Hooks: Das Konto des Leads
  hatte keine Tokens mehr. Die Prüfschritte (Repro rot, Fix, Repro grün, Tor)
  liefen von Hand; unabhängige verifier und Reviews gab es für diese Commits
  nicht.

## Plan-Tasks

| Root | Inhalt | Runden |
|---|---|---|
| T1 | Effort durch die Pipeline | 1 |
| T2 | Anzeige-Daten | 1 |
| T3 | Krabben und Kostüme | 2 |
| T4 | Zeichnungen (SVG, Raster, Balken) | 4 |
| T5 | Öffnungsregeln | 4 |
| T6 | Verdrahtung im Mod | 5 |
| T7 | README und Rauchtest | 1 |

## Bug-Suche (Runde 1)

17 Funde, daraus B1–B23. Merges durch den Lead: B1, B5, B12, B13, B14, B17,
B18, B23. Von Hand fertiggestellt:

| Bug | Kern | Commit |
|---|---|---|
| B3 | Steuerzeichen in Namen leerten das Panel | `0701158` … `b095491` |
| B2 | `null`-Kosten oder fehlende Felder leerten das Panel; Uhr-Fehler zeigt eine eigene Warnung statt `⚠ Grafik` | `4da6371` |
| B4 | mehrzeiliges stderr als Hinweis | durch B3 behoben, Test in `906fd35` |
| B6 | Lead-Karte zuerst in einer normalen Sitzung | `906fd35` |
| B7 | Rolle `lead`/`agents` landete in der Lead-Karte | `906fd35` |
| B8 | Claude-3.x-Modellnamen | `906fd35` |
| B15 | kaputter Cache-Eintrag blieb für immer | `45ad214` |
| B20 | Zeitstempel als Objekt warf bei jedem Takt | `45ad214` |
| B16 | Cache-Schreiben folgte einem untergeschobenen Link; fehlender Elternordner | `b717bd7` … `dfda0ac` |
| B9 | ungezeichneter Pane wurde von `/agent-panel` geschlossen statt gezeigt | `f15dcb6` |
| B11 | Terminal schnitt große Karten stumm ab | `f15dcb6` |
| B21 | quadratische Regex in `modelKey` | `e4dee90` |
| B22 | Cache-Ordner und -Datei für andere lesbar | durch B16 (`0o700`/`0o600`, POSIX-Test) |

Widerlegt: B10 (zweiter `session.start` auf einer Modulinstanz kommt im Motor
nicht vor). Duplikat: B19 von B16.

## Außerhalb des Plans

- `64dd5e2`: Das Panel bepreist Advisor-Aufrufe (`usage.iterations`) mit dem
  Modell des Advisors; vorher fehlten sie in den errechneten Kosten.
  Cache-Version 3.
- `01b5ac4`, `ba9a42a`: `claude-team.ps1 -Resume` verweigert, solange ein
  Prozess mit einer Sitzungs-ID des Laufs läuft.
- `3bedc98`: Plansatz zu den unteren Halbblöcken richtiggestellt.

## Offen

- **Rauchtest Schritt 5** (Panel interaktiv ansehen) steht beim Menschen aus.
- **Bug-Suche Runde 2** lief nicht; die Regel des Orchestrators verlangt zwei
  Runden ohne neuen Fund.
- **Gegenprobe der Resume-Sperre** (Sperre aus, Test rot) wurde vom
  Auto-Modus abgelehnt; der Test scheitert ohne die Sperre aber zwangsläufig
  (Exit 0, Generation 2).
- **Bekannte Grenzen**, im Code mit `ponytail:` markiert: Die Zeilengrenze gilt
  je Karte, nicht je Pane (B11); ein Cache-Eintrag, der beschädigt ist, ohne zu
  werfen, bleibt vertraut (B15).
- **Liegen gelassen:** `.team-runs/20261009-232002/` (Urteile, Belege) und
  `~/.claude/team-settings/untitled-session-a838d0-20261009-232002.json`.
  Worktrees und alle 26 `team/20261009-232002/*`-Zweige sind entfernt.

## Kosten

Laut Panel rund 336 $ bis zum Limit, davon 1,27 $ für die abgebrochenen
Generationen 1 und 2. Die Zahl enthält keine Advisor-Aufrufe (vor
`64dd5e2`). Die Arbeit von Hand danach lief auf einem anderen Konto.
