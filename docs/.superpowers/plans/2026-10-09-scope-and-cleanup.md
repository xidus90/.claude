# Schwere und Aufräumen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nur bestätigte Befunde ab `medium` lösen Runden und Bug-Wurzeln aus, Bytecode blockiert das Aufräumen nicht mehr, und ein neuer Ende-zu-Ende-Lauf belegt beides.

**Architecture:** `check_verdict` in `scripts/teamgate_tasks.py` leitet `fail` nur noch aus bestätigten `defect`s ab `medium` oder widerlegten `claim`s ab. `verdicts.md` definiert die Stufen; Verifier und Orchestrator handeln danach, der Bericht führt `low`-Befunde. Der Starter setzt `PYTHONDONTWRITEBYTECODE=1` in die Settings des Laufs. Ein letzter Task fährt den Ende-zu-Ende-Lauf mit dem Menschen.

**Tech Stack:** Python 3.13 über `uv`, pytest, mypy strict; PowerShell 7 mit Pester 6; Claude Code 2.1.295.

**Spec:** `docs/.superpowers/specs/2026-10-09-scope-and-cleanup-design.md`, Nachtrag zu `docs/.superpowers/specs/2026-10-08-agent-team-design.md` („Hauptspec“).

## Global Constraints

- Python nur über `uv`, nie `pip`. `scripts/team-gate.py` behält seinen PEP-723-Kopf.
- 100 % Zweig-Coverage für `scripts/team-gate.py`, `scripts/teamgate_tasks.py`, `scripts/teamgate_cmd.py`; `mypy --strict` über Code und Tests.
- Testbefehl: `uv run --no-project --python 3.13 --with pytest --with pytest-cov --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate -q -p no:cacheprovider -n 8 --cov=scripts --cov-branch --cov-report=term-missing --cov-fail-under=100`
- Typprüfung: `MYPYPATH="scripts;scripts/tests/teamgate" uvx --python 3.13 --with pytest --with types-PyYAML mypy --strict --explicit-package-bases scripts/team-gate.py scripts/teamgate_tasks.py scripts/teamgate_cmd.py scripts/tests/teamgate`
- Pester: `pwsh -NoProfile -c 'Invoke-Pester -Path scripts/tests -Output Detailed'`. Bekannt rot (nicht anfassen): `tracked content.tracks nothing outside the permitted set`, `global CLAUDE.md.requires specs and plans to live in the project repo`, `statusline rendering.line 1.shows the project folder`, `statusline rendering.line 2.shows the Claude Code version from the cached file`, `statusline rendering.cost.renders in under 250 ms`, `statusline rendering.line 2.shows the peak usage marker`.
- Code, Kommentare, Meldungen, Commits englisch; Plan, Spec, Protokolle deutsch. Commits per Datei und `git commit -F`, nie `Co-Authored-By:`.
- Stufen exakt wie Spec Abschnitt 4: `medium` = verletzt eine Zusage aus Spec oder Plan, liefert bei realistischer Eingabe ein falsches Ergebnis, oder ist eine ausnutzbare Sicherheitslücke; `low` = alles darüber hinaus; eine ausnutzbare Sicherheitslücke ist nie `low`.

## Geprobt beim Planen

Prototyp von Task 1 in einer Kopie von `scripts/` (Scratchpad `proto2/`, Stand `0e5c373` plus Spec-Commit):
- Tests aus Step 1 gegen den heutigen Code: 9 failed, 7 passed — genau die Fälle aus „Expected“ in Step 2.
- Mit dem Code aus Step 3: 549 passed (ohne `test_agents.py`, dem in der Kopie `agents/` fehlt), `teamgate_tasks.py` 100 % Zweige, mypy `Success: no issues found in 8 source files`.
- Task 2 und 3 sind nicht geprobt: eine Zeile PowerShell und Texte.

## Review Focus

1. **Ein widerlegter `claim` der Schwere `low`** (etwa „Tor grün“ mit `low`) muss weiter `fail` erzwingen — sonst ginge ein rotes Tor durch (Test in Task 1).
2. **Schwere fehlt oder ist unbekannt** bei einem bestätigten `defect`: die bestehende Prüfung `severity must be one of …` lehnt das Urteil ab, bevor die Regel greift (bestehender Test; Task 1 prüft, dass er grün bleibt).
3. **`verify:hunt` mit bestätigtem `low`** muss `pass` sein, sonst legt der Orchestrator eine B-Wurzel an (Test in Task 1).
4. **Eine Wurzel, deren jüngstes `verify:review` nur `low` bestätigt,** muss mergen können (Test in Task 1).
5. **Ein Teammate, das Python ohne die Settings des Laufs startet** (etwa ein Unterprozess mit leerer Umgebung), schreibt weiter Bytecode — Grenze, im README genannt (Task 2).

---

### Task 1: Urteilsregel nach Schwere

**Files:**
- Modify: `scripts/teamgate_tasks.py` (`check_verdict`)
- Test: `scripts/tests/teamgate/test_tasks.py` (`test_the_verdict_follows_the_findings`, neue Tests im Abschnitt `# --- verdict rules`)

**Interfaces:**
- Produces: Konstante `BLOCKING = {"medium", "high", "critical"}`; Meldung `verdict must be fail exactly when a defect of severity medium or worse is confirmed or a claim refuted`.

- [ ] **Step 1: Tests schreiben**

`test_the_verdict_follows_the_findings` (Zeilen 288–305) ersetzen durch:

```python
@pytest.mark.parametrize(
    ("kind", "status", "severity", "verdict", "ok"),
    [
        ("defect", "confirmed", "high", "fail", True),
        ("defect", "confirmed", "high", "pass", False),
        ("defect", "confirmed", "medium", "fail", True),
        ("defect", "confirmed", "critical", "fail", True),
        ("defect", "confirmed", "low", "pass", True),
        ("defect", "confirmed", "low", "fail", False),
        ("claim", "refuted", "low", "fail", True),
        ("claim", "refuted", "low", "pass", False),
        ("claim", "refuted", "high", "fail", True),
        ("claim", "refuted", "high", "pass", False),
        ("defect", "refuted", "high", "pass", True),
        ("defect", "refuted", "high", "fail", False),
        ("claim", "confirmed", "high", "pass", True),
        ("claim", "confirmed", "high", "fail", False),
    ],
)
def test_the_verdict_follows_the_findings(world: World, kind: str, status: str, severity: str, verdict: str, ok: bool) -> None:
    world.created("v1", "[verify:final] F")
    verify(world, "v1", "[verify:final] F", world.feature_head, verdict, [settled(world, "F-ver-F1", kind, status, severity=severity)])
    errors = world.completed("v1", "[verify:final] F")
    assert errors == ([] if ok else ["verdict must be fail exactly when a defect of severity medium or worse is confirmed or a claim refuted"])
```

Direkt danach einfügen:

```python
def test_a_hunt_finding_confirmed_as_low_passes(world: World) -> None:
    world.created("vh", "[verify:hunt] B1")
    low = settled(world, "R1-P1-F1", "defect", "confirmed", severity="low")
    verify(world, "vh", "[verify:hunt] B1", world.feature_head, "pass", [low])
    assert world.completed("vh", "[verify:hunt] B1") == []


def test_a_root_whose_review_confirms_only_a_low_finding_merges(world: World) -> None:
    _, head = build(world)
    for sub in ("code", "security"):
        world.created(f"r{sub}", f"[review:{sub}] T1")
        review(world, f"r{sub}", f"[review:{sub}] T1", head, [finding("T1-code-F1", severity="low")] if sub == "code" else [])
        assert world.completed(f"r{sub}", f"[review:{sub}] T1") == []
    world.created("vr", "[verify:review] T1")
    low = settled(world, "T1-code-F1", "defect", "confirmed", severity="low")
    verify(world, "vr", "[verify:review] T1", head, "pass", [low], judges=["rcode", "rsecurity"])
    assert world.completed("vr", "[verify:review] T1") == []
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert world.completed("m", "[merge] T1") == []
```

- [ ] **Step 2: RED zeigen**

Run: `uv run --no-project --python 3.13 --with pytest --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate/test_tasks.py -q -p no:cacheprovider -k "follows_the_findings or confirmed_as_low or only_a_low" > <sdd>/s1-red.txt 2>&1`
Expected: FAIL in allen Fällen, die eine Meldung erwarten (die Meldung hat den neuen Wortlaut), in `("defect", "confirmed", "low", "pass", True)` (alte Regel verlangt `fail`), in beiden neuen Tests (Meldung der alten Regel statt `[]`). `("defect", "confirmed", "low", "fail", False)` FAIL, weil die alte Regel `[]` liefert.

- [ ] **Step 3: Regel**

In `scripts/teamgate_tasks.py` nach `SEVERITIES = {"low", "medium", "high", "critical"}` einfügen:

```python
# A confirmed defect below medium goes to the report, not into a round (scope-and-cleanup spec 5.1).
BLOCKING = {"medium", "high", "critical"}
```

In `check_verdict` die Zeile
`if (kind == "defect" and status == "confirmed") or (kind == "claim" and status == "refuted"):`
ersetzen durch
`if (kind == "defect" and status == "confirmed" and f.get("severity") in BLOCKING) or (kind == "claim" and status == "refuted"):`
und die Meldung
`"verdict must be fail exactly when a defect is confirmed or a claim refuted"`
durch
`"verdict must be fail exactly when a defect of severity medium or worse is confirmed or a claim refuted"`.

- [ ] **Step 4: GREEN und Typen**

Run: Testbefehl und Typprüfung aus Global Constraints `> <sdd>/s1-green.txt`, `> <sdd>/s1-mypy.txt`.
Expected: grün, 100 %, `Success: no issues found`.

- [ ] **Step 5: Mutanten**

`<sdd>/mutants-scope-1.json`, ganze Suite, Vordergrund (Runner `.superpowers/sdd/2026-10-08-agent-team/mutants.py`):
1. ` and f.get("severity") in BLOCKING)` → `)` (jede Schwere zählt)
2. `f.get("severity") in BLOCKING` → `False` (keine Schwere zählt)
3. `BLOCKING = {"medium", "high", "critical"}` → `BLOCKING = {"high", "critical"}` (medium fällt heraus)
4. `or (kind == "claim" and status == "refuted")` → `or False` (widerlegte Claims zählen nicht)
Alle getötet; `check_clean.py` → `clean`.

- [ ] **Step 6: Commit**

```bash
git add scripts/teamgate_tasks.py scripts/tests/teamgate/test_tasks.py
git commit -F <msgfile>   # subject: Fail a verify verdict only on a confirmed medium or worse defect
```

### Task 2: Kein Bytecode in den Worktrees

**Files:**
- Modify: `scripts/claude-team.ps1` (`New-TeamSettings`), `README.md` (Abschnitt „Agent-Team“)
- Test: `scripts/tests/ClaudeTeam.Tests.ps1` (`It 'switches teams and the task tools on and names the run folder'`)

**Interfaces:**
- Produces: Settings-Datei mit `env.PYTHONDONTWRITEBYTECODE = "1"`.

- [ ] **Step 1: Test erweitern**

Im `It 'switches teams and the task tools on and names the run folder'` nach der Zeile mit `TEAM_RUN_DIR` anhängen:

```powershell
        $Settings.env.PYTHONDONTWRITEBYTECODE | Should -Be '1'
```

- [ ] **Step 2: RED zeigen**

Run: `pwsh -NoProfile -c 'Invoke-Pester -Path scripts/tests/ClaudeTeam.Tests.ps1 -Output Detailed' > <sdd>/s2-red.txt 2>&1`
Expected: genau dieser Test rot (`Expected '1', but got $null`).

- [ ] **Step 3: Variable setzen**

In `scripts/claude-team.ps1` nach der Zeile `TEAM_RUN_DIR                         = $runSlash` einfügen:

```powershell
            # pytest in a worktree would leave untracked __pycache__ folders that block git worktree remove.
            PYTHONDONTWRITEBYTECODE              = '1'
```

- [ ] **Step 4: README**

Im Abschnitt `## Agent-Team` von `README.md` vor dem Absatz „Die Hooks des Laufs …“ einfügen:

```markdown
Der Starter setzt `PYTHONDONTWRITEBYTECODE=1` für alle Sitzungen des Laufs,
damit das Tor keine `__pycache__`-Ordner in den Worktrees hinterlässt. Andere
Caches, die das Tor eines Projekts schreibt, gehören in dessen `.gitignore`;
sonst verweigert `git worktree remove` ohne `--force` beim Aufräumen.
```

- [ ] **Step 5: GREEN**

Run: `pwsh -NoProfile -c 'Invoke-Pester -Path scripts/tests/ClaudeTeam.Tests.ps1 -Output Detailed' > <sdd>/s2-green.txt 2>&1` und die volle Pester-Suite `> <sdd>/s2-pester.txt 2>&1`.
Expected: ClaudeTeam ganz grün; volle Suite nur mit den bekannten roten Tests.

- [ ] **Step 6: Gegenprobe**

`'1'` → `'0'` in der neuen Zeile: der Test wird rot; zurück per Edit.

- [ ] **Step 7: Commit**

```bash
git add scripts/claude-team.ps1 scripts/tests/ClaudeTeam.Tests.ps1 README.md
git commit -F <msgfile>   # subject: Keep Python bytecode out of the run's worktrees
```

### Task 3: Stufen, Rollen und Hauptspec

**Files:**
- Modify: `docs/agent-team/verdicts.md`, `agents/verifier.md`, `agents/orchestrator.md`, `docs/.superpowers/specs/2026-10-08-agent-team-design.md`
- Test: `scripts/tests/teamgate/test_agents.py` (laufen lassen)

**Interfaces:**
- Consumes: Regel und Meldung aus Task 1, Variable aus Task 2.

- [ ] **Step 1: `docs/agent-team/verdicts.md`**

Im Abschnitt `## Rules` die zwei Zeilen
```
- **Verify** verdicts carry `verdict`: `fail` exactly when a `defect` is
  `confirmed` or a `claim` is `refuted`, otherwise `pass`. Every finding is
```
(Zeilen 58–59; die Fortsetzung des Punkts ab Zeile 60 bleibt) ersetzen durch
```
- **Verify** verdicts carry `verdict`: `fail` exactly when a `defect` of
  severity `medium`, `high` or `critical` is `confirmed` or a `claim` is
  `refuted`, otherwise `pass`. A confirmed `low` defect goes to the report,
  not into a round. Every finding is
```
und vor `## Rules` einen Abschnitt einfügen:
```
## Severity

- `medium`: breaks a promise of the spec or the plan, gives a wrong result on
  realistic input, or is an exploitable security hole.
- `high`: the same with a large effect (a core promise of the spec, data loss).
- `critical`: code execution, loss or disclosure of data without the user's
  doing, or a run that no longer works at all.
- `low`: everything beyond that — hardening the spec does not ask for, test
  quality, comments, style, input with no realistic cause.

An exploitable security hole is never `low`. The verifier grades anew when it
confirms; its grade is the one that counts.
```

- [ ] **Step 2: `agents/verifier.md`**

Nach dem Satz `Read the verdict rules (`verdicts.md`, path in your spawn prompt) before writing a verdict.` (Zeilen 23–24) anhängen:
```
When you confirm a defect, grade its severity by the levels in `verdicts.md`
yourself; if your grade differs from the finder's, say why in one sentence in
the `claim`.
```
Im Punkt `[verify:final] F` nach dem Satz über `## Parked roots` anhängen:
```
  Every defect confirmed as `low` in the run's verdicts must appear in the
  report's `## Deferred findings (low)`; a missing one is a confirmed `medium`
  defect.
```

- [ ] **Step 3: `agents/orchestrator.md`**

1. Im Hunt-Schritt `Confirmed and not `duplicate_of` → worktree of `B<n>`,` ersetzen durch `A failing `[verify:hunt] B<n>` (a confirmed defect of `medium` or worse, not `duplicate_of`) → worktree of `B<n>`,`; nach dem Satz, der mit „and the chain.“ endet, einfügen: `A confirmed `low` finding gets no root; it goes to the report.`
2. `Stop hunting after two rounds in a row without a new confirmed finding,` ersetzen durch `Stop hunting after two rounds in a row without a new confirmed finding of `medium` or worse,`
3. Im Final-Schritt nach dem Satz zu `## Parked roots` anhängen:
```
   The report also has `## Deferred findings (low)`: one line per defect a
   verify verdict confirmed as `low`, with its id, root and claim.
```
4. Im Review-Schritt die Zeile `A confirmed finding → `[fix:<domain>] W`; none → the root is green.` ersetzen durch `A failing `[verify:review] W` → `[fix:<domain>] W`; a passing one → the root is green (confirmed `low` findings go to the report).`

Jede Stelle vorher mit Grep lesen; ist der Wortlaut anders, die gleichbedeutende Stelle ändern und als Ruling ins Ledger.

- [ ] **Step 4: Hauptspec**

In `docs/.superpowers/specs/2026-10-08-agent-team-design.md`:
1. Abschnitt 5, „Urteile“: `Es ist `fail`, sobald ein `defect` `confirmed` oder ein `claim` `refuted` ist; sonst `pass`.` ersetzen durch `Es ist `fail`, sobald ein `defect` der Schwere `medium`, `high` oder `critical` `confirmed` oder ein `claim` `refuted` ist; sonst `pass`. Ein bestätigter `low`-Befund geht in den Bericht (Nachtrag `2026-10-09-scope-and-cleanup-design.md`, Stufen in `docs/agent-team/verdicts.md`).`
2. Abschnitt 4, Bug-Jagd: `Bestätigt der verifier, beginnt die Kette von `B<n>` mit einem eigenen Worktree.` ersetzen durch `Urteilt der verifier `fail` (bestätigt ab `medium`), beginnt die Kette von `B<n>` mit einem eigenen Worktree; ein bestätigter `low`-Fund geht in den Bericht.`
3. Abschnitt 4, „Runden und Grenzen“: `keinen neuen bestätigten Fund` ersetzen durch `keinen neuen bestätigten Fund ab `medium``.
4. Abschnitt 7, Starter: im `env` der Settings `PYTHONDONTWRITEBYTECODE=1` ergänzen (die Stelle per Grep nach `TEAM_RUN_DIR` im Abschnitt finden).
5. Abschnitt 8, Aufräumen: Satz anhängen `Bytecode verhindert der Starter (`PYTHONDONTWRITEBYTECODE`); andere Caches des Tors gehören in die `.gitignore` des Projekts.`

- [ ] **Step 5: Prüfen**

Run: Testbefehl aus Global Constraints `> <sdd>/s3-green.txt`. Expected: grün bei 100 %.
Grep: `Deferred findings (low)` in `agents/orchestrator.md` und `agents/verifier.md`; `## Severity` in `verdicts.md`; `PYTHONDONTWRITEBYTECODE` in Hauptspec, README und `claude-team.ps1`. Grep nach dem alten Wortlaut `a defect is confirmed` und `defect` `confirmed` oder in `agents/`, `docs/agent-team/` und der Hauptspec: kein Treffer mehr, der die alte Regel beschreibt.

- [ ] **Step 6: Commit**

```bash
git add docs/agent-team/verdicts.md agents/verifier.md agents/orchestrator.md docs/.superpowers/specs/2026-10-08-agent-team-design.md
git commit -F <msgfile>   # subject: Define the severity levels and act only on medium or worse
```

### Task 4: Ende-zu-Ende-Lauf (Controller mit dem Menschen)

**Files:**
- Create: `docs/.superpowers/smoke/2026-10-09-ende-zu-ende-2.md`
- Temporär: Junction `~/.claude/agents` → `agents/` des Worktrees `~/.claude/.worktrees/agent-team` (legt der Mensch an); Spielzeug-Repo `<scratchpad>/e2e-repo-2`

- [ ] **Step 1: Stand bereitstellen**

Der Mensch spult `feat/agent-team` auf den Stand nach Task 3 vor (`git -C C:/Users/micro/.claude/.worktrees/agent-team merge --ff-only <dieser zweig>`) und legt die Junction an:
`New-Item -ItemType Junction -Path "$HOME/.claude/agents" -Target "$HOME/.claude/.worktrees/agent-team/agents"`

- [ ] **Step 2: Spielzeug-Repo**

`<scratchpad>/e2e-repo-2` mit denselben Dateien wie Task 6 Step 4 des Agent-Team-Plans (`money.py` mit Rest-Bug, `test_money.py`, `.claude/team-gate`, Spec und Plan `money`), ohne `.gitignore`; `git init -b main`, Nutzer `t@example.org`/`T`, Commit `init`, Zweig `feat/money`; Tor einmal grün fahren.

- [ ] **Step 3: Der Lauf (Mensch)**

Windows Terminal, im Spielzeug-Repo:
`pwsh -File "$HOME/.claude/.worktrees/agent-team/scripts/claude-team.ps1" docs/.superpowers/plans/money.md`
Fragt der Orchestrator zum `shell=True`: „Wörtlich wie im Plan“. Hängt eine Wurzel fest: parken. Start- und Endzeit notieren.

- [ ] **Step 4: Ergebnis prüfen**

Prüfpunkte der Hauptspec 12.5 und Spec Abschnitt 7: `final`, `verify:final`, `[cleanup]` abgeschlossen; der Bericht unter `docs/.superpowers/reports/` trägt „Parked roots“ und „Deferred findings (low)“; danach `git worktree list` nur der Hauptbaum, `git branch --list "team/*"` leer, kein `.team-runs/`, keine Settings-Datei unter `~/.claude/team-settings/`; kein Worktree blieb an `__pycache__` hängen.

- [ ] **Step 5: Kosten**

`tokens.py` und `cost.py` aus dem Scratchpad der Sitzung vom 2026-10-09 (Kopie in den aktuellen Scratchpad) über das Lead-Transkript, seine `subagents/` und die Projektordner der Worktrees des Laufs; Tabelle je Rolle, daneben die Zahlen vom 2026-10-09 ($45,62, rund 4 h 30 min).

- [ ] **Step 6: Aufräumen und Protokoll**

Junction entfernt der Mensch: `(Get-Item "$HOME/.claude/agents").Delete()`. Protokoll `docs/.superpowers/smoke/2026-10-09-ende-zu-ende-2.md` (deutsch): Versionen, Ablauf, Eingriffe, jeder Prüfpunkt mit Beleg, Kosten und Dauer gegen den ersten Lauf. Fällt ein Prüfpunkt durch: nicht reparieren, sondern festhalten und dem Menschen vorlegen.

```bash
git add docs/.superpowers/smoke/2026-10-09-ende-zu-ende-2.md
git commit -F <msgfile>   # subject: Record the second end-to-end run of the agent team
```
