# Schwere begrenzt die Runden, Bytecode blockiert das Aufräumen nicht mehr

Stand 2026-10-09. Nachtrag zu `docs/.superpowers/specs/2026-10-08-agent-team-design.md`
(im Folgenden „Hauptspec“). Anlass sind Befund 2 und 3 aus
`docs/.superpowers/smoke/2026-10-08-ende-zu-ende.md`.

## 1. Problem

**Befund 3, Ausufern.** Im Ende-zu-Ende-Lauf vom 2026-10-09 löste jeder
bestätigte Befund eine Fix-Runde oder eine Bug-Wurzel aus, gleich welcher
Schwere. Aus den 98 Befundeinträgen in den Urteilen des Laufs (Auswertung des
gesicherten Laufordners):

- T1 bekam zwei Härtungsrunden aus zwei `low`-Befunden zur Eingabelänge
  (`T1-sec-F1`, `T1-code-F1`), die der Plan nicht verlangt.
- T2 bekam nach dem echten Fund (`T2-sec-F1`, `medium`: Steuerzeichen im
  Namen) einen zweiten Fix für `T2-code-F2` (`low`: rohe unsichtbare Zeichen
  in Testquellen). Der Fix baute einen Wächtertest.
- Der bug-hunter fand in diesem Wächtertest eine Lücke (`R1-P2-F1`, `low`);
  daraus wurde B3, und die Reviews von B3 brachten sechs weitere Befunde zu
  genau diesem Wächter, fünf als `low` gemeldet, einer als `medium`, den der
  verifier als `low` bestätigte. B3 lief drei Runden und wurde aufgegeben.

Die Hauptspec sagt in Abschnitt 5: Ein `verify`-Urteil ist `fail`, sobald ein
`defect` `confirmed` ist. Die Schwere spielt keine Rolle, und keine Rolle
kennt eine Definition der Stufen.

**Befund 2, Aufräumen.** Das Tor (`uv run … pytest`) legt `__pycache__/` in
den Worktrees an. Ohne passende `.gitignore` des Projekts sind die Ordner
ungetrackt, und `git worktree remove` ohne `--force` verweigert. Im Lauf
blieb so der Worktree `B2` stehen. `.pytest_cache` stört nicht, weil pytest
dort eine eigene `.gitignore` anlegt.

## 2. Ziel

Ein Lauf behebt echte Fehler und hält alles darunter nur im Bericht fest.
Ein neuer Ende-zu-Ende-Lauf mit demselben Spielzeug-Plan kommt bis `final`
und `cleanup` durch, ohne Härtungsrunden über den Plan hinaus, und hinterlässt
keinen Worktree.

## 3. Entscheidungen

1. **Nur `medium` und höher löst eine Runde aus.** Ein bestätigter `defect`
   der Schwere `low` macht kein Urteil `fail`, löst keinen Fix und keine
   B-Wurzel aus und steht im Bericht.
2. **Der verifier entscheidet die Schwere.** Beim Bestätigen vergibt er die
   Stufe neu, herauf oder herab; der Hook rechnet mit seiner Einstufung.
3. **Widerlegte Claims bleiben `fail`,** unabhängig von der Schwere (etwa
   „Tor grün“, „eigene Commits unverändert“).
4. **Bytecode verhindert der Starter,** nicht der cleaner: Die Settings des
   Laufs setzen `PYTHONDONTWRITEBYTECODE=1`.

## 4. Die Stufen

In `docs/agent-team/verdicts.md`, für alle Rollen:

- **`medium`**: verletzt eine Zusage aus Spec oder Plan, liefert bei
  realistischer Eingabe ein falsches Ergebnis, oder ist eine ausnutzbare
  Sicherheitslücke.
- **`high`**: dasselbe mit großer Wirkung (etwa ein Kernversprechen der Spec,
  Datenverlust).
- **`critical`**: Codeausführung, Verlust oder Preisgabe von Daten ohne
  Zutun des Nutzers, oder ein Lauf, der gar nicht mehr funktioniert.
- **`low`**: alles darüber hinaus — Härtung über die Spec hinaus,
  Testqualität, Kommentare, Stil, Eingaben ohne realistischen Anlass.

Eine ausnutzbare Sicherheitslücke ist nie `low`.

## 5. Mechanismus

### 5.1 Die Urteilsregel im Hook

`check_verdict` in `scripts/teamgate_tasks.py` leitet heute `fail` ab, wenn
ein `defect` `confirmed` oder ein `claim` `refuted` ist. Neu:

> Ein `verify`-Urteil ist genau dann `fail`, wenn ein `defect` mit Schwere
> `medium`, `high` oder `critical` `confirmed` ist oder ein `claim` `refuted`
> ist.

Das gilt für alle Urteile mit `verdict`: `verify:impl`, `verify:fix`,
`verify:review`, `verify:rebase`, `verify:hunt`, `verify:final`. Die Meldung
bei Widerspruch nennt die neue Regel.

### 5.2 Folgen für den Lauf

- `verify:review` mit nur bestätigten `low`-Befunden ist `pass`: die Wurzel
  ist grün und kann gemergt werden.
- `verify:hunt` mit einem bestätigten `low`-Befund ist `pass`: der
  Orchestrator legt keine B-Wurzel an. Eine B-Wurzel entsteht nur aus einem
  `verify:hunt`, das `fail` urteilt.
- Die Jagd endet nach zwei Runden ohne neuen bestätigten Befund ab `medium`
  (bisher: ohne neuen bestätigten Befund).
- `final` prüft wie bisher, dass das jüngste `verify`-Urteil jeder Wurzel
  nicht `fail` ist; das ist jetzt mit `low`-Befunden erfüllbar.

### 5.3 Rollen

- **code-reviewer, security-reviewer, bug-hunter:** vergeben die Stufe nach
  Abschnitt 4 und verweisen dafür auf `verdicts.md`.
- **verifier:** vergibt beim Bestätigen die Stufe neu; jede Abweichung von der
  Stufe des Befundgebers begründet er in einem Satz im `claim`.
- **orchestrator:** legt Fix und B-Wurzel nur bei `fail` an; der Bericht
  bekommt den Abschnitt `## Deferred findings (low)` mit jeder bestätigten
  `low`-Kennung, ihrer Wurzel und einem Satz.
- **verifier bei `verify:final`:** prüft, dass jede bestätigte `low`-Kennung
  aus den Urteilen im Abschnitt steht; eine fehlende ist ein bestätigter
  `medium`-Befund.

### 5.4 Starter

`New-TeamSettings` in `scripts/claude-team.ps1` setzt im `env` der Settings
zusätzlich `PYTHONDONTWRITEBYTECODE = '1'`. Über denselben Weg erreicht
`TEAM_RUN_DIR` jeden Teammate und seine Bash- und PowerShell-Aufrufe
(Rauchtest 4). Die README sagt im Abschnitt „Agent-Team“ in einem Satz, dass
andere Caches, die das Tor schreibt, in die `.gitignore` des Projekts gehören.

## 6. Tests

- Hook: ein `verify:review` mit nur einem bestätigten `low`-`defect` und
  `pass` wird angenommen, mit `fail` abgelehnt; mit einem bestätigten
  `medium`-`defect` umgekehrt; ein widerlegter `low`-`claim` verlangt `fail`.
- Hook: `verify:hunt` mit bestätigtem `low` und `pass` wird angenommen.
- Hook: eine Wurzel mit einem `low`-Befund im jüngsten `verify:review` wird
  grün und `[merge]` geht durch.
- Starter: `env.PYTHONDONTWRITEBYTECODE` ist `'1'`.
- Mutanten je Regel einzeln, insbesondere „jede Schwere zählt“ und „keine
  Schwere zählt“.

## 7. Ende-zu-Ende-Lauf

Als letzter Task, mit dem Menschen:

- Frisches Spielzeug-Repo im Scratchpad, derselbe Plan und dieselbe Spec wie
  am 2026-10-09 (Task 6 des Agent-Team-Plans), weiter ohne `.gitignore`.
- Fragt der Orchestrator zum `shell=True` im Plan, antwortet der Mensch
  „Wörtlich wie im Plan“, damit der security-reviewer den Fund liefern muss.
- Prüfpunkte: die aus Hauptspec 12.5; dazu `final`, `verify:final` und
  `[cleanup]` abgeschlossen; der Bericht trägt „Parked roots“ und „Deferred
  findings (low)“; danach nur der Hauptbaum in `git worktree list`, kein
  `team/*`-Zweig, kein `.team-runs/`, keine Settings-Datei.
- Gemessen: Dauer und Kosten je Rolle mit `tokens.py` und `cost.py` wie am
  2026-10-09; das Protokoll stellt beide Läufe gegenüber.
- Hängt eine Wurzel fest, wird sie geparkt; ein Abbruch ist die letzte Wahl
  und kommt ins Protokoll.

## 8. Nicht in diesem Nachtrag

- Kosten des Orchestrators (am 2026-10-09 rund 72 Mio. Cache-Lesetoken).
- Caches anderer Sprachen und Werkzeuge.

## 9. Änderungen an der Hauptspec

Der Plan trägt den Nachtrag ein in: Phase 2 und „Runden und Grenzen“
(Abschnitt 4: Bug-Wurzel nur aus `fail`, Ende der Jagd), Urteile
(Abschnitt 5: Regel für `fail`, Stufen mit Verweis auf `verdicts.md`), Starter
(Abschnitt 7: `PYTHONDONTWRITEBYTECODE`), Aufräumen (Abschnitt 8: Satz zu
Caches), Tests (Abschnitt 12) und Grenzfälle (Abschnitt 15).
