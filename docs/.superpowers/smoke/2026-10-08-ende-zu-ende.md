# Ende-zu-Ende-Lauf und Rauchtests 13–14 (2026-10-09)

Task 6 des Plans `docs/.superpowers/plans/2026-10-08-agent-team.md`.

- Claude Code 2.1.295, git 2.56.0.windows.2 (Bash und PowerShell), PowerShell 7.6.6, uv 0.12.16
- Definitionen live über die Junction `~/.claude/agents` → `~/.claude/.worktrees/agent-team/agents` (Stand `b0d90b7`)
- Spielzeug-Repo im Scratchpad der Controller-Sitzung (`e2e-repo`), Plan und Spec wie in Task 6 Step 4
- Lauf `20261009-113117`, Lead-Sitzung `2f6c9657…`, Start 11:31:17, vom Menschen abgebrochen gegen 16:00 (letzter Eintrag im Lead-Transkript 16:01)

## Rauchtest 13 — git 2.56 für den cleaner

Bestanden. Skript `rt13.ps1` aus Task 6 Step 2, Ausgabe:

```
--- 1: worktree remove without --force on a clean detached worktree
exit 0
--- 2: dry run while T1 is still checked out (expected: T1 skipped or listed?)
exit 0
--- 3: dry run after the worktrees are gone (expected: only team/r/T1)
Would delete branch team/r/T1 (was 37a5fba).
exit 0
--- 4: the real run
Deleted branch team/r/T1 (was 37a5fba).
exit 0
--- 5: what is left (expected: team/r/T2)
  team/r/T2
```

Abschnitt 2: git überspringt den ausgecheckten, gemergten Zweig still, wie
Spec Abschnitt 2 Punkt 11 annimmt. Kein Rückfall für `agents/cleaner.md`.

## Rauchtest 14 — `-Cleanup` ohne Rückfrage

Bestanden (43 s). Probelauf `rt14` mit Worktree `T1` und gemergtem Zweig
`team/rt14/T1`; `claude-team.ps1 -Cleanup rt14` endete mit Exit 0 ohne
Rückfrage. Danach: nur der Hauptbaum in `git worktree list`, kein
`team/*`-Zweig, Laufordner und Settings-Datei weg. Der Bericht des cleaners
kam auf der Konsole an (seit dem Fix in Task 5). Kein Rückfall
(`--allowedTools`) nötig.

## Der Lauf

### Was geschah

| Wurzel | Ergebnis | Runden |
|---|---|---|
| T1 `parse_amount` | gemergt | 3 (zwei Fix-Runden: Eingabelänge begrenzen, führende Nullen nicht mitzählen) |
| T2 Quittung | gemergt | 3 (zwei Fix-Runden: Steuerzeichen im Namen maskieren, unsichtbare Zeichen in Testquellen als Escapes) |
| B1 Rest von `split_evenly` | gemergt | 1 |
| B2 `parts < 1` | gemergt | 1 |
| B3 Wächter `test_sources.py` gegen unsichtbare Zeichen | vom Menschen aufgegeben nach 3 Runden | 3 |

Hunt: Runde 1 mit zwei Partitionen (`money.py`, `receipt.py`) fand B1, B2,
B3; Runde 2 war angelegt, als der Lauf abbrach.

### Eingriffe des Menschen

Der Orchestrator fragte dreimal per AskUserQuestion (`asks.py` über das
Lead-Transkript; Zeiten in Ortszeit):

1. 11:37 — Plan-Task 2 schreibt `shell=True` mit einem Namen aus Nutzerhand
   vor. Antwort: „Ohne Shell“. Damit lief der eingebaute Sicherheitsfund nie
   in den Code (siehe Prüfpunkt 3).
2. 15:07 — B3 vor seiner vierten Runde. Antwort: „B3 aufgeben“.
3. 15:15 — `[final]` vom Hook abgelehnt: B3 hat kein abgeschlossenes
   `[merge]`, sein jüngstes `verify`-Urteil ist `fail`, und das Tor kennt
   kein Parken einer Wurzel. Antwort: „Ich passe Gate/Register an“.

Danach lief der Lauf weiter (Hunt Runde 2, ein zweites `[merge] B3`), bis
der Mensch ihn gegen 16:00 wegen der Dauer abbrach.

### Prüfpunkte aus Spec 12.5

| Punkt | Ergebnis | Beleg |
|---|---|---|
| T2 startet erst nach `[merge] T1` | erfüllt | `[impl:ux] T2` im Register mit `base_head` `e8460bb` = gemergter T1-HEAD |
| beide Tasks auf `feat/money` | erfüllt | `git log feat/money`: `5942187`, `782194f`, `e8460bb` (T1), `21fc797`, `c4586c7`, `bb4fb7b` (T2) |
| security-reviewer meldet `shell=True`, verifier bestätigt, `[fix] T2`, Merge nach grünen Reviews | erfüllt mit anderem Fund | `shell=True` kam nie in den Code (Eingriff 1). Statt dessen: beide Reviewer meldeten Steuerzeichen im Namen (`g1-20.json`, `g1-21.json`), der verifier bestätigte per Probe (`g1-22.json`, `fail`), `[fix:ux] T2 Neutralise control characters …`, danach grüne Reviews und Merge |
| bug-hunter findet den Rest-Bug, `verify:hunt B1` bestätigt, Kette von B1 läuft durch | erfüllt | `[verify:hunt] B1`, `[merge] B1`; `split_evenly` auf `feat/money` verteilt den Rest per `divmod` (`[share + 1] * extra + [share] * (parts - extra)`) |
| `final` grün, Bericht stimmt | **nicht erreicht** | `[final]` vom Hook abgelehnt (Eingriff 3), kein Bericht unter `docs/.superpowers/reports/` |
| nach dem Lauf alles aufgeräumt | **nicht erreicht im Lauf**; nachträglicher `-Cleanup` siehe unten | — |

### Aufräumen nach dem Abbruch

`claude-team.ps1 -Cleanup 20261009-113117` (58 s) endete mit Exit 1 und
listete die Reste. Der cleaner entfernte sieben Worktrees ohne `--force`
und hielt bei zwei an:

- `B2`: ungetrackt `__pycache__/` — vom Tor (pytest) erzeugt; das Spielzeug-Repo hat keine `.gitignore`
- `R2.P2`: zwei ungetrackte Repro-Tests des abgebrochenen Hunters

Danach blieben die Zweige B1, B2, T1, T2 (gemergt) und B3 (ungemergt, wie
gewollt), der Laufordner und die Settings-Datei. Das Schutzverhalten
stimmt; die Lücke ist, dass Bytecode des Tors einen Worktree blockiert.

## Befunde

1. **Kein Weg, eine Wurzel aufzugeben** (blockierend). Der Orchestrator darf
   vor einer vierten Runde fragen, und der Mensch darf aufgeben — aber
   `check_final` verlangt für jede Wurzel mit `impl`/`fix`-Task ein
   abgeschlossenes `[merge]` und ein nicht-`fail` jüngstes Urteil
   (`scripts/teamgate_tasks.py`, `roots`/`check_final`). Eine aufgegebene
   Wurzel hält `[final]` für immer. Spec und Tor brauchen eine Form „Wurzel
   geparkt“ (z. B. ein Register-Ereignis, das nur der Mensch über den
   Starter oder das Gate-CLI setzt), die `final` erlaubt und im Bericht
   steht.
2. **Bytecode des Tors blockiert das Aufräumen.** pytest legt `__pycache__/`
   in Worktrees an, `git worktree remove` ohne `--force` weigert sich. Abhilfe:
   der Starter legt beim Anlegen des Laufs `PYTHONDONTWRITEBYTECODE=1` in das
   `env` der Settings, oder der cleaner darf `__pycache__` gezielt entfernen.
3. **Ausufern über den Plan hinaus.** B3 war ein vom bug-hunter erfundener
   Wächter gegen unsichtbare Zeichen in Testquellen, der drei Runden lang
   gehärtet wurde; T1 bekam zwei Härtungsrunden gegen riesige Eingaben, die
   der Plan nicht verlangt. Die Rollen prüfen gegen ihr eigenes Ideal, nicht
   gegen den Plan. Abhilfe: Funde außerhalb von Plan und Spec als `minor`
   einstufen und nicht als neue Wurzel anlegen, ohne den Menschen zu fragen.
4. **Dauer.** Etwa 4 h 30 min für zwei kleine Tasks.

## Kosten je Rolle

Token aus dem Lead-Transkript, den Transkripten der In-process-Teammates
unter `<sitzung>/subagents/` und sieben weiteren Sitzungen, die in Worktrees
des Laufs starteten (`tokens.py`, gegenüber Task 6 Step 8 um diese Ordner
erweitert und um doppelt geloggte Antworten bereinigt). Listenpreise aus dem
Skill `claude-api` (Stand 2026-10-06): Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10
je Million Token, Cache-Lesen $0,20; Cache-Schreiben mit 1,25 × Eingabe
(5-Minuten-TTL) gerechnet.

| Rolle | Modell | Kosten $ | davon Cache-Schreiben $ |
|---|---|---|---|
| orchestrator (lead) | Opus 5.5 | 19,21 | 2,25 |
| verifier | Opus 5.5 | 11,35 | 4,82 |
| security-reviewer | Opus 5.5 | 3,76 | 2,58 |
| code-reviewer | Opus 5.5 | 3,28 | 2,38 |
| implementer (fix) | Sonnet 5.5 | 2,41 | 1,39 |
| implementer | Sonnet 5.5 | 2,01 | 0,86 |
| bug-hunter | Opus 5.5 | 1,81 | 1,09 |
| Sitzungen in Worktrees | Opus 5.5 | 1,81 | 1,55 |
| **Summe** | | **45,62** | 16,91 |

Mit 1-Stunden-TTL (2 × Eingabe) kämen etwa $10 hinzu. Der Lead allein las
72,7 Mio. Token aus dem Cache. Die Schätzung aus Spec Abschnitt 3 ($17,60 je
Plan-Task ohne Fix-Runde, also $35,20 für zwei Tasks) lag ohne Fix-Runden
und Bug-Ketten in derselben Größenordnung; der Lauf hatte vier Fix-Runden
für T1/T2, drei Bug-Wurzeln und brach vor `final` ab.
