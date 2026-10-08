# Agent-Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Agenten-Gespann unter `~/.claude` — dreizehn Rollendefinitionen, ein fail-closed Hook-Tor `team-gate.py` mit Befehlsprüfung und ein Starter `claude-team.ps1` —, das einen freigegebenen Plan als Agent-Team bis zum PR-reifen Feature-Zweig baut.

**Architecture:** Der Orchestrator läuft als Lead (`claude --agent orchestrator`) und verteilt Team-Tasks; jede Wurzel (`T<n>`, `B<n>`, `F`) hat einen eigenen Worktree unter `<repo>/.team-runs/<lauf>/`. Harte Tore sitzen in Hooks, die nur die Settings-Datei des Laufs lädt: `TaskCreated`/`TaskCompleted` prüfen Titel, Register, Urteile und Torprotokolle, `PreToolUse` parst Bash- und PowerShell-Befehle. Rauchtests klären vorab, was die Doku offen lässt.

**Tech Stack:** Python 3.13 (nur stdlib) über `uv run --script`; pytest, pytest-cov, pytest-xdist, PyYAML über `uv run --with`; mypy über `uvx`; PowerShell 7 mit Pester 6.1; git ≥ 2.56; Claude Code 2.1.293.

**Spec:** `docs/.superpowers/specs/2026-10-08-agent-team-design.md`, einschließlich Entscheidung 6 in Abschnitt 14 und Nachtrag Abschnitt 15.

## Global Constraints

- git **≥ 2.56.0** für Starter, Rauchtest 13 und Ende-zu-Ende. Installiert ist am 2026-10-08 `2.54.0.vfs.0.4`; der Mensch aktualisiert vor Task 6 (`winget upgrade --id Git.Git`). Die Pester-Tests mocken die Version und brauchen kein 2.56.
- Python nur über `uv`, nie `pip`. `team-gate.py` hat einen PEP-723-Kopf ohne Abhängigkeiten, `requires-python = ">=3.13"`. Hook-Aufruf: `uv run --script "<scripts>/team-gate.py" --run "<lauf>" <ereignis>`, Timeout 30 s.
- 100 % Zweig-Coverage für `scripts/team-gate.py`, `scripts/teamgate_tasks.py`, `scripts/teamgate_cmd.py`; ein Ausschluss nur mit `# pragma: no cover - <Grund>`. `mypy --strict` über Code **und** Tests ohne `Any` und ohne `type: ignore`.
- Testbefehl Python (aus dem Repo-Wurzelverzeichnis):
  `uv run --no-project --python 3.13 --with pytest --with pytest-cov --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate -q -p no:cacheprovider -n 8 --cov=scripts --cov-branch --cov-report=term-missing --cov-fail-under=100`
- Typprüfung: `MYPYPATH="scripts;scripts/tests/teamgate" uvx --python 3.13 --with pytest --with types-PyYAML mypy --strict --explicit-package-bases scripts/team-gate.py scripts/teamgate_tasks.py scripts/teamgate_cmd.py scripts/tests/teamgate` (Trenner `;`, Windows).
- Pester: `pwsh -NoProfile -c 'Invoke-Pester -Path scripts/tests -Output Detailed'`. **Vorbestand, schon vor diesem Plan rot** (nicht anfassen, keine neuen dazu): `tracked content.tracks nothing outside the permitted set`, `global CLAUDE.md.requires specs and plans to live in the project repo`, `statusline rendering.line 1.shows the project folder`, `statusline rendering.line 2.shows the Claude Code version from the cached file`, `statusline rendering.cost.renders in under 250 ms`.
- Rümpfe und Beschreibungen der Rollen sowie `docs/agent-team/verdicts.md` englisch (sie instruieren ein LLM, Spec Abschnitt 3). Code, Bezeichner, Meldungen, Commits englisch. Code-Kommentare immer englisch (Regel des Nutzers, globale `CLAUDE.md`). Plan, Protokolle, README-Abschnitt deutsch.
- Commits: Betreff englisch, mehrzeilige Nachrichten per Write in eine Datei und `git commit -F <datei>`. **Kein `Co-Authored-By`**, keine Werbezeile (globale CLAUDE.md schlägt den Werkzeug-Vorgabetext). Vor jedem Commit `git branch --show-current` ist `feat/agent-team` und `git diff --cached --name-only` nennt genau die Dateien des Tasks — jeweils als eigener Aufruf.
- Nie `python -`/Heredoc an einen Interpreter, nie Backslashes in Heredoc oder `sed`: Dateien mit Backslashes nur per Write/Edit. Prozesse nur per PID beenden. Kein `git stash` (geteilt mit anderen Sitzungen).
- Rollen nennen Skills im Rumpf als „invoke `<name>`“, nie über einen Plugin-Pfad.

## Review Focus

1. **Repo-Pfad mit Leerzeichen und Umlaut** (`C:/Users/x/Prüf Repo`): Hook-Nutzlast kommt UTF-8 über stdin, Pfade laufen durch `realpath`. Erwartet: alle Tore und die Befehlsprüfung verhalten sich wie im ASCII-Pfad. Abgedeckt in Task 2: Die Test-Welt liegt immer unter `Prüf Repo`, und `test_the_script_runs_as_a_hook_process` schickt eine Nutzlast mit Umlaut durch den echten Prozess.
2. **Ein Hook stirbt mit gehaltener Sperre** (Timeout von Claude Code, Absturz). Ohne Gegenmittel endet jeder spätere Hook nach 10 s mit Exit 2, der Lauf steht. Erwartet: eine Sperrdatei, älter als 60 s, wird gebrochen. Abgedeckt in Task 2: `test_a_stale_lock_is_broken`.
3. **Ein Urteil wird nach dem Abschließen umgeschrieben** (ein Teammate „verbessert“ seine Datei). Erwartet: `merge` und `final` lesen den Stand der Datei und lassen ein nachträglich falsches Trio nicht durch. Abgedeckt in Task 2: `test_a_verdict_rewritten_after_completion_does_not_stay_green`.
4. **Pfade über Junction oder 8.3-Kurzname** in Befehlen (`C:/Users/MICRO~1/…`, eine Junction in den Laufordner). Erwartet: Löschen im Laufordner bleibt erlaubt, eine Junction nach außen wird verweigert. Abgedeckt in Task 3: `test_a_junction_is_judged_by_its_target`.
5. **Zwei Fixes derselben Wurzel nacheinander** (Runde 2 und 3). Erwartet: jeder `fix` hält den dann aktuellen HEAD als `base_head`, nicht den des vorigen. Abgedeckt in Task 2: `test_a_second_fix_starts_from_the_current_head`.

## Entscheidungen dieses Plans

Alle stehen als Nachtrag in Spec Abschnitt 14 (Punkt 6) und 15; der Plan weicht an keiner Stelle davon ab. Dazu, nur den Bau betreffend:

- **Rauchtests mit dem Menschen.** Teammates entstehen nur in einer interaktiven Sitzung (`claude -p` spawnt keine). Task 1 und Task 6 führt der Controller zusammen mit dem Menschen aus; kein Subagent kann sie übernehmen.
- **Definitionen live schalten.** Teammates laden Definitionen aus `~/.claude/agents/`, das ist der Haupt-Checkout, nicht dieser Worktree. Task 1 legt dort zwei Probe-Definitionen ab und entfernt sie wieder; Task 6 verlinkt `~/.claude/agents` per Junction auf `agents/` dieses Worktrees und löst sie am Ende. Der Starter läuft aus dem Worktree (`$PSScriptRoot`), damit Hook und Urteilsregeln aus diesem Zweig kommen.
- **RED gegen permissive Stubs.** Für Task 2 und 3 entsteht zuerst ein Stub-Modul, das alles durchlässt (jede Prüfung gibt `[]` bzw. `None`, `parse_title` gibt `None`). Die Tests laufen dagegen rot an Assertions, nicht an Importfehlern. Danach ersetzt der volle Code den Stub.
- **Mutationsrunde** je Task mit Python-Code über `scratch/mutants.py` (unten ausgeschrieben, Läufe mit `python -B`); jede Zeile der Mutantenliste muss rot werden. Überlebt einer, fehlt ein Test — kein Code wird wegen eines „äquivalenten“ Mutanten gestrichen.

---

### Task 1: Rauchtests 0–12

**Wer:** Controller zusammen mit dem Menschen. Teammates gibt es nur in einer interaktiven Sitzung; kein Subagent kann diesen Task ausführen.

**Files:**
- Create: `docs/.superpowers/smoke/2026-10-08-rauchtests.md` (Protokoll)
- Temporär, nie committet, am Ende entfernt: `~/.claude/agents/team-probe-lead.md`, `~/.claude/agents/team-probe-mate.md` (Haupt-Checkout, nicht dieser Worktree), `<scratchpad>/probe/probe-hook.py`, `<scratchpad>/probe/probe-settings.json`, `<projekt>/.team-runs/probe/`

**Interfaces:**
- Consumes: nichts.
- Produces: das Protokoll mit einem Urteil je Rauchtest und der Liste der Rückfälle, die Task 2–5 anwenden (Abschnitt „Folgen“ unten). Insbesondere der Schlüsselname im `tool_input` eines löschenden `TaskUpdate` (Rauchtest 11) und ob ein geparkter Task `TaskCompleted` auslöst (Rauchtest 9).

Was hier nicht läuft: Rauchtest 13 braucht git 2.56, Rauchtest 14 die cleaner-Definition; beide stehen in Task 6.

- [ ] **Step 1: Projekt wählen und Probe-Ordner anlegen**

Der Mensch nennt ein Projekt mit loomux-Wächter (z. B. `classic-game-bench`); Rauchtest 2 verlangt genau diesen Fall. `<projekt>` ist dessen Wurzel, `<scratchpad>` der Scratchpad der Sitzung. In PowerShell:

```powershell
$proj = '<projekt>'                      # vom Menschen genannt, Vorwärtsschrägstriche
$scratch = '<scratchpad>'
$probe = "$proj/.team-runs/probe"
foreach ($d in 'worktrees/w1', 'verdicts', 'evidence') { New-Item -ItemType Directory -Force -Path "$probe/$d" | Out-Null }
if (-not (Test-Path "$proj/.team-runs/.gitignore")) { [IO.File]::WriteAllText("$proj/.team-runs/.gitignore", "*`n") }
New-Item -ItemType Directory -Force -Path "$scratch/probe" | Out-Null
git -C $proj status --porcelain
```

Erwartet: `git status --porcelain` meldet nichts Neues (`.team-runs` ist durch die eigene `.gitignore` unsichtbar).

- [ ] **Step 2: Probe-Hook schreiben**

Per Write nach `<scratchpad>/probe/probe-hook.py`:

````python
# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
"""Smoke-test hook: append every payload to <probe>/hooks.jsonl and refuse a marker.

Usage in a settings file: uv run --script probe-hook.py <probe dir> <event>
Exit 2 for a Bash/PowerShell command containing TEAMGATE-PROBE-DENY, else 0.
"""

import json
import sys
from pathlib import Path


def main(argv: list[str], raw: bytes) -> int:
    probe, event = Path(argv[0]), argv[1]
    payload = json.loads(raw.decode("utf-8"))
    with (probe / "hooks.jsonl").open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps({"event": event, "payload": payload}, ensure_ascii=False) + "\n")
    command = payload.get("tool_input", {}).get("command", "")
    if isinstance(command, str) and "TEAMGATE-PROBE-DENY" in command:
        print("probe: refused by the PreToolUse hook", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:], sys.stdin.buffer.read()))
````

- [ ] **Step 3: Probe-Settings schreiben**

```powershell
$hook = "uv run --script `"$scratch/probe/probe-hook.py`" `"$probe`""
function entry([string]$event) { @{ type = 'command'; timeout = 30; command = "$hook $event" } }
$settings = [ordered]@{
    env = [ordered]@{ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'; CLAUDE_CODE_ENABLE_TODO_TOOLS = '1'; TEAM_RUN_DIR = $probe }
    hooks = [ordered]@{
        TaskCreated   = @(@{ hooks = @(entry 'task-created') })
        TaskCompleted = @(@{ hooks = @(entry 'task-completed') })
        PostToolUse   = @(@{ matcher = 'TaskUpdate'; hooks = @(entry 'post-task-update') })
        PreToolUse    = @(@{ matcher = 'Bash|PowerShell'; hooks = @(entry 'pre-tool-use') })
    }
    permissions = @{ deny = @('Bash(echo DENY-RULE-PROBE:*)', 'PowerShell(echo DENY-RULE-PROBE:*)') }
}
[IO.File]::WriteAllText("$scratch/probe/probe-settings.json", ($settings | ConvertTo-Json -Depth 8))
```

- [ ] **Step 4: Probe-Definitionen ablegen**

Per Write nach `~/.claude/agents/team-probe-lead.md` (der Ordner entsteht dabei; er liegt im Haupt-Checkout `~/.claude`, nicht in diesem Worktree):

````markdown
---
name: team-probe-lead
description: Smoke-test lead for the agent-team design. Started only by hand as the main session. Never use it as a subagent.
tools: Read, Grep, Glob, Bash, PowerShell, Write, Agent, SendMessage, TaskCreate, TaskGet, TaskList, TaskUpdate, Skill, AskUserQuestion
model: opus
effort: medium
---

You run a fixed smoke test. Do exactly these steps in order, number your
output by step, and quote tool results verbatim. Do not improvise or repair
anything; if a step fails, report the failure and go on.

The probe folder is the value of the environment variable `TEAM_RUN_DIR`
(Bash: `echo "$TEAM_RUN_DIR"`).

1. Print `echo "$TEAM_RUN_DIR"` and say which of these tools you have:
   TaskCreate, TaskGet, TaskList, TaskUpdate, SendMessage, AskUserQuestion.
2. Ask the human with AskUserQuestion: "Smoke test 5: do you see this
   question?" with the options "yes" and "no".
3. Create a task with TaskCreate, subject `[probe] lead task`. Report the
   task id exactly as returned.
4. Call the Agent tool **without a name**, `subagent_type: team-probe-mate`,
   prompt: "Reply with the single word PONG and do nothing else." Report
   what came back to you.
5. Create a task `[probe] mate task`. Spawn a teammate with the Agent tool,
   `subagent_type: team-probe-mate`, `name: probe-mate`, and give it this
   prompt: "Your task id is <id of [probe] mate task>. Run your probe list."
   Assign the task to it (TaskUpdate, owner `probe-mate`). Wait until it
   reports.
6. Create a task `[probe] delete me`, then delete it with TaskUpdate (status
   `deleted`). Report both tool results.
7. Run `TaskList` and report its output verbatim.
8. Say "smoke run done" and stop.
````

Per Write nach `~/.claude/agents/team-probe-mate.md`:

````markdown
---
name: team-probe-mate
description: Smoke-test teammate for the agent-team design. Spawned only by team-probe-lead.
tools: Read, Bash, PowerShell, Write, Skill
model: haiku
effort: high
---

If your prompt says "Reply with the single word PONG", reply PONG and stop.

Otherwise run this probe list in order, number your output by step and quote
every tool result verbatim. Do not repair anything; report and go on.

1. Bash: `echo "$TEAM_RUN_DIR"`. PowerShell: `echo $env:TEAM_RUN_DIR`.
2. Say which of these tools you have: TaskCreate, TaskGet, TaskList,
   TaskUpdate, SendMessage, Skill.
3. Invoke the skill `superpowers:verification-before-completion` with the
   Skill tool and quote its first heading.
4. Write the file `<TEAM_RUN_DIR>/worktrees/w1/a.txt` with content `a`, then
   `<TEAM_RUN_DIR>/verdicts/v.json` with `{}` and
   `<TEAM_RUN_DIR>/evidence/e.txt` with `e`. Report for each whether you were
   asked for permission.
5. Bash: `echo TEAMGATE-PROBE-DENY bash`. PowerShell:
   `echo TEAMGATE-PROBE-DENY pwsh`.
6. Bash: `echo DENY-RULE-PROBE bash`. PowerShell: `echo DENY-RULE-PROBE pwsh`.
7. Create a task `[probe] made by mate` with TaskCreate.
8. Set the task named in your prompt to `pending` with TaskUpdate and the
   description `WAITING: smoke test 9`. Send the lead with SendMessage:
   "probe list done, task parked". Then end your turn.
````

Danach `git -C ~/.claude status --short agents` — erwartet genau die zwei Dateien als `??`.

- [ ] **Step 5: Erster Lauf (Mensch)**

Der Mensch startet in Windows Terminal im Projekt `<projekt>` (Rechtemodus Auto, wie global eingestellt):

```
claude --agent team-probe-lead --teammate-mode in-process --settings "<scratchpad>/probe/probe-settings.json" --add-dir "<projekt>/.team-runs/probe"
```

und tippt `Start the smoke run.` Er beantwortet die Frage aus Schritt 2 des Leads, notiert, ob er nach einer Erlaubnis gefragt wurde (Schreiben, Bash, PowerShell), liest in der Statuszeile den Effort ab (erwartet `medium`) und beendet mit `/exit`, sobald „smoke run done“ steht.

- [ ] **Step 6: Zweiter Lauf (Mensch, Rauchtest 10)**

Derselbe Befehl, Prompt: `Do only step 3 and step 7 of your list, then stop.` Danach `/exit`.

- [ ] **Step 7: Auswerten**

Quellen: `<projekt>/.team-runs/probe/hooks.jsonl`, die Transkripte beider Sitzungen unter `~/.claude/projects/<projekt-slug>/<sitzung>.jsonl` und `…/<sitzung>/subagents/agent-*.jsonl`, die Angaben des Menschen. Je Rauchtest das Kriterium:

| # | bestanden, wenn … |
|---|---|
| 0 | der Lead TaskCreate/TaskGet/TaskList/TaskUpdate nennt, Schritt 3 eine ID liefert, und `hooks.jsonl` je ein `task-created` für `[probe] lead task` (Lead) und `[probe] made by mate` (Teammate) enthält |
| 1 | der Teammate in Schritt 3 die erste Überschrift des Skills zitiert |
| 2 | die drei Dateien aus Schritt 4 des Teammates existieren und weder er noch der Mensch eine Rückfrage sah |
| 3 | sich die `pre-tool-use`-Nutzlasten von Lead und Teammate in einem Feld unterscheiden (`agent_id`, `agent_type` o. ä.); das Feld wird notiert |
| 4 | `hooks.jsonl` überhaupt Einträge hat (Hooks aus `--settings`), auch von Aufrufen des Teammates, und beide `echo` aus Schritt 1 den Probe-Pfad zeigen |
| 5 | die Frage aus Schritt 2 erschien und die Statuszeile `medium` zeigte |
| 6 | der Haiku-Teammate mit `effort: high` ohne Fehler startete (die Wirkung selbst ist nicht messbar; das wird notiert) |
| 7 | alle vier `echo` aus Schritt 5 und 6 des Teammates verweigert wurden: Schritt 5 mit „probe: refused by the PreToolUse hook“, Schritt 6 durch die Deny-Regel |
| 8 | der Teammate aus der Definition in `~/.claude/agents/` entstand und die Werkzeuge der Definition meldet |
| 9 | `hooks.jsonl` **kein** `task-completed` für den geparkten `[probe] mate task` enthält und der Teammate nicht mehrfach dieselbe Meldung bekam |
| 10 | Form der IDs aus beiden Läufen notiert ist; ob der zweite Lead neu zählt, steht im Protokoll |
| 11 | `hooks.jsonl` ein `post-task-update` mit dem gelöschten Task enthält; die Schlüssel von `tool_input` (ID und Status) werden wörtlich notiert |
| 12 | Schritt 4 des Leads `PONG` zurückbekam und dabei kein Teammate entstand |

Zusätzlich: die Felder einer echten `task-created`- und `task-completed`-Nutzlast wörtlich ins Protokoll (Task 2 prüft seine Fixtures dagegen).

- [ ] **Step 8: Protokoll schreiben**

`docs/.superpowers/smoke/2026-10-08-rauchtests.md` (deutsch): Kopf mit Datum, `claude --version`, `git --version`, Projekt; je Rauchtest eine Zeile `| # | Ergebnis (bestanden / durchgefallen / nicht messbar) | Beleg (Zeile aus hooks.jsonl oder Transkriptauszug) | Folge |`; darunter die zwei wörtlichen Nutzlasten.

- [ ] **Step 9: Folgen anwenden — oder anhalten**

**Anhalten** und dem Menschen vorlegen, wenn 0 (auch mit `--allowedTools` nicht), 2, 4, 7 (Hook-Teil) oder 8 durchfällt: Dann trägt das Design nicht ohne Spec-Nachtrag.

Sonst die Folgen ins Protokoll schreiben; die Tasks wenden sie an:

| durchgefallen | Folge, und wo |
|---|---|
| 0, aber `--allowedTools TaskCreate,TaskGet,TaskList,TaskUpdate` trägt | Task 5, Schritt „Rückfall Rauchtest 0“ |
| 1 | Task 4, Schritt „Rückfall Rauchtest 1“ |
| 3 | nichts zu bauen; Spec Abschnitt 11 nennt die Lücke schon |
| 5 | Task 5, Schritt „Rückfall Rauchtest 5“ |
| 6 | Task 4, Schritt „Rückfall Rauchtest 6“ |
| 7, nur der Deny-Teil | nichts zu bauen; die Befehlsprüfung trägt allein, im Protokoll vermerken |
| 9 | Task 2, Schritt „Rückfall Rauchtest 9“ |
| 11, Schlüssel heißen anders als `taskId`/`status` | Task 2, Schritt „Rauchtest 11 übernehmen“ |
| 11, Löschen gar nicht sichtbar | nichts zu bauen: der Orchestrator löscht nie, er schließt per `supersede` (steht schon in seinem Rumpf) |
| 12 | Task 4, Schritt „Rückfall Rauchtest 12“ |

- [ ] **Step 10: Aufräumen**

```powershell
Remove-Item "$HOME/.claude/agents/team-probe-lead.md", "$HOME/.claude/agents/team-probe-mate.md"
Remove-Item -Recurse "$proj/.team-runs/probe"
```

Lag `.team-runs/.gitignore` vor Step 1 nicht da, auch sie und den leeren Ordner entfernen. `~/.claude/agents` bleibt leer stehen oder wird per `rmdir` entfernt, wenn er vorher fehlte. Prüfen: `git -C ~/.claude status --short agents` und `git -C <projekt> status --porcelain` sind leer.

- [ ] **Step 11: Commit**

```bash
git add docs/.superpowers/smoke/2026-10-08-rauchtests.md
git commit -m "Record what the smoke tests showed about agent teams"
```

### Task 2: Task-Tore — `teamgate_tasks.py` und der Hook-Einstieg

**Files:**
- Create: `scripts/teamgate_tasks.py` (Titel, Register, Sperre, Urteilsregeln, Tore je Ereignis, `status.md`)
- Create: `scripts/team-gate.py` (Einstieg; in diesem Task ohne `pre-tool-use`)
- Test: `scripts/tests/teamgate/conftest.py`, `scripts/tests/teamgate/test_tasks.py`, `scripts/tests/teamgate/test_entry.py`

**Interfaces:**
- Consumes: aus Task 1 die wörtlichen Nutzlasten (Felder `task_id`, `task_subject`, `task_description`; `tool_input`-Schlüssel des Löschens) und das Urteil zu Rauchtest 9.
- Produces (Task 3 und 5 bauen darauf):
  - `teamgate_tasks.Run(dir: Path)` mit `.name`, `.repo`, `.gen`, `.feature`, `.exists()`, `.worktree(root) -> Path`, `.branch(root) -> str`, `.verdict_path(gen, task_id) -> Path`
  - `teamgate_tasks.GateError(Exception)` — jeder kaputte Zustand, den der Einstieg als Exit 2 meldet
  - `parse_title(subject: str) -> Title | None`; `Title(kind, sub, root, domain, conflict)`
  - `on_created(run, payload) -> list[str]`, `on_completed(run, payload, wait_marker=False) -> list[str]`, `on_post_task_update(run, payload) -> list[str]`, `supersede(run, keys: list[str]) -> list[str]` — leere Liste heißt durchlassen
  - Kommandozeile: `uv run --script scripts/team-gate.py --run <lauf> task-created|task-completed|post-task-update` (Nutzlast auf stdin) und `… supersede <gen>:<task_id>…`
  - Testwelt `conftest.World` mit `repo`, `run`, `worktree(root)`, `commit(...)`, `created(...)`, `completed(...)`, `evidence(...)`, `verdict(...)`, `gate_log(...)`, `register()`; Konstanten `FEATURE = "feat/x"`, `RUN_NAME`, `SCRIPTS`, Hilfe `sh(cwd, *args)`

- [ ] **Step 1: Nutzlasten gegen das Protokoll aus Task 1 abgleichen**

Die Feldnamen in `on_created`/`on_completed` (`task_id`, `task_subject`, `task_description`) und in `on_post_task_update` (`tool_input.taskId`, `tool_input.status == "deleted"`) mit den wörtlichen Nutzlasten im Protokoll aus Task 1 vergleichen. **Rauchtest 11 übernehmen:** Heißen die Schlüssel dort anders, im Code unten und in `test_tasks.py`/`test_entry.py` genau diese Namen ersetzen, bevor irgendetwas läuft.

- [ ] **Step 2: Testwelt schreiben**

`scripts/tests/teamgate/conftest.py`:

````python
"""Test worlds for team-gate: a real git repo, a run folder, worktrees."""

from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SCRIPTS))

from teamgate_tasks import Run  # noqa: E402

FEATURE = "feat/x"
RUN_NAME = "20261008-120000"


def sh(cwd: Path, *args: str) -> str:
    out = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, encoding="utf-8", check=True)
    return out.stdout.strip()


@dataclass
class World:
    repo: Path
    run: Run

    @property
    def feature_head(self) -> str:
        return sh(self.repo, "rev-parse", FEATURE)

    def worktree(self, root: str) -> Path:
        path = self.run.worktree(root)
        sh(self.repo, "worktree", "add", "--track", "-b", self.run.branch(root), str(path), FEATURE)
        return path

    def commit(self, where: Path, name: str = "a.txt", text: str = "x\n") -> str:
        (where / name).write_text(text, encoding="utf-8", newline="\n")
        sh(where, "add", name)
        sh(where, "commit", "-q", "-m", f"change {name}")
        return sh(where, "rev-parse", "HEAD")

    def created(self, task_id: str, subject: str, description: str = "") -> list[str]:
        from teamgate_tasks import on_created

        return on_created(self.run, {"task_id": task_id, "task_subject": subject, "task_description": description})

    def completed(self, task_id: str, subject: str, description: str = "", wait: bool = False) -> list[str]:
        from teamgate_tasks import on_completed

        payload = {"task_id": task_id, "task_subject": subject, "task_description": description}
        return on_completed(self.run, payload, wait_marker=wait)

    def evidence(self, name: str, text: str = "ok\n") -> str:
        path = self.run.dir / "evidence" / name
        path.write_text(text, encoding="utf-8")
        return f"evidence/{name}"

    def verdict(self, task_id: str, body: Mapping[str, object], gen: int = 1) -> None:
        self.run.verdict_path(gen, task_id).write_text(json.dumps(body), encoding="utf-8")

    def gate_log(self, root: str, head: str, code: int) -> str:
        return self.evidence(f"gate-{root}-{head}.txt", f"{head}\n{code}\noutput\n")

    def register(self) -> list[dict[str, object]]:
        path = self.run.dir / "tasks.jsonl"
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


@pytest.fixture
def world(tmp_path: Path) -> Iterator[World]:
    repo = tmp_path / "Prüf Repo"  # a space and an umlaut on every path (review focus 1)
    repo.mkdir()
    sh(repo, "init", "-q", "-b", "main")
    sh(repo, "config", "user.email", "t@example.org")
    sh(repo, "config", "user.name", "T")
    sh(repo, "config", "core.autocrlf", "false")
    (repo / "README.md").write_text("r\n", encoding="utf-8")
    sh(repo, "add", "README.md")
    sh(repo, "commit", "-q", "-m", "init")
    sh(repo, "switch", "-q", "-c", FEATURE)
    run_dir = repo / ".team-runs" / RUN_NAME
    for sub in ("verdicts", "evidence", "worktrees"):
        (run_dir / sub).mkdir(parents=True)
    (repo / ".team-runs" / ".gitignore").write_text("*\n", encoding="utf-8")
    meta = {"plan": "p.md", "repo": str(repo), "feature_branch": FEATURE, "generation": 1}
    (run_dir / "run.json").write_text(json.dumps(meta), encoding="utf-8")
    yield World(repo, Run(run_dir))
````

- [ ] **Step 3: Tests schreiben**

`scripts/tests/teamgate/test_tasks.py`:

````python
from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path

import pytest
from conftest import FEATURE, World, sh

import teamgate_tasks as tg
from teamgate_tasks import GateError, Title, parse_title

# --- titles ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("subject", "expected"),
    [
        ("[impl:backend] T3 Add login endpoint", Title("impl", None, "T3", "backend", False)),
        ("[impl:infra] T12 x", Title("impl", None, "T12", "infra", False)),
        ("[fix:backend] T3 Reject empty password", Title("fix", None, "T3", "backend", False)),
        ("[fix:ux:conflict] B2 Rebase onto T1", Title("fix", None, "B2", "ux", True)),
        ("[fix:frontend] F Repair the report", Title("fix", None, "F", "frontend", False)),
        ("[review:code] T3", Title("review", "code", "T3", None, False)),
        ("[review:security] B2", Title("review", "security", "B2", None, False)),
        ("[verify:impl] T3", Title("verify", "impl", "T3", None, False)),
        ("[verify:rebase] T3", Title("verify", "rebase", "T3", None, False)),
        ("[verify:hunt] B4", Title("verify", "hunt", "B4", None, False)),
        ("[verify:final] F", Title("verify", "final", "F", None, False)),
        ("[merge] T3", Title("merge", None, "T3", None, False)),
        ("[hunt] R1.P2 HTTP handlers", Title("hunt", None, None, None, False)),
        ("[final]", Title("final", None, None, None, False)),
        ("[cleanup]", Title("cleanup", None, None, None, False)),
    ],
)
def test_every_form_of_spec_section_5_parses(subject: str, expected: Title) -> None:
    assert parse_title(subject) == expected


@pytest.mark.parametrize(
    "subject",
    [
        "[impl] T3 no domain",
        "[impl:db] T3 unknown domain",
        "[impl:backend] T3",  # no title text
        "[impl:backend]  T3 two spaces",
        "[impl:backend] T0 zero is no plan task",
        "[impl:backend] t3 lower case",
        "[review:code] T3 trailing words",
        "[verify:final] T1",  # final belongs to F
        "[verify:final]",
        "[verify:hunt] T1",  # a hunt finding is a B root
        "[verify:merge] T1",
        "[merge] R1",
        "[hunt] R0.P1 zero",
        "[hunt] R1.P1",
        "[final] x",
        "Add login endpoint",
    ],
)
def test_other_titles_are_refused(subject: str) -> None:
    assert parse_title(subject) is None


# --- verdict builders ------------------------------------------------------


def finding(fid: str, kind: str = "defect", status: str = "open", **extra: object) -> dict[str, object]:
    return {"id": fid, "kind": kind, "severity": "high", "claim": "c", "location": "a.txt:1", "status": status, **extra}


def settled(w: World, fid: str, kind: str, status: str, **extra: object) -> dict[str, object]:
    ev = {"command": "probe", "output_file": w.evidence(f"{fid}.txt")}
    return finding(fid, kind, status, evidence=ev, **extra)


def review(w: World, tid: str, subject: str, head: str, findings: list[dict[str, object]] | None = None) -> None:
    role = "code-reviewer" if "code" in subject else "security-reviewer"
    w.verdict(tid, {"task_id": tid, "subject": subject, "role": role, "head": head, "findings": findings or []})


def verify(w: World, tid: str, subject: str, head: str, verdict: str = "pass", findings: list[dict[str, object]] | None = None, **extra: object) -> None:
    body: dict[str, object] = {"task_id": tid, "subject": subject, "role": "verifier", "head": head, "verdict": verdict, "findings": findings or [], **extra}
    w.verdict(tid, body)


def build(w: World, root: str = "T1", n: int = 1) -> tuple[Path, str]:
    """impl of a root up to a completed verify:impl; returns worktree and HEAD."""
    wt = w.worktree(root)
    assert w.created(f"i{n}", f"[impl:backend] {root} Build it") == []
    head = w.commit(wt)
    assert w.completed(f"i{n}", f"[impl:backend] {root} Build it") == []
    assert w.created(f"vi{n}", f"[verify:impl] {root}") == []
    w.gate_log(root, head, 0)
    verify(w, f"vi{n}", f"[verify:impl] {root}", head)
    assert w.completed(f"vi{n}", f"[verify:impl] {root}") == []
    return wt, head


def reviewed(w: World, root: str, head: str, tag: str = "1", verdict: str = "pass") -> None:
    for sub in ("code", "security"):
        assert w.created(f"r{sub}{tag}", f"[review:{sub}] {root}") == []
        review(w, f"r{sub}{tag}", f"[review:{sub}] {root}", head)
        assert w.completed(f"r{sub}{tag}", f"[review:{sub}] {root}") == []
    assert w.created(f"vr{tag}", f"[verify:review] {root}") == []
    findings = [settled(w, f"{root}-sec-F{tag}", "defect", "confirmed")] if verdict == "fail" else []
    verify(w, f"vr{tag}", f"[verify:review] {root}", head, verdict, findings, judges=[f"rcode{tag}", f"rsecurity{tag}"])
    assert w.completed(f"vr{tag}", f"[verify:review] {root}") == []


def merged(w: World, root: str = "T1", n: int = 1) -> str:
    _, head = build(w, root, n)
    reviewed(w, root, head, tag=f"{root}{n}")
    assert w.created(f"m{root}", f"[merge] {root}") == []
    sh(w.repo, "merge", "-q", "--ff-only", w.run.branch(root))
    assert w.completed(f"m{root}", f"[merge] {root}") == []
    return head


# --- TaskCreated -----------------------------------------------------------


def test_a_closed_run_refuses_new_tasks(world: World) -> None:
    shutil.rmtree(world.run.dir)
    assert "the run is closed" in world.created("t1", "[final]")[0]


def test_an_unknown_title_is_refused_and_not_registered(world: World) -> None:
    assert "matches none of the forms" in world.created("t1", "Do things")[0]
    assert world.register() == []


def test_impl_needs_its_worktree_first(world: World) -> None:
    assert "create the worktree" in world.created("t1", "[impl:backend] T1 Build")[0]


def test_impl_records_the_worktree_head_as_base(world: World) -> None:
    world.worktree("T1")
    assert world.created("t1", "[impl:backend] T1 Build") == []
    event = world.register()[0]
    assert event == {"event": "created", "gen": 1, "task_id": "t1", "subject": "[impl:backend] T1 Build", "base_head": world.feature_head}
    assert "| T1 | impl | 1 | — |" in (world.run.dir / "status.md").read_text(encoding="utf-8")


def test_a_payload_without_task_id_is_an_error(world: World) -> None:
    with pytest.raises(GateError, match="no task_id"):
        tg.on_created(world.run, {"task_subject": "[final]"})


# --- impl/fix completion ---------------------------------------------------


def test_impl_cannot_complete_with_a_dirty_worktree(world: World) -> None:
    wt = world.worktree("T1")
    world.created("t1", "[impl:backend] T1 Build")
    world.commit(wt)
    (wt / "loose.txt").write_text("x", encoding="utf-8")
    assert world.completed("t1", "[impl:backend] T1 Build") == ["worktree T1 is not clean"]


def test_impl_cannot_complete_without_a_commit(world: World) -> None:
    world.worktree("T1")
    world.created("t1", "[impl:backend] T1 Build")
    assert "has no commit over" in world.completed("t1", "[impl:backend] T1 Build")[0]


def test_a_task_the_register_does_not_know_cannot_complete(world: World) -> None:
    assert "is not in the register" in world.completed("t9", "[final]")[0]


def test_completing_an_unknown_title_is_refused(world: World) -> None:
    assert "matches none" in world.completed("t9", "Something")[0]


def test_completing_in_a_closed_run_is_refused(world: World) -> None:
    shutil.rmtree(world.run.dir)
    assert "the run is closed" in world.completed("t9", "[final]")[0]


# --- verdict rules ---------------------------------------------------------


def test_a_review_without_a_verdict_file_is_refused(world: World) -> None:
    world.created("r1", "[review:code] T1")
    with pytest.raises(GateError, match="verdict missing"):
        world.completed("r1", "[review:code] T1")


def test_a_verdict_that_is_no_json_is_refused(world: World) -> None:
    world.created("r1", "[review:code] T1")
    world.run.verdict_path(1, "r1").write_text("{", encoding="utf-8")
    with pytest.raises(GateError, match="not JSON"):
        world.completed("r1", "[review:code] T1")


def test_a_verdict_that_is_no_object_is_refused(world: World) -> None:
    world.created("r1", "[review:code] T1")
    world.run.verdict_path(1, "r1").write_text("[]", encoding="utf-8")
    with pytest.raises(GateError, match="not an object"):
        world.completed("r1", "[review:code] T1")


def test_a_review_may_not_settle_findings(world: World) -> None:
    world.created("r1", "[review:code] T1")
    head = world.feature_head
    review(world, "r1", "[review:code] T1", head, [settled(world, "T1-code-F1", "defect", "confirmed"), finding("T1-code-F2", duplicate_of="B1")])
    assert world.completed("r1", "[review:code] T1") == [
        "findings[0].status must be open: only the verifier settles findings",
        "findings[1].duplicate_of is the verifier's to set",
    ]


def test_a_review_carries_no_verdict(world: World) -> None:
    world.created("r1", "[review:code] T1")
    world.verdict("r1", {"task_id": "r1", "subject": "[review:code] T1", "role": "code-reviewer", "head": world.feature_head, "verdict": "pass", "findings": []})
    assert world.completed("r1", "[review:code] T1") == ["only verify verdicts carry a verdict"]


def test_identity_fields_must_match_the_task(world: World) -> None:
    world.created("r1", "[review:security] T1")
    world.verdict("r1", {"task_id": "x", "subject": "[review:code] T1", "role": "code-reviewer", "head": "abc", "findings": {}})
    assert world.completed("r1", "[review:security] T1") == [
        "task_id does not match the task",
        "subject does not match the task",
        "head is not a full commit hash",
        "role must be security-reviewer",
        "findings must be a list",
    ]


def test_each_finding_needs_its_fields(world: World) -> None:
    world.created("r1", "[review:code] T1")
    body = {"task_id": "r1", "subject": "[review:code] T1", "role": "code-reviewer", "head": world.feature_head,
            "findings": ["x", {"kind": "bug", "severity": "huge", "status": "open"}]}
    world.verdict("r1", body)
    assert world.completed("r1", "[review:code] T1") == [
        "findings[0] is not an object",
        "findings[1].id missing",
        "findings[1].kind must be defect or claim",
        "findings[1].severity must be one of ['critical', 'high', 'low', 'medium']",
    ]


def test_a_hunt_finding_needs_its_patch(world: World) -> None:
    world.created("h1", "[hunt] R1.P1 Parser")
    patch = world.evidence("R1-P1-F1.patch", "diff\n")
    body = {"task_id": "h1", "subject": "[hunt] R1.P1 Parser", "role": "bug-hunter", "head": world.feature_head,
            # README.md of the repo exists and is not empty, but lies outside the run folder.
            "findings": [finding("R1-P1-F1", patch=patch), finding("R1-P1-F2", patch="../../README.md"), finding("R1-P1-F3")]}
    world.verdict("h1", body)
    assert world.completed("h1", "[hunt] R1.P1 Parser") == [
        "findings[1].patch must name a non-empty file in the run folder",
        "findings[2].patch must name a non-empty file in the run folder",
    ]
    body["findings"] = [finding("R1-P1-F1", patch=patch)]
    world.verdict("h1", body)
    assert world.completed("h1", "[hunt] R1.P1 Parser") == []


def test_verify_findings_must_be_settled_with_evidence(world: World) -> None:
    world.created("v1", "[verify:hunt] B1")
    empty = world.evidence("empty.txt", "")
    verify(world, "v1", "[verify:hunt] B1", world.feature_head, "fail", [
        finding("B1-F1", status="open"),
        finding("B1-F2", status="confirmed", evidence={"command": "p", "output_file": empty}),
        finding("B1-F3", status="confirmed", evidence={"command": "", "output_file": "evidence/x"}),
        finding("B1-F4", status="refuted", evidence="no"),
        settled(world, "B1-F5", "defect", "confirmed", duplicate_of="T1"),
    ])
    assert world.completed("v1", "[verify:hunt] B1") == [
        "findings[0].status must be confirmed or refuted",
        "findings[1].evidence needs a command and a non-empty output_file in the run folder",
        "findings[2].evidence needs a command and a non-empty output_file in the run folder",
        "findings[3].evidence needs a command and a non-empty output_file in the run folder",
        "findings[4].duplicate_of must be B<n>, and only in verify:hunt",
    ]


def test_duplicate_of_is_only_for_verify_hunt(world: World) -> None:
    world.created("v1", "[verify:final] F")
    verify(world, "v1", "[verify:final] F", world.feature_head, "fail", [settled(world, "F-ver-F1", "defect", "confirmed", duplicate_of="B1")])
    assert world.completed("v1", "[verify:final] F") == ["findings[0].duplicate_of must be B<n>, and only in verify:hunt"]


@pytest.mark.parametrize(
    ("kind", "status", "verdict", "ok"),
    [
        ("defect", "confirmed", "fail", True),
        ("defect", "confirmed", "pass", False),
        ("claim", "refuted", "fail", True),
        ("claim", "refuted", "pass", False),
        ("defect", "refuted", "pass", True),
        ("defect", "refuted", "fail", False),
        ("claim", "confirmed", "pass", True),
        ("claim", "confirmed", "fail", False),
    ],
)
def test_the_verdict_follows_the_findings(world: World, kind: str, status: str, verdict: str, ok: bool) -> None:
    world.created("v1", "[verify:final] F")
    verify(world, "v1", "[verify:final] F", world.feature_head, verdict, [settled(world, "F-ver-F1", kind, status)])
    errors = world.completed("v1", "[verify:final] F")
    assert errors == ([] if ok else ["verdict must be fail exactly when a defect is confirmed or a claim refuted"])


def test_a_verify_verdict_must_be_pass_or_fail(world: World) -> None:
    world.created("v1", "[verify:final] F")
    verify(world, "v1", "[verify:final] F", world.feature_head, "maybe")
    assert world.completed("v1", "[verify:final] F") == ["verdict must be pass or fail"]


# --- gate log --------------------------------------------------------------


def test_verify_impl_needs_a_gate_log_for_the_worktree_head(world: World) -> None:
    wt = world.worktree("T1")
    world.created("i1", "[impl:backend] T1 Build")
    head = world.commit(wt)
    world.completed("i1", "[impl:backend] T1 Build")
    world.created("v1", "[verify:impl] T1")
    verify(world, "v1", "[verify:impl] T1", world.feature_head)
    assert world.completed("v1", "[verify:impl] T1") == ["verdict head is not the HEAD of worktree T1"]
    verify(world, "v1", "[verify:impl] T1", head)
    assert "gate log missing" in world.completed("v1", "[verify:impl] T1")[0]
    world.evidence(f"gate-T1-{head}.txt", f"{world.feature_head}\n0\n")
    assert world.completed("v1", "[verify:impl] T1") == ["gate log must start with the HEAD hash and the exit code"]
    world.evidence(f"gate-T1-{head}.txt", f"{head}\nzero\n")
    assert world.completed("v1", "[verify:impl] T1") == ["gate log must start with the HEAD hash and the exit code"]
    world.gate_log("T1", head, 0)
    assert world.completed("v1", "[verify:impl] T1") == []


def test_a_red_gate_log_cannot_pass(world: World) -> None:
    wt = world.worktree("T1")
    world.created("i1", "[impl:backend] T1 Build")
    head = world.commit(wt)
    world.completed("i1", "[impl:backend] T1 Build")
    world.created("v1", "[verify:impl] T1")
    log = world.gate_log("T1", head, 1)
    verify(world, "v1", "[verify:impl] T1", head)
    assert world.completed("v1", "[verify:impl] T1") == ["the gate log is red, the verdict cannot be pass"]
    other = settled(world, "T1-ver-F1", "claim", "refuted")
    verify(world, "v1", "[verify:impl] T1", head, "fail", [other])
    assert world.completed("v1", "[verify:impl] T1") == ["a red gate log needs a refuted claim that carries it as evidence"]
    carried = finding("T1-ver-F2", "claim", "refuted", evidence={"command": "gate", "output_file": log})
    defect = settled(world, "T1-ver-F3", "defect", "confirmed")
    verify(world, "v1", "[verify:impl] T1", head, "fail", [defect, carried])
    assert world.completed("v1", "[verify:impl] T1") == []


# --- verify:review ---------------------------------------------------------


def test_verify_review_names_both_latest_reviews_of_the_same_head(world: World) -> None:
    _, head = build(world)
    for sub in ("code", "security"):
        world.created(f"r{sub}", f"[review:{sub}] T1")
        review(world, f"r{sub}", f"[review:{sub}] T1", head)
        world.completed(f"r{sub}", f"[review:{sub}] T1")
    world.created("vr", "[verify:review] T1")
    verify(world, "vr", "[verify:review] T1", head)
    assert world.completed("vr", "[verify:review] T1") == ["verify:review needs judges: the two review task ids"]
    verify(world, "vr", "[verify:review] T1", head, judges=["rcode", "other"])
    assert world.completed("vr", "[verify:review] T1") == ["judges must be the latest completed code and security review of this root"]
    verify(world, "vr", "[verify:review] T1", world.feature_head, judges=["rcode", "rsecurity"])
    assert world.completed("vr", "[verify:review] T1") == ["both reviews and the verify:review must carry the same head"]
    verify(world, "vr", "[verify:review] T1", head, judges=["rcode", "rsecurity"])
    assert world.completed("vr", "[verify:review] T1") == []


def test_judges_of_an_older_round_are_refused(world: World) -> None:
    _, head = build(world)
    reviewed(world, "T1", head, tag="1", verdict="fail")
    for sub in ("code", "security"):
        world.created(f"r{sub}2", f"[review:{sub}] T1")
        review(world, f"r{sub}2", f"[review:{sub}] T1", head)
        world.completed(f"r{sub}2", f"[review:{sub}] T1")
    world.created("vr2", "[verify:review] T1")
    verify(world, "vr2", "[verify:review] T1", head, judges=["rcode1", "rsecurity1"])
    assert world.completed("vr2", "[verify:review] T1") == ["judges must be the latest completed code and security review of this root"]


# --- merge -----------------------------------------------------------------


def test_merge_needs_the_branch_on_the_feature_branch(world: World) -> None:
    _, head = build(world)
    reviewed(world, "T1", head)
    world.created("m", "[merge] T1")
    assert world.completed("m", "[merge] T1") == [f"team/{world.run.name}/T1 is not an ancestor of {FEATURE}"]


def test_merge_needs_green_reviews(world: World) -> None:
    _, head = build(world)
    reviewed(world, "T1", head, verdict="fail")
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert world.completed("m", "[merge] T1") == [f"root T1 is not green for {head}"]


def test_merge_needs_reviews_of_the_merged_head(world: World) -> None:
    wt, head = build(world)
    reviewed(world, "T1", head)
    world.commit(wt, "late.txt")  # a commit nobody reviewed
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert "is not green" in world.completed("m", "[merge] T1")[0]


def test_a_rebase_verdict_carries_the_trio_forward(world: World) -> None:
    wt, head = build(world)
    reviewed(world, "T1", head)
    world.commit(world.repo, "other.txt")  # the feature branch moved on
    sh(wt, "rebase", "-q", FEATURE)
    new = sh(wt, "rev-parse", "HEAD")
    world.created("vrb", "[verify:rebase] T1")
    world.gate_log("T1", new, 0)
    rd = {"command": "git range-diff", "output_file": world.evidence("rd.txt")}
    verify(world, "vrb", "[verify:rebase] T1", new, rebased_from=head, inherits=["rcode1", "rsecurity1", "x"], evidence=rd)
    assert world.completed("vrb", "[verify:rebase] T1") == ["inherits must name the trio that was green for rebased_from"]
    verify(world, "vrb", "[verify:rebase] T1", new, rebased_from=new, inherits=["rcode1", "rsecurity1", "vr1"], evidence=rd)
    assert world.completed("vrb", "[verify:rebase] T1") == ["inherits must name the trio that was green for rebased_from"]
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert "is not green" in world.completed("m", "[merge] T1")[0]  # nothing carried forward yet
    verify(world, "vrb", "[verify:rebase] T1", new, rebased_from=head, inherits=["rcode1", "rsecurity1", "vr1"], evidence=rd)
    assert world.completed("vrb", "[verify:rebase] T1") == []
    assert world.completed("m", "[merge] T1") == []


def test_a_second_rebase_carries_the_same_trio(world: World) -> None:
    wt, head = build(world)
    reviewed(world, "T1", head)
    rd = {"command": "git range-diff", "output_file": world.evidence("rd.txt")}
    previous = head
    for n in (1, 2):
        world.commit(world.repo, f"other{n}.txt")
        sh(wt, "rebase", "-q", FEATURE)
        new = sh(wt, "rev-parse", "HEAD")
        world.created(f"vrb{n}", "[verify:rebase] T1")
        world.gate_log("T1", new, 0)
        verify(world, f"vrb{n}", "[verify:rebase] T1", new, rebased_from=previous, inherits=["rcode1", "rsecurity1", "vr1"], evidence=rd)
        assert world.completed(f"vrb{n}", "[verify:rebase] T1") == []
        previous = new
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert world.completed("m", "[merge] T1") == []


def test_a_failing_rebase_verdict_ends_green(world: World) -> None:
    wt, head = build(world)
    reviewed(world, "T1", head)
    world.commit(world.repo, "other.txt")
    sh(wt, "rebase", "-q", FEATURE)
    new = sh(wt, "rev-parse", "HEAD")
    world.created("vrb", "[verify:rebase] T1")
    world.gate_log("T1", new, 0)
    rd = {"command": "git range-diff", "output_file": world.evidence("rd.txt")}
    changed = settled(world, "T1-ver-F1", "claim", "refuted")
    verify(world, "vrb", "[verify:rebase] T1", new, "fail", [changed], rebased_from=head, evidence=rd)
    assert world.completed("vrb", "[verify:rebase] T1") == []
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert "is not green" in world.completed("m", "[merge] T1")[0]


def test_a_verdict_rewritten_after_completion_does_not_stay_green(world: World) -> None:
    wt, head = build(world)
    reviewed(world, "T1", head)
    world.commit(world.repo, "other.txt")
    sh(wt, "rebase", "-q", FEATURE)
    new = sh(wt, "rev-parse", "HEAD")
    world.created("vrb", "[verify:rebase] T1")
    world.gate_log("T1", new, 0)
    rd = {"command": "git range-diff", "output_file": world.evidence("rd.txt")}
    verify(world, "vrb", "[verify:rebase] T1", new, rebased_from=head, inherits=["rcode1", "rsecurity1", "vr1"], evidence=rd)
    assert world.completed("vrb", "[verify:rebase] T1") == []
    # The verifier "improves" its file after the hook accepted it (review focus 3).
    verify(world, "vrb", "[verify:rebase] T1", new, rebased_from=head, inherits=["rcode1", "rsecurity1", "other"], evidence=rd)
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert "is not green" in world.completed("m", "[merge] T1")[0]


def test_a_rebase_verdict_needs_its_fields(world: World) -> None:
    wt, head = build(world)
    world.created("vrb", "[verify:rebase] T1")
    world.gate_log("T1", head, 0)
    verify(world, "vrb", "[verify:rebase] T1", head, inherits=["a"])
    assert world.completed("vrb", "[verify:rebase] T1") == [
        "verify:rebase needs rebased_from",
        "a passing verify:rebase needs inherits: the three task ids of the trio",
        "verify:rebase needs the range-diff as evidence",
    ]


def test_green_at_without_history_is_false() -> None:
    assert tg.green_at([], "0" * 40) is False


# --- final -----------------------------------------------------------------


def test_final_passes_once_every_root_is_merged(world: World) -> None:
    merged(world)
    world.created("f", "[final]")
    assert world.completed("f", "[final]") == []


def test_final_lists_open_tasks(world: World) -> None:
    merged(world)
    world.created("h", "[hunt] R1.P1 All")
    world.created("f", "[final]")
    assert world.completed("f", "[final]") == ["open task: [hunt] R1.P1 All (h, g1)"]


def test_a_deleted_review_is_closed_but_a_deleted_merge_is_not(world: World) -> None:
    _, head = build(world)
    world.created("r", "[review:code] T1")
    world.created("m", "[merge] T1")
    for tid in ("r", "m"):
        assert tg.on_post_task_update(world.run, {"tool_input": {"taskId": tid, "status": "deleted"}}) == []
    world.created("f", "[final]")
    assert world.completed("f", "[final]") == ["open task: [merge] T1 (m, g1)", "root T1 has no completed [merge]"]


def test_an_earlier_failing_verify_does_not_hold_final(world: World) -> None:
    wt = world.worktree("T1")
    world.created("i1", "[impl:backend] T1 Build")
    head1 = world.commit(wt)
    world.completed("i1", "[impl:backend] T1 Build")
    world.created("vi1", "[verify:impl] T1")
    log = world.gate_log("T1", head1, 1)
    red = finding("T1-ver-F1", "claim", "refuted", evidence={"command": "gate", "output_file": log})
    verify(world, "vi1", "[verify:impl] T1", head1, "fail", [red])
    assert world.completed("vi1", "[verify:impl] T1") == []
    world.created("x1", "[fix:backend] T1 Repair")
    head2 = world.commit(wt, "b.txt")
    world.completed("x1", "[fix:backend] T1 Repair")
    world.created("vf1", "[verify:fix] T1")
    world.gate_log("T1", head2, 0)
    verify(world, "vf1", "[verify:fix] T1", head2)
    assert world.completed("vf1", "[verify:fix] T1") == []
    reviewed(world, "T1", head2)
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert world.completed("m", "[merge] T1") == []
    world.created("f", "[final]")
    assert world.completed("f", "[final]") == []


def test_final_refuses_a_root_whose_latest_verify_failed(world: World) -> None:
    merged(world)
    world.created("vf", "[verify:final] F")
    verify(world, "vf", "[verify:final] F", world.feature_head, "fail", [settled(world, "F-ver-F1", "defect", "confirmed")])
    world.completed("vf", "[verify:final] F")
    world.run.worktree("F").mkdir()
    sh(world.repo, "branch", world.run.branch("F"), FEATURE)
    world.created("fx", "[fix:backend] F Repair")
    tg.supersede(world.run, ["1:fx"])
    world.created("f2", "[final]")
    errors = world.completed("f2", "[final]")
    assert errors == ["root F has no completed [merge]", "the latest verify verdict of root F is fail"]


def test_final_refuses_a_merged_root_whose_branch_moved_away(world: World) -> None:
    merged(world)
    wt = world.run.worktree("T1")
    sh(wt, "reset", "-q", "--hard", "main")
    world.commit(wt, "after.txt")
    world.created("f", "[final]")
    assert world.completed("f", "[final]") == [f"team/{world.run.name}/T1 is not an ancestor of {FEATURE}"]


# --- cleanup ---------------------------------------------------------------


def test_cleanup_needs_a_passing_verify_final_to_be_created(world: World) -> None:
    assert world.created("c", "[cleanup]") == ["[cleanup] needs a passing latest [verify:final]"]
    world.created("vf1", "[verify:final] F")
    verify(world, "vf1", "[verify:final] F", world.feature_head, "fail", [settled(world, "F-ver-F1", "defect", "confirmed")])
    world.completed("vf1", "[verify:final] F")
    assert world.created("c", "[cleanup]") == ["[cleanup] needs a passing latest [verify:final]"]
    world.created("vf2", "[verify:final] F")
    verify(world, "vf2", "[verify:final] F", world.feature_head)
    world.completed("vf2", "[verify:final] F")
    assert world.created("c", "[cleanup]") == []


def test_cleanup_completes_only_without_folder_worktrees_and_stray_branches(world: World) -> None:
    world.worktree("T1")
    world.worktree("T2")
    payload = {"task_id": "c", "task_subject": "[cleanup]", "task_description": f"Unmerged: team/{world.run.name}/T2"}
    t1 = world.run.worktree("T1")
    assert tg.on_completed(world.run, payload) == [
        f"worktree still registered: {t1}",
        f"worktree still registered: {world.run.worktree('T2')}",
        f"branch left that the task description does not list: team/{world.run.name}/T1",
        f"run folder still exists: {world.run.dir}",
    ]
    for root in ("T1", "T2"):
        sh(world.repo, "worktree", "remove", str(world.run.worktree(root)))
    sh(world.repo, "branch", "-D", world.run.branch("T1"))
    shutil.rmtree(world.run.dir)
    assert tg.on_completed(world.run, payload) == []  # T2 is listed in the description


def test_cleanup_reads_a_missing_description_as_an_empty_list(world: World) -> None:
    world.worktree("T1")
    sh(world.repo, "worktree", "remove", str(world.run.worktree("T1")))
    shutil.rmtree(world.run.dir)
    assert tg.check_cleanup(world.run, {"task_description": None}) == [
        f"branch left that the task description does not list: team/{world.run.name}/T1",
    ]


# --- register, supersede, resume -------------------------------------------


def test_supersede_closes_open_tasks_and_rejects_others(world: World) -> None:
    world.created("h", "[hunt] R1.P1 All")
    assert tg.supersede(world.run, ["h"]) == ["expected <gen>:<task_id>, got 'h'"]
    assert tg.supersede(world.run, ["2:h"]) == ["no open task g2 h in the register"]
    assert tg.supersede(world.run, ["1:h"]) == []
    assert tg.supersede(world.run, ["1:h"]) == ["no open task g1 h in the register"]
    assert world.register()[-1] == {"event": "superseded", "gen": 1, "task_id": "h"}


def test_a_resumed_impl_keeps_the_old_base_head(world: World) -> None:
    wt = world.worktree("T1")
    world.created("i1", "[impl:backend] T1 Build")
    base = world.feature_head
    world.commit(wt)
    tg.supersede(world.run, ["1:i1"])
    meta = json.loads((world.run.dir / "run.json").read_text(encoding="utf-8"))
    meta["generation"] = 2
    (world.run.dir / "run.json").write_text(json.dumps(meta), encoding="utf-8")
    world.created("i1", "[impl:backend] T1 Build")  # the same id again, in generation 2
    assert world.register()[-1]["base_head"] == base
    assert world.completed("i1", "[impl:backend] T1 Build") == []
    world.created("x2", "[fix:backend] T1 Again")  # nothing superseded to inherit from
    assert world.register()[-1]["base_head"] == sh(wt, "rev-parse", "HEAD")


def test_a_second_fix_starts_from_the_current_head(world: World) -> None:
    wt = world.worktree("T1")
    world.created("x1", "[fix:backend] T1 First")
    first = world.commit(wt)
    assert world.completed("x1", "[fix:backend] T1 First") == []
    world.created("x2", "[fix:backend] T1 Second")
    assert world.register()[-1]["base_head"] == first


def test_final_after_a_resume_counts_superseded_tasks_as_closed(world: World) -> None:
    merged(world)
    world.created("h1", "[hunt] R1.P1 All")  # the lead dies with this hunt still open
    meta = json.loads((world.run.dir / "run.json").read_text(encoding="utf-8"))
    meta["generation"] = 2
    (world.run.dir / "run.json").write_text(json.dumps(meta), encoding="utf-8")
    assert tg.supersede(world.run, ["1:h1"]) == []
    world.created("h1", "[hunt] R1.P1 All")  # generation 2 reuses the id
    world.verdict("h1", {"task_id": "h1", "subject": "[hunt] R1.P1 All", "role": "bug-hunter",
                         "head": world.feature_head, "findings": []}, gen=2)
    assert world.completed("h1", "[hunt] R1.P1 All") == []
    world.created("f", "[final]")
    assert world.completed("f", "[final]") == []


def test_a_resumed_fix_does_not_inherit_from_an_impl(world: World) -> None:
    wt = world.worktree("T1")
    world.created("i1", "[impl:backend] T1 Build")
    world.commit(wt)
    tg.supersede(world.run, ["1:i1"])
    world.created("x1", "[fix:backend] T1 Repair")
    assert world.register()[-1]["base_head"] == sh(wt, "rev-parse", "HEAD")


def test_post_task_update_ignores_everything_but_a_known_deletion(world: World) -> None:
    world.created("h", "[hunt] R1.P1 All")
    for payload in ({}, {"tool_input": {"status": "completed", "taskId": "h"}}, {"tool_input": {"status": "deleted"}},
                    {"tool_input": {"status": "deleted", "taskId": "nope"}}):
        assert tg.on_post_task_update(world.run, payload) == []
    assert [e["event"] for e in world.register()] == ["created"]


def test_parallel_hooks_keep_the_register_whole(world: World) -> None:
    errors: list[list[str]] = []
    threads = [threading.Thread(target=lambda i=i: errors.append(world.created(f"h{i}", f"[hunt] R1.P{i} Part"))) for i in range(1, 13)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == [[]] * 12
    assert sorted(str(e["task_id"]) for e in world.register()) == sorted(f"h{i}" for i in range(1, 13))


def test_a_stale_lock_is_broken(world: World) -> None:
    lock = world.run.dir / "register.lock"
    lock.write_text("", encoding="utf-8")
    old = time.time() - tg.STALE_LOCK_S - 5
    os.utime(lock, (old, old))
    assert world.created("h", "[hunt] R1.P1 All") == []
    assert not lock.exists()


def test_a_lock_released_while_looking_at_it_is_taken(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    lock = world.run.dir / "register.lock"
    lock.write_text("", encoding="utf-8")

    def released(path: Path) -> float | None:
        path.unlink()  # the holder lets go between our open and our stat
        return None

    real_age = tg._lock_age
    monkeypatch.setattr(tg, "_lock_age", released)
    with tg.locked(world.run, wait_s=1):
        assert lock.exists()
    assert real_age(lock) is None  # released again after the block


def test_a_held_lock_times_out_into_a_refusal(world: World) -> None:
    (world.run.dir / "register.lock").write_text("", encoding="utf-8")
    with pytest.raises(GateError, match="register lock held"), tg.locked(world.run, wait_s=0.1):
        pytest.fail("the lock must not be granted")  # pragma: no cover - reached only if locking is broken


@pytest.mark.parametrize(
    ("lines", "message"),
    [
        (['[1]'], "register line is not an object"),
        (['{"event": "created", "gen": 1}'], "without gen/task_id"),
        (['{"event": "created", "gen": 1, "task_id": "a", "subject": "nope"}'], "unparsable subject"),
        (['{"event": "completed", "gen": 1, "task_id": "a"}'], "unknown task"),
        (['{"event": "created", "gen": 1, "task_id": "a", "subject": "[final]"}', '{"event": "x", "gen": 1, "task_id": "a"}'], "unknown register event"),
    ],
)
def test_a_broken_register_refuses(world: World, lines: list[str], message: str) -> None:
    (world.run.dir / "tasks.jsonl").write_text("\n".join(lines) + "\n\n", encoding="utf-8")
    with pytest.raises(GateError, match=message):
        world.created("t", "[final]")


@pytest.mark.parametrize(
    ("meta", "message"),
    [([], "run.json is not an object"), ({"generation": "1"}, "no integer generation")],
)
def test_a_broken_run_json_refuses(world: World, meta: object, message: str) -> None:
    (world.run.dir / "run.json").write_text(json.dumps(meta), encoding="utf-8")
    with pytest.raises(GateError, match=message):
        world.created("t", "[final]")


def test_a_run_json_without_feature_branch_refuses(world: World) -> None:
    (world.run.dir / "run.json").write_text(json.dumps({"generation": 1}), encoding="utf-8")
    with pytest.raises(GateError, match="no feature_branch"):
        _ = world.run.feature


def test_head_of_a_missing_worktree_refuses(world: World) -> None:
    with pytest.raises(GateError, match="cannot read HEAD"):
        tg.head_of(world.run.dir / "nowhere")


# --- waiting (fallback of smoke test 9) ------------------------------------


def test_a_parked_task_completes_nothing_when_the_marker_is_on(world: World) -> None:
    world.worktree("T1")
    world.created("i1", "[impl:backend] T1 Build")
    assert world.completed("i1", "[impl:backend] T1 Build", description="WAITING: which port?", wait=True) == []
    assert [e["event"] for e in world.register()] == ["created"]
    assert "has no commit" in world.completed("i1", "[impl:backend] T1 Build", description="WAITING: x")[0]


# --- status.md -------------------------------------------------------------


def test_status_follows_the_run(world: World) -> None:
    merged(world, "T1")
    wt2 = world.worktree("T2")
    world.created("i2", "[impl:ux] T2 Screen")
    world.commit(wt2, "b.txt")
    world.completed("i2", "[impl:ux] T2 Screen")
    world.created("x2", "[fix:ux:conflict] T2 Rebase")
    world.worktree("T3")
    world.created("i3", "[impl:ux] T3 Other")
    world.commit(world.run.worktree("T3"), "c.txt")
    world.completed("i3", "[impl:ux] T3 Other")
    world.created("h1", "[hunt] R1.P1 All")
    patch = world.evidence("R1-P1-F1.patch", "diff\n")
    world.verdict("h1", {"task_id": "h1", "subject": "[hunt] R1.P1 All", "role": "bug-hunter", "head": world.feature_head,
                         "findings": [finding("R1-P1-F1", patch=patch)]})
    world.completed("h1", "[hunt] R1.P1 All")
    world.created("h2", "[hunt] R1.P2 More")
    world.created("h3", "[hunt] R1.P3 Gone")
    tg.supersede(world.run, ["1:h3"])
    status = (world.run.dir / "status.md").read_text(encoding="utf-8")
    assert "| T1 | merged | 1 | verify:review pass |" in status
    assert "| T2 | fix round 1 (conflict) | 1 | — |" in status
    assert "| T3 | open | 1 | — |" in status
    assert "| [hunt] R1.P1 All | completed | 1 |" in status
    assert "| [hunt] R1.P2 More | open | — |" in status
    assert "| [hunt] R1.P3 Gone | closed | — |" in status


def test_status_shows_review_states_and_green(world: World) -> None:
    _, head = build(world)
    world.created("rc", "[review:code] T1")
    assert "| T1 | review:code | 1 | verify:impl pass |" in (world.run.dir / "status.md").read_text(encoding="utf-8")
    world.created("fx", "[fix:backend] T1 Repair")
    assert "| T1 | fix round 2 |" in (world.run.dir / "status.md").read_text(encoding="utf-8")
    tg.supersede(world.run, ["1:rc", "1:fx"])
    reviewed(world, "T1", head)
    assert "| T1 | green | 2 | verify:review pass |" in (world.run.dir / "status.md").read_text(encoding="utf-8")
````

`scripts/tests/teamgate/test_entry.py` (in diesem Task ohne den Abschnitt `pre-tool-use`, den Task 3 anhängt):

````python
from __future__ import annotations

import importlib.util
import json
import subprocess
from types import ModuleType

import pytest
from conftest import SCRIPTS, World

ENTRY = SCRIPTS / "team-gate.py"


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("team_gate_entry", ENTRY)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gate = _load()


def call(world: World, event: str, payload: object, *extra: str) -> int:
    return int(gate.main(["--run", str(world.run.dir), event, *extra], json.dumps(payload)))


def test_task_created_and_completed_are_dispatched(world: World, capsys: pytest.CaptureFixture[str]) -> None:
    assert call(world, "task-created", {"task_id": "h", "task_subject": "[hunt] R1.P1 All"}) == 0
    assert call(world, "task-completed", {"task_id": "h", "task_subject": "[hunt] R1.P1 All"}) == 2
    assert "verdict missing" in capsys.readouterr().err


def test_post_task_update_is_dispatched(world: World) -> None:
    call(world, "task-created", {"task_id": "h", "task_subject": "[hunt] R1.P1 All"})
    assert call(world, "post-task-update", {"tool_input": {"status": "deleted", "taskId": "h"}}) == 0
    assert (world.run.dir / "tasks.jsonl").read_text(encoding="utf-8").count('"deleted"') == 1


def test_supersede_reads_no_payload(world: World) -> None:
    call(world, "task-created", {"task_id": "h", "task_subject": "[hunt] R1.P1 All"})
    assert gate.main(["--run", str(world.run.dir), "supersede", "1:h"], "") == 0


@pytest.mark.parametrize(
    "argv",
    [[], ["--root", "x", "task-created"], ["--run", "x", "unknown"], ["--run", "x", "supersede"]],
)
def test_wrong_usage_is_refused(argv: list[str], capsys: pytest.CaptureFixture[str]) -> None:
    assert gate.main(argv, "{}") == 2
    assert "usage:" in capsys.readouterr().err


def test_a_payload_that_is_no_object_is_refused(world: World, capsys: pytest.CaptureFixture[str]) -> None:
    assert call(world, "task-created", [1]) == 2
    assert "not a JSON object" in capsys.readouterr().err


def test_any_internal_error_refuses(world: World, capsys: pytest.CaptureFixture[str]) -> None:
    assert gate.main(["--run", str(world.run.dir), "task-created"], "{") == 2
    assert "team-gate failed, refusing: JSONDecodeError" in capsys.readouterr().err


HOOK = ["uv", "run", "--quiet", "--script", str(ENTRY)]  # exactly as the settings of a run call it


def test_the_script_runs_as_a_hook_process(world: World) -> None:
    # UTF-8 on stdin whatever the console code page is: the run folder and the title carry umlauts.
    # Through uv, because only that proves the script finds teamgate_tasks next to itself.
    payload = json.dumps({"task_id": "h", "task_subject": "[hunt] R1.P1 Prüfung"}, ensure_ascii=False).encode("utf-8")
    out = subprocess.run([*HOOK, "--run", str(world.run.dir), "task-created"], input=payload, capture_output=True, check=False)
    assert (out.returncode, out.stderr) == (0, b"")
    assert "Prüfung" in (world.run.dir / "tasks.jsonl").read_text(encoding="utf-8")
    out = subprocess.run([*HOOK, "--run", str(world.run.dir), "supersede", "1:x"], capture_output=True, check=False)
    assert (out.returncode, out.stderr.decode("utf-8").splitlines()) == (2, ["no open task g1 x in the register"])
````

- [ ] **Step 4: Permissiven Stub und Einstieg anlegen, RED zeigen**

`scripts/teamgate_tasks.py` zunächst als Stub, der jedes Tor öffnet:

````python
"""RED baseline for Task 2: the names of the real module, every gate open."""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

JsonObj = dict[str, object]
Payload = Mapping[str, object]


class GateError(Exception):
    pass


@dataclass(frozen=True)
class Title:
    kind: str
    sub: str | None
    root: str | None
    domain: str | None
    conflict: bool


def parse_title(subject: str) -> Title | None:
    return None


@dataclass(frozen=True)
class Run:
    dir: Path

    @property
    def name(self) -> str:
        return self.dir.name

    @property
    def repo(self) -> Path:
        return self.dir.parent.parent

    @property
    def feature(self) -> str:
        return ""

    def exists(self) -> bool:
        return self.dir.is_dir()

    def worktree(self, root: str) -> Path:
        return self.dir / "worktrees" / root

    def branch(self, root: str) -> str:
        return f"team/{self.name}/{root}"

    def verdict_path(self, gen: int, task_id: str) -> Path:
        return self.dir / "verdicts" / f"g{gen}-{task_id}.json"


def head_of(path: Path) -> str:
    return ""


@contextmanager
def locked(run: Run, wait_s: float = 10.0) -> Iterator[None]:
    yield


def green_at(history: list[object], head: str) -> bool:
    return False


def on_created(run: Run, payload: Payload) -> list[str]:
    return []


def on_completed(run: Run, payload: Payload, wait_marker: bool = False) -> list[str]:
    return []


def on_post_task_update(run: Run, payload: Payload) -> list[str]:
    return []


def check_cleanup(run: Run, payload: Payload) -> list[str]:
    return []


def supersede(run: Run, keys: list[str]) -> list[str]:
    return []
````

`scripts/team-gate.py` in der Fassung dieses Tasks:

````python
# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
"""Hook entry of an agent-team run: `team-gate.py --run <dir> <event>`.

Events: task-created, task-completed, post-task-update read the hook payload
from stdin; `supersede <gen>:<task_id>…` is the orchestrator's.
Exit 0 lets the event through, exit 2 refuses it with the reasons on stderr.
Every internal error refuses as well (fail-closed, spec section 6).
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import teamgate_tasks
from teamgate_tasks import Run

USAGE = "usage: team-gate.py --run <run-dir> (task-created|task-completed|post-task-update|supersede <gen>:<task_id>...)"

# Set to True only if smoke test 9 showed that parking a task fires TaskCompleted.
WAIT_MARKER = False


def dispatch(argv: list[str], stdin: str) -> list[str]:
    if len(argv) < 3 or argv[0] != "--run":
        return [USAGE]
    run = Run(Path(argv[1]))
    event, rest = argv[2], argv[3:]
    if event == "supersede":
        return teamgate_tasks.supersede(run, rest) if rest else [USAGE]
    payload = json.loads(stdin)
    if not isinstance(payload, dict):
        return ["hook payload is not a JSON object"]
    if event == "task-created":
        return teamgate_tasks.on_created(run, payload)
    if event == "task-completed":
        return teamgate_tasks.on_completed(run, payload, wait_marker=WAIT_MARKER)
    if event == "post-task-update":
        return teamgate_tasks.on_post_task_update(run, payload)
    return [USAGE]


def main(argv: list[str], stdin: str) -> int:
    try:
        reasons = dispatch(argv, stdin)
    except Exception as exc:  # noqa: BLE001 - fail-closed is the point
        reasons = [f"team-gate failed, refusing: {type(exc).__name__}: {exc}"]
    for reason in reasons:
        print(reason, file=sys.stderr)
    return 2 if reasons else 0


if __name__ == "__main__":  # pragma: no cover - runs only as a process; test_the_script_runs_as_a_hook_process
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    # The payload is UTF-8 whatever the console code page says; paths carry umlauts.
    payload = "" if sys.argv[3:4] == ["supersede"] else sys.stdin.buffer.read().decode("utf-8")
    sys.exit(main(sys.argv[1:], payload))
````

Run: `uv run --no-project --python 3.13 --with pytest --with pytest-xdist pytest scripts/tests/teamgate -q -p no:cacheprovider -n 8 > <scratch>/t2-red.txt 2>&1`
Expected: FAIL, gemessen am Prototyp 82 rot und 32 grün. Rot an `AssertionError`, `Failed: DID NOT RAISE` oder `FileNotFoundError` auf `status.md`/`tasks.jsonl` (der Stub schreibt nichts); kein `ImportError`, kein Fehler beim Sammeln. Grün sind nur Tests, die ein offenes Tor erfüllt — die 16 abgelehnten Titelformen (`parse_title` gibt `None`) und Fälle wie `test_green_at_without_history_is_false`.

- [ ] **Step 5: Den echten Code einsetzen**

`scripts/teamgate_tasks.py` ganz ersetzen:

````python
"""Task gates of an agent-team run: titles, register, verdicts, status.

Spec: docs/.superpowers/specs/2026-10-08-agent-team-design.md, sections 5 and 6.
Every check returns a list of reasons; an empty list lets the event through.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from pathlib import Path

JsonObj = dict[str, object]
Payload = Mapping[str, object]

DOMAIN = r"(?:infra|backend|frontend|ux)"
ROOT = r"(?:T[1-9][0-9]*|B[1-9][0-9]*|F)"
HEX = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
SEVERITIES = {"low", "medium", "high", "critical"}

_FORMS: list[tuple[str, re.Pattern[str]]] = [
    ("impl", re.compile(rf"^\[impl:(?P<domain>{DOMAIN})\] (?P<root>{ROOT}) \S.*$")),
    ("fix", re.compile(rf"^\[fix:(?P<domain>{DOMAIN})(?P<conflict>:conflict)?\] (?P<root>{ROOT}) \S.*$")),
    ("review", re.compile(rf"^\[review:(?P<sub>code|security)\] (?P<root>{ROOT})$")),
    ("verify", re.compile(rf"^\[verify:(?P<sub>impl|fix|review|rebase)\] (?P<root>{ROOT})$")),
    ("verify", re.compile(r"^\[verify:(?P<sub>hunt)\] (?P<root>B[1-9][0-9]*)$")),
    ("verify", re.compile(r"^\[verify:(?P<sub>final)\] (?P<root>F)$")),
    ("merge", re.compile(rf"^\[merge\] (?P<root>{ROOT})$")),
    ("hunt", re.compile(r"^\[hunt\] R[1-9][0-9]*\.P[1-9][0-9]* \S.*$")),
    ("final", re.compile(r"^\[final\]$")),
    ("cleanup", re.compile(r"^\[cleanup\]$")),
]

ROLE_OF = {
    ("review", "code"): "code-reviewer",
    ("review", "security"): "security-reviewer",
    ("hunt", None): "bug-hunter",
}

WAIT_MARKER = "WAITING:"


@dataclass(frozen=True)
class Title:
    kind: str
    sub: str | None
    root: str | None
    domain: str | None
    conflict: bool


def parse_title(subject: str) -> Title | None:
    for kind, form in _FORMS:
        m = form.match(subject)
        if m:
            g = m.groupdict()
            return Title(kind, g.get("sub"), g.get("root"), g.get("domain"), bool(g.get("conflict")))
    return None


class GateError(Exception):
    """A broken precondition that must refuse the event (fail-closed)."""


@dataclass(frozen=True)
class Run:
    dir: Path

    @property
    def name(self) -> str:
        return self.dir.name

    @property
    def repo(self) -> Path:
        return self.dir.parent.parent

    def exists(self) -> bool:
        return self.dir.is_dir()

    def meta(self) -> JsonObj:
        data = json.loads((self.dir / "run.json").read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise GateError("run.json is not an object")
        return data

    @property
    def gen(self) -> int:
        gen = self.meta().get("generation")
        if not isinstance(gen, int):
            raise GateError("run.json has no integer generation")
        return gen

    @property
    def feature(self) -> str:
        branch = self.meta().get("feature_branch")
        if not isinstance(branch, str) or not branch:
            raise GateError("run.json has no feature_branch")
        return branch

    def worktree(self, root: str) -> Path:
        return self.dir / "worktrees" / root

    def branch(self, root: str) -> str:
        return f"team/{self.name}/{root}"

    def verdict_path(self, gen: int, task_id: str) -> Path:
        return self.dir / "verdicts" / f"g{gen}-{task_id}.json"


def git(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(cwd), *args], capture_output=True, text=True, encoding="utf-8", check=False
    )


def head_of(path: Path) -> str:
    out = git(path, "rev-parse", "HEAD")
    if out.returncode != 0:
        raise GateError(f"cannot read HEAD of {path}: {out.stderr.strip()}")
    return out.stdout.strip()


# --- register --------------------------------------------------------------


STALE_LOCK_S = 60.0


def _lock_age(lock: Path) -> float | None:
    try:
        return time.time() - lock.stat().st_mtime
    except FileNotFoundError:
        return None


@contextmanager
def locked(run: Run, wait_s: float = 10.0) -> Iterator[None]:
    lock = run.dir / "register.lock"
    deadline = time.monotonic() + wait_s
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            age = _lock_age(lock)
            if age is None:
                continue  # released between open and stat
            if age > STALE_LOCK_S:
                # A hook killed while holding the lock (timeout, crash) would otherwise block the run for good.
                with suppress(FileNotFoundError):
                    os.unlink(lock)
                continue
            if time.monotonic() > deadline:
                raise GateError(f"register lock held for more than {wait_s} s: {lock}") from None
            time.sleep(0.05)
    try:
        yield
    finally:
        os.close(fd)
        os.unlink(lock)


def read_register(run: Run) -> list[JsonObj]:
    path = run.dir / "tasks.jsonl"
    if not path.exists():
        return []
    events: list[JsonObj] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            event = json.loads(line)
            if not isinstance(event, dict):
                raise GateError("register line is not an object")
            events.append(event)
    return events


def append_event(run: Run, event: JsonObj) -> None:
    with (run.dir / "tasks.jsonl").open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(event, sort_keys=True, ensure_ascii=False) + "\n")


@dataclass
class Task:
    gen: int
    task_id: str
    subject: str
    title: Title
    base_head: str | None
    completed: bool = False
    superseded: bool = False
    deleted: bool = False

    @property
    def open(self) -> bool:
        if self.completed or self.superseded:
            return False
        # Deleting closes only tasks no gate depends on (spec section 6).
        return not (self.deleted and self.title.kind in {"review", "hunt", "cleanup"})


def tasks(events: list[JsonObj]) -> tuple[dict[tuple[int, str], Task], list[Task]]:
    """All tasks by key, and the completed ones in the order they completed."""
    by_key: dict[tuple[int, str], Task] = {}
    done: list[Task] = []
    for e in events:
        gen, tid = e.get("gen"), e.get("task_id")
        if not isinstance(gen, int) or not isinstance(tid, str):
            raise GateError(f"register event without gen/task_id: {e}")
        kind = e.get("event")
        if kind == "created":
            subject = e.get("subject")
            title = parse_title(subject) if isinstance(subject, str) else None
            if title is None or not isinstance(subject, str):
                raise GateError(f"register holds an unparsable subject: {subject!r}")
            base = e.get("base_head")
            by_key[(gen, tid)] = Task(gen, tid, subject, title, base if isinstance(base, str) else None)
            continue
        task = by_key.get((gen, tid))
        if task is None:
            raise GateError(f"register event for an unknown task: {e}")
        if kind == "completed":
            task.completed = True
            done.append(task)
        elif kind == "superseded":
            task.superseded = True
        elif kind == "deleted":
            task.deleted = True
        else:
            raise GateError(f"unknown register event: {kind!r}")
    return by_key, done


# --- verdicts --------------------------------------------------------------


def load_verdict(run: Run, gen: int, task_id: str) -> JsonObj:
    path = run.verdict_path(gen, task_id)
    if not path.is_file():
        raise GateError(f"verdict missing: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise GateError(f"verdict is not JSON: {path}: {exc}") from None
    if not isinstance(data, dict):
        raise GateError(f"verdict is not an object: {path}")
    return data


def _run_file(run: Run, rel: object) -> Path | None:
    if not isinstance(rel, str) or not rel:
        return None
    path = Path(os.path.realpath(run.dir / rel))
    base = Path(os.path.realpath(run.dir))
    if os.path.normcase(os.path.commonpath([path, base])) != os.path.normcase(str(base)):
        return None
    return path if path.is_file() and path.stat().st_size > 0 else None


def _evidence_ok(run: Run, evidence: object) -> bool:
    if not isinstance(evidence, dict):
        return False
    command = evidence.get("command")
    return isinstance(command, str) and bool(command) and _run_file(run, evidence.get("output_file")) is not None


def check_verdict(run: Run, title: Title, task_id: str, subject: str, v: JsonObj) -> list[str]:
    """The rules of spec section 5 that need nothing but the verdict itself."""
    errors: list[str] = []
    if v.get("task_id") != task_id:
        errors.append("task_id does not match the task")
    if v.get("subject") != subject:
        errors.append("subject does not match the task")
    head = v.get("head")
    if not isinstance(head, str) or not HEX.match(head):
        errors.append("head is not a full commit hash")
    is_verify = title.kind == "verify"
    role = "verifier" if is_verify else ROLE_OF[(title.kind, title.sub)]
    if v.get("role") != role:
        errors.append(f"role must be {role}")
    findings = v.get("findings")
    if not isinstance(findings, list):
        return [*errors, "findings must be a list"]
    failing = False
    for i, f in enumerate(findings):
        where = f"findings[{i}]"
        if not isinstance(f, dict):
            errors.append(f"{where} is not an object")
            continue
        if not isinstance(f.get("id"), str) or not f.get("id"):
            errors.append(f"{where}.id missing")
        kind = f.get("kind")
        if kind not in {"defect", "claim"}:
            errors.append(f"{where}.kind must be defect or claim")
        if f.get("severity") not in SEVERITIES:
            errors.append(f"{where}.severity must be one of {sorted(SEVERITIES)}")
        status = f.get("status")
        if not is_verify:
            if status != "open":
                errors.append(f"{where}.status must be open: only the verifier settles findings")
            if "duplicate_of" in f:
                errors.append(f"{where}.duplicate_of is the verifier's to set")
            if title.kind == "hunt" and _run_file(run, f.get("patch")) is None:
                errors.append(f"{where}.patch must name a non-empty file in the run folder")
            continue
        if status not in {"confirmed", "refuted"}:
            errors.append(f"{where}.status must be confirmed or refuted")
        elif not _evidence_ok(run, f.get("evidence")):
            errors.append(f"{where}.evidence needs a command and a non-empty output_file in the run folder")
        dup = f.get("duplicate_of")
        if dup is not None and (title.sub != "hunt" or not isinstance(dup, str) or not re.match(r"^B[1-9][0-9]*$", dup)):
            errors.append(f"{where}.duplicate_of must be B<n>, and only in verify:hunt")
        if (kind == "defect" and status == "confirmed") or (kind == "claim" and status == "refuted"):
            failing = True
    if not is_verify:
        if "verdict" in v:
            errors.append("only verify verdicts carry a verdict")
        return errors
    if v.get("verdict") not in {"pass", "fail"}:
        errors.append("verdict must be pass or fail")
    elif (v.get("verdict") == "fail") != failing:
        errors.append("verdict must be fail exactly when a defect is confirmed or a claim refuted")
    if title.sub == "rebase":
        if not isinstance(v.get("rebased_from"), str) or not HEX.match(str(v.get("rebased_from"))):
            errors.append("verify:rebase needs rebased_from")
        inherits = v.get("inherits")
        if v.get("verdict") == "pass" and (
            not isinstance(inherits, list) or len(inherits) != 3 or not all(isinstance(x, str) for x in inherits)
        ):
            errors.append("a passing verify:rebase needs inherits: the three task ids of the trio")
        if not _evidence_ok(run, v.get("evidence")):
            errors.append("verify:rebase needs the range-diff as evidence")
    return errors


# --- history of a root -----------------------------------------------------


@dataclass(frozen=True)
class Judged:
    task: Task
    verdict: JsonObj


def judged(run: Run, done: list[Task], root: str, kinds: set[str], subs: set[str] | None = None) -> list[Judged]:
    out: list[Judged] = []
    for t in done:
        if t.title.root == root and t.title.kind in kinds and (subs is None or t.title.sub in subs):
            out.append(Judged(t, load_verdict(run, t.gen, t.task_id)))
    return out


def _ids(value: object) -> set[str]:
    return {x for x in value if isinstance(x, str)} if isinstance(value, list) else set()


def _trio(entry: Judged) -> set[str]:
    if entry.task.title.sub == "review":
        return {entry.task.task_id, *_ids(entry.verdict.get("judges"))}
    return _ids(entry.verdict.get("inherits"))


def green_at(history: list[Judged], head: str) -> bool:
    """Green per spec section 4, given verify:review/verify:rebase in completion order."""
    if not history:
        return False
    last = history[-1]
    if last.verdict.get("verdict") != "pass" or last.verdict.get("head") != head:
        return False
    if last.task.title.sub == "review":
        return True
    earlier = history[:-1]
    rebased_from = last.verdict.get("rebased_from")
    return (
        isinstance(rebased_from, str)
        and green_at(earlier, rebased_from)
        and _trio(last) == _trio(earlier[-1])
    )


def check_inherits(run: Run, title: Title, v: JsonObj, done: list[Task]) -> list[str]:
    """A passing verify:rebase may carry only the trio that was green before the rebase."""
    history = judged(run, done, str(title.root), {"verify"}, {"review", "rebase"})
    rebased_from = str(v.get("rebased_from"))
    if not green_at(history, rebased_from) or _ids(v.get("inherits")) != _trio(history[-1]):
        return ["inherits must name the trio that was green for rebased_from"]
    return []


def is_green(run: Run, done: list[Task], root: str, head: str) -> bool:
    return green_at(judged(run, done, root, {"verify"}, {"review", "rebase"}), head)


def check_judges(run: Run, title: Title, v: JsonObj, done: list[Task]) -> list[str]:
    judges = v.get("judges")
    if not isinstance(judges, list) or len(judges) != 2 or not all(isinstance(j, str) for j in judges):
        return ["verify:review needs judges: the two review task ids"]
    reviews = judged(run, done, str(title.root), {"review"})
    latest = {r.task.title.sub: r for r in reviews}  # later completions overwrite earlier ones
    if {latest[s].task.task_id for s in latest} != set(judges) or set(latest) != {"code", "security"}:
        return ["judges must be the latest completed code and security review of this root"]
    if any(latest[s].verdict.get("head") != v.get("head") for s in latest):
        return ["both reviews and the verify:review must carry the same head"]
    return []


def check_gate_log(run: Run, title: Title, v: JsonObj) -> list[str]:
    root = str(title.root)
    worktree_head = head_of(run.worktree(root))
    if v.get("head") != worktree_head:
        return [f"verdict head is not the HEAD of worktree {root}"]
    log = run.dir / "evidence" / f"gate-{root}-{worktree_head}.txt"
    if not log.is_file():
        return [f"gate log missing: {log}"]
    lines = log.read_text(encoding="utf-8").splitlines()
    if len(lines) < 2 or lines[0].strip() != worktree_head or not re.match(r"^-?[0-9]+$", lines[1].strip()):
        return ["gate log must start with the HEAD hash and the exit code"]
    if int(lines[1]) == 0:
        return []
    if v.get("verdict") == "pass":
        return ["the gate log is red, the verdict cannot be pass"]
    findings = v.get("findings")
    for f in findings if isinstance(findings, list) else []:
        if isinstance(f, dict) and f.get("kind") == "claim" and f.get("status") == "refuted":
            ev = f.get("evidence")
            if isinstance(ev, dict) and _run_file(run, ev.get("output_file")) == Path(os.path.realpath(log)):
                return []
    return ["a red gate log needs a refuted claim that carries it as evidence"]


# --- events ----------------------------------------------------------------


def _str(payload: Payload, name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value:
        raise GateError(f"payload has no {name}")
    return value


def base_head_for(run: Run, title: Title, done_and_all: dict[tuple[int, str], Task], current: str) -> str:
    """A resumed root keeps the base_head of its superseded impl/fix (spec section 7, step 6)."""
    last: Task | None = None
    for t in done_and_all.values():  # dicts keep insertion order, which is creation order
        if t.title.root == title.root and t.title.kind in {"impl", "fix"}:
            last = t
    if last and last.superseded and last.title.kind == title.kind and last.base_head:
        return last.base_head
    return current


def on_created(run: Run, payload: Payload) -> list[str]:
    if not run.exists():
        return [f"the run is closed: {run.dir} is missing"]
    task_id, subject = _str(payload, "task_id"), _str(payload, "task_subject")
    title = parse_title(subject)
    if title is None:
        return [f"task title {subject!r} matches none of the forms in spec section 5"]
    with locked(run):
        events = read_register(run)
        by_key, done = tasks(events)
        event: JsonObj = {"event": "created", "gen": run.gen, "task_id": task_id, "subject": subject}
        if title.kind in {"impl", "fix"}:
            wt = run.worktree(str(title.root))
            if not wt.is_dir():
                return [f"create the worktree {wt} before the {title.kind} task"]
            event["base_head"] = base_head_for(run, title, by_key, head_of(wt))
        if title.kind == "cleanup":
            finals = judged(run, done, "F", {"verify"}, {"final"})
            if not finals or finals[-1].verdict.get("verdict") != "pass":
                return ["[cleanup] needs a passing latest [verify:final]"]
        append_event(run, event)
        write_status(run, [*events, event])
    return []


def on_completed(run: Run, payload: Payload, wait_marker: bool = False) -> list[str]:
    task_id, subject = _str(payload, "task_id"), _str(payload, "task_subject")
    title = parse_title(subject)
    if title is not None and title.kind == "cleanup":
        # No lock, no register, no status.md: the cleaner has removed the run folder.
        return check_cleanup(run, payload)
    if not run.exists():
        return [f"the run is closed: {run.dir} is missing"]
    if title is None:
        return [f"task title {subject!r} matches none of the forms in spec section 5"]
    description = payload.get("task_description")
    if wait_marker and isinstance(description, str) and description.startswith(WAIT_MARKER):
        # Fallback of smoke test 9: a parked task is not done; record nothing.
        return []
    with locked(run):
        events = read_register(run)
        by_key, done = tasks(events)
        gen = run.gen
        task = by_key.get((gen, task_id))
        if task is None:
            return [f"task {task_id} of generation {gen} is not in the register"]
        errors = _completion_errors(run, title, task, payload, by_key, done)
        if errors:
            return errors
        event: JsonObj = {"event": "completed", "gen": gen, "task_id": task_id}
        append_event(run, event)
        write_status(run, [*events, event])
    return []


def _completion_errors(
    run: Run, title: Title, task: Task, payload: Payload, by_key: dict[tuple[int, str], Task], done: list[Task]
) -> list[str]:
    root = str(title.root)
    if title.kind in {"impl", "fix"}:
        wt = run.worktree(root)
        if git(wt, "status", "--porcelain").stdout.strip():
            return [f"worktree {root} is not clean"]
        if head_of(wt) == task.base_head:
            return [f"worktree {root} has no commit over {task.base_head}"]
        return []
    if title.kind in {"review", "verify", "hunt"}:
        v = load_verdict(run, task.gen, task.task_id)
        errors = check_verdict(run, title, task.task_id, task.subject, v)
        if errors:
            return errors
        if title.kind == "verify" and title.sub == "review":
            return check_judges(run, title, v, done)
        if title.kind == "verify" and title.sub in {"impl", "fix", "rebase"}:
            errors = check_gate_log(run, title, v)
        if not errors and title.sub == "rebase" and v.get("verdict") == "pass":
            errors = check_inherits(run, title, v, done)
        return errors
    if title.kind == "merge":
        return check_merge(run, root, done)
    return check_final(run, task, by_key, done)


def check_merge(run: Run, root: str, done: list[Task]) -> list[str]:
    branch, feature = run.branch(root), run.feature
    if git(run.repo, "merge-base", "--is-ancestor", branch, feature).returncode != 0:
        return [f"{branch} is not an ancestor of {feature}"]
    head = git(run.repo, "rev-parse", branch).stdout.strip()
    if not is_green(run, done, root, head):
        return [f"root {root} is not green for {head}"]
    return []


def roots(by_key: dict[tuple[int, str], Task]) -> list[str]:
    seen: dict[str, None] = {}
    for t in by_key.values():
        if t.title.kind in {"impl", "fix"} and t.title.root:
            seen[t.title.root] = None
    return list(seen)


def check_final(run: Run, final: Task, by_key: dict[tuple[int, str], Task], done: list[Task]) -> list[str]:
    errors = [
        f"open task: {t.subject} ({t.task_id}, g{t.gen})"
        for t in by_key.values()
        if t.open and t is not final
    ]
    feature = run.feature
    for root in roots(by_key):
        if not any(t.title.kind == "merge" and t.title.root == root for t in done):
            errors.append(f"root {root} has no completed [merge]")
        elif git(run.repo, "merge-base", "--is-ancestor", run.branch(root), feature).returncode != 0:
            errors.append(f"{run.branch(root)} is not an ancestor of {feature}")
        verdicts = judged(run, done, root, {"verify"})
        if verdicts and verdicts[-1].verdict.get("verdict") == "fail":
            errors.append(f"the latest verify verdict of root {root} is fail")
    return errors


def check_cleanup(run: Run, payload: Payload) -> list[str]:
    errors: list[str] = []
    listing = git(run.repo, "worktree", "list", "--porcelain").stdout
    prefix = os.path.normcase(os.path.realpath(run.dir / "worktrees"))
    for line in listing.splitlines():
        if line.startswith("worktree "):
            listed = Path(line[len("worktree "):])
            if os.path.normcase(os.path.realpath(listed)).startswith(prefix):
                errors.append(f"worktree still registered: {listed}")
    description = payload.get("task_description")
    allowed = set(re.findall(rf"team/{re.escape(run.name)}/\S+", description if isinstance(description, str) else ""))
    branches = git(run.repo, "branch", "--list", f"team/{run.name}/*", "--format=%(refname:short)").stdout.split()
    errors += [f"branch left that the task description does not list: {b}" for b in branches if b not in allowed]
    if run.exists():
        errors.append(f"run folder still exists: {run.dir}")
    return errors


def on_post_task_update(run: Run, payload: Payload) -> list[str]:
    tool_input = payload.get("tool_input")
    if not run.exists() or not isinstance(tool_input, dict) or tool_input.get("status") != "deleted":
        return []
    task_id = tool_input.get("taskId")
    if not isinstance(task_id, str):
        return []
    with locked(run):
        events = read_register(run)
        by_key, _ = tasks(events)
        if (run.gen, task_id) not in by_key:
            return []
        event: JsonObj = {"event": "deleted", "gen": run.gen, "task_id": task_id}
        append_event(run, event)
        write_status(run, [*events, event])
    return []


def supersede(run: Run, keys: list[str]) -> list[str]:
    """`supersede <gen>:<task_id>…` for the orchestrator after a resume."""
    parsed: list[tuple[int, str]] = []
    for k in keys:
        m = re.match(r"^([1-9][0-9]*):(\S+)$", k)
        if not m:
            return [f"expected <gen>:<task_id>, got {k!r}"]
        parsed.append((int(m.group(1)), m.group(2)))
    with locked(run):
        events = read_register(run)
        by_key, _ = tasks(events)
        for gen_id in parsed:
            if gen_id not in by_key or not by_key[gen_id].open:
                return [f"no open task g{gen_id[0]} {gen_id[1]} in the register"]
        new: list[JsonObj] = [{"event": "superseded", "gen": g, "task_id": t} for g, t in parsed]
        for e in new:
            append_event(run, e)
        write_status(run, [*events, *new])
    return []


# --- status.md -------------------------------------------------------------


def _state(root: str, by_key: dict[tuple[int, str], Task], done: list[Task], rounds: int, run: Run) -> str:
    if any(t.title.kind == "merge" and t.title.root == root for t in done):
        return "merged"
    open_tasks = [t for t in by_key.values() if t.title.root == root and t.open and t.title.kind != "merge"]
    if open_tasks:
        t = open_tasks[-1].title
        if t.kind == "fix":
            return f"fix round {rounds}" + (" (conflict)" if t.conflict else "")
        return f"{t.kind}:{t.sub}" if t.sub else t.kind
    history = [t for t in done if t.title.root == root and t.title.kind == "verify" and t.title.sub in {"review", "rebase"}]
    if history and run.verdict_path(history[-1].gen, history[-1].task_id).is_file():
        if load_verdict(run, history[-1].gen, history[-1].task_id).get("verdict") == "pass":
            return "green"
    return "open"


def write_status(run: Run, events: list[JsonObj]) -> None:
    by_key, done = tasks(events)
    meta = run.meta()
    lines = [
        f"# Team run {run.name}",
        "",
        f"Generation {meta.get('generation')} · feature branch `{meta.get('feature_branch')}`",
        "",
        "| Root | State | Rounds | Latest verdict |",
        "|---|---|---|---|",
    ]
    for root in roots(by_key):
        rounds = sum(
            1 for t in by_key.values()
            if t.title.root == root and t.title.kind in {"impl", "fix"} and not t.title.conflict
        )
        latest = "—"
        for t in reversed(done):
            if t.title.root == root and t.title.kind == "verify" and run.verdict_path(t.gen, t.task_id).is_file():
                latest = f"verify:{t.title.sub} {load_verdict(run, t.gen, t.task_id).get('verdict')}"
                break
        lines.append(f"| {root} | {_state(root, by_key, done, rounds, run)} | {rounds} | {latest} |")
    hunts = [t for t in by_key.values() if t.title.kind == "hunt"]
    if hunts:
        lines += ["", "## Hunt", "", "| Task | State | Findings |", "|---|---|---|"]
        for t in hunts:
            findings = "—"
            if t.completed:
                found = load_verdict(run, t.gen, t.task_id).get("findings")
                findings = str(len(found)) if isinstance(found, list) else "—"
            state = "completed" if t.completed else ("open" if t.open else "closed")
            lines.append(f"| {t.subject} | {state} | {findings} |")
    target = run.dir / "status.md"
    tmp = run.dir / "status.md.tmp"
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    os.replace(tmp, target)
````

- [ ] **Step 6: Rückfall Rauchtest 9 (nur wenn Rauchtest 9 durchfiel)**

In `scripts/team-gate.py` `WAIT_MARKER = False` auf `WAIT_MARKER = True` setzen. Der Test `test_a_parked_task_completes_nothing_when_the_marker_is_on` deckt beide Stellungen schon ab. Fiel Rauchtest 9 nicht durch, bleibt der Schalter aus.

- [ ] **Step 7: GREEN, Coverage, Typen**

Run: `uv run --no-project --python 3.13 --with pytest --with pytest-cov --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate -q -p no:cacheprovider -n 8 --cov=scripts --cov-branch --cov-report=term-missing --cov-fail-under=100`
Expected: PASS, `Required test coverage of 100% reached` (in diesem Task gibt es `teamgate_cmd.py` noch nicht; `--cov=scripts` misst also `team-gate.py`, `teamgate_tasks.py` und die Tests).

Run: `MYPYPATH="scripts;scripts/tests/teamgate" uvx --python 3.13 --with pytest --with types-PyYAML mypy --strict --explicit-package-bases scripts/team-gate.py scripts/teamgate_tasks.py scripts/tests/teamgate`
Expected: `Success: no issues found`

- [ ] **Step 8: Mutationsrunde**

`<scratch>/mutants.py` (einmal anlegen, Task 3 nutzt es wieder):

````python
"""Mutation round: apply each mutant, run the given tests, restore.

Usage: python -B mutants.py <mutants.json> <pytest args…>
<mutants.json> is a list of {"file", "old", "new"}; "old" must occur exactly
once. A mutant counts as killed only if pytest fails with test failures
(exit 1); a collection or usage error (exit 2-4) is reported as BADMUTANT.
"""

import json
import subprocess
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    mutants = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    pytest_args = argv[1:]
    survived = bad = 0
    for m in mutants:
        path = Path(m["file"])
        original = path.read_text(encoding="utf-8")
        if original.count(m["old"]) != 1:
            print(f"BADMUTANT {path}: {m['old']!r} occurs {original.count(m['old'])} times", flush=True)
            bad += 1
            continue
        path.write_text(original.replace(m["old"], m["new"]), encoding="utf-8", newline="\n")
        try:
            out = subprocess.run(
                ["uv", "run", "--no-project", "--python", "3.13", "--with", "pytest", "--with", "pytest-xdist",
                 # No -x: with pytest-xdist a stop after the first failure exits 2, which reads as a bad mutant.
                 "--with", "pyyaml", "python", "-B", "-m", "pytest", "-q", "-p", "no:cacheprovider", *pytest_args],
                capture_output=True, text=True, timeout=900, check=False,
            )
        finally:
            path.write_text(original, encoding="utf-8", newline="\n")
        if out.returncode == 1:
            failed = [line for line in out.stdout.splitlines() if line.startswith("FAILED")]
            print(f"killed    {path.name}: {m['old'][:60]!r} by {failed[0] if failed else '?'}", flush=True)
        elif out.returncode == 0:
            survived += 1
            print(f"SURVIVED  {path.name}: {m['old'][:60]!r}", flush=True)
        else:
            bad += 1
            print(f"BADMUTANT {path.name}: {m['old'][:60]!r} pytest exit {out.returncode}", flush=True)
    print(f"{len(mutants)} mutants, {survived} survived, {bad} bad")
    return 1 if survived or bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
````

`<scratch>/mutants-task2.json`:

````json
[
  {"file": "scripts/teamgate_tasks.py", "old": "return not (self.deleted and self.title.kind in {\"review\", \"hunt\", \"cleanup\"})", "new": "return not self.deleted"},
  {"file": "scripts/teamgate_tasks.py", "old": "if head_of(wt) == task.base_head:", "new": "if False:"},
  {"file": "scripts/teamgate_tasks.py", "old": "if git(wt, \"status\", \"--porcelain\").stdout.strip():", "new": "if False:"},
  {"file": "scripts/teamgate_tasks.py", "old": "elif (v.get(\"verdict\") == \"fail\") != failing:", "new": "elif False:"},
  {"file": "scripts/teamgate_tasks.py", "old": "if int(lines[1]) == 0:", "new": "if int(lines[1]) <= 1:"},
  {"file": "scripts/teamgate_tasks.py", "old": "and _trio(last) == _trio(earlier[-1])", "new": ""},
  {"file": "scripts/teamgate_tasks.py", "old": "if any(latest[s].verdict.get(\"head\") != v.get(\"head\") for s in latest):", "new": "if False:"},
  {"file": "scripts/teamgate_tasks.py", "old": "if last and last.superseded and last.title.kind == title.kind and last.base_head:", "new": "if last and last.title.kind == title.kind and last.base_head:"},
  {"file": "scripts/teamgate_tasks.py", "old": "if t.open and t is not final", "new": "if t.open"},
  {"file": "scripts/teamgate_tasks.py", "old": "if verdicts and verdicts[-1].verdict.get(\"verdict\") == \"fail\":", "new": "if verdicts and verdicts[0].verdict.get(\"verdict\") == \"fail\":"},
  {"file": "scripts/teamgate_tasks.py", "old": "if not finals or finals[-1].verdict.get(\"verdict\") != \"pass\":", "new": "if not finals:"},
  {"file": "scripts/teamgate_tasks.py", "old": "if run.exists():\n        errors.append", "new": "if False:\n        errors.append"},
  {"file": "scripts/teamgate_tasks.py", "old": "if age > STALE_LOCK_S:", "new": "if False:"},
  {"file": "scripts/teamgate_tasks.py", "old": "if not green_at(history, rebased_from) or _ids(v.get(\"inherits\")) != _trio(history[-1]):", "new": "if not green_at(history, rebased_from):"},
  {"file": "scripts/teamgate_tasks.py", "old": "if {latest[s].task.task_id for s in latest} != set(judges) or set(latest) != {\"code\", \"security\"}:", "new": "if set(latest) != {\"code\", \"security\"}:"},
  {"file": "scripts/teamgate_tasks.py", "old": "if title.kind == \"hunt\" and _run_file(run, f.get(\"patch\")) is None:", "new": "if False:"},
  {"file": "scripts/teamgate_tasks.py", "old": "if os.path.normcase(os.path.commonpath([path, base])) != os.path.normcase(str(base)):", "new": "if False:"},
  {"file": "scripts/teamgate_tasks.py", "old": "if git(run.repo, \"merge-base\", \"--is-ancestor\", branch, feature).returncode != 0:", "new": "if False:"},
  {"file": "scripts/teamgate_tasks.py", "old": "for b in branches if b not in allowed]", "new": "for b in branches if False]"},
  {"file": "scripts/teamgate_tasks.py", "old": "if title is not None and title.kind == \"cleanup\":", "new": "if title is not None and title.kind == \"cleanup\" and not run.exists():"},
  {"file": "scripts/teamgate_tasks.py", "old": "if t.title.root == root and t.title.kind in {\"impl\", \"fix\"} and not t.title.conflict", "new": "if t.title.root == root and t.title.kind in {\"impl\", \"fix\"}"}
]
````

Run: `python -B <scratch>/mutants.py <scratch>/mutants-task2.json -n 8 scripts/tests/teamgate/test_tasks.py scripts/tests/teamgate/test_entry.py > <scratch>/t2-mutants.txt 2>&1`
Expected: `21 mutants, 0 survived, 0 bad`. Überlebt einer: Test ergänzen, der genau ihn tötet, und die Runde wiederholen. Kein `-x` an pytest: mit xdist endet ein Abbruch nach dem ersten Fehler mit Exit 2, und der Runner wertet das richtig als `BADMUTANT`, nicht als getötet.

Danach, und nach jedem Abbruch der Runde (Strg+C, Timeout — dann läuft `finally` nicht und der Mutant bleibt im Baum), mit `<scratch>/check_clean.py` prüfen, dass jeder Originaltext wieder genau einmal dasteht:

````python
"""Every mutant's original text is back in place exactly once."""

import json
import sys
from pathlib import Path

ok = True
for name in sys.argv[1:]:
    for m in json.loads(Path(name).read_text(encoding="utf-8")):
        count = Path(m["file"]).read_text(encoding="utf-8").count(m["old"])
        if count != 1:
            ok = False
            print(f"{m['file']}: {m['old'][:60]!r} occurs {count}x")
print("clean" if ok else "MUTANT LEFT")
````

Run: `python -B <scratch>/check_clean.py <scratch>/mutants-task2.json`
Expected: `clean`.

- [ ] **Step 9: Commit**

```bash
git add scripts/team-gate.py scripts/teamgate_tasks.py scripts/tests/teamgate/conftest.py scripts/tests/teamgate/test_tasks.py scripts/tests/teamgate/test_entry.py
git commit -m "Add the task gates of an agent-team run"
```

### Task 3: Befehlsprüfung — `teamgate_cmd.py`

**Files:**
- Create: `scripts/teamgate_cmd.py` (Zerlegen, Auspacken, Pfadauflösung, Regeln aus Spec Abschnitt 6 und 15.9)
- Modify: `scripts/team-gate.py` (Ereignis `pre-tool-use`)
- Test: `scripts/tests/teamgate/test_cmd.py`; Modify: `scripts/tests/teamgate/test_entry.py` (Abschnitt anhängen)

**Interfaces:**
- Consumes: aus Task 2 `Run`, `GateError`, die Testwelt `World`, `FEATURE`, `RUN_NAME`, `sh`.
- Produces: `teamgate_cmd.on_pre_tool_use(run: Run, payload: Mapping[str, object]) -> list[str]`; Kommandozeile `uv run --script scripts/team-gate.py --run <lauf> pre-tool-use` (Nutzlast mit `tool_name` `Bash`/`PowerShell`, `tool_input.command`, `cwd`). Task 5 trägt sie als `PreToolUse` mit Matcher `Bash|PowerShell` ein.

- [ ] **Step 1: Batterie schreiben**

`scripts/tests/teamgate/test_cmd.py` — jede Form der Tabelle in Spec Abschnitt 6, je mit Gegenzeilen, in Bash und PowerShell. Pfade in den Zeilen stehen in Anführungszeichen, weil die Testwelt unter `Prüf Repo` liegt:

````python
"""Battery for the command check: every form of the table in spec section 6,
each next to lines that must still go through, in Bash and PowerShell."""

from __future__ import annotations

import base64
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from conftest import FEATURE, RUN_NAME, World, sh

import teamgate_cmd as tc
from teamgate_tasks import GateError

TEAM = f"team/{RUN_NAME}"


def fill(line: str, w: World, wt: Path) -> str:
    return (
        line.replace("{run}", w.run.dir.as_posix())
        .replace("{repo}", w.repo.as_posix())
        .replace("{wt}", wt.as_posix())
        .replace("{team}", TEAM)
    )


def check(w: World, line: str, dialect: str, cwd: Path | None = None) -> str | None:
    ctx = tc.Context(w.run, cwd or w.repo, FEATURE)
    return tc.check_command(line, dialect, ctx)


@pytest.fixture
def wt(world: World) -> Path:
    return world.worktree("T1")


DENY_BASH = [
    # publish
    "git push",
    "git push origin feat/x",
    '"C:/Program Files/Git/cmd/git.exe" push',
    "/c/Program\\ Files/Git/cmd/git push",
    "git -C . push",
    "git --no-pager -c color.ui=never push",
    "echo hi; git push",
    "true && git push",
    "false || git push",
    "sleep 1 & git push",
    "git status\ngit push",
    "env FOO=1 git push",
    "env -u HOME git push",
    "FOO=1 BAR=2 git push",
    "nohup git push",
    'bash -c "git push"',
    "sh -lc 'git push'",
    "cmd /c git push",
    'cmd /C "git push"',
    'pwsh -Command "git push"',
    "echo $(git push)",
    'echo "$(git push)"',
    "echo `git push`",
    "( git push )",
    "{ git push; }",
    "gh pr merge 5",
    "gh api -X PUT repos/o/r/pulls/5/merge",
    # gates
    "git commit -n -m x",
    "git commit -anm x",
    "git commit -m x -n",
    "git commit --no-verify -m x",
    "git commit --no-verif -m x",
    "git commit --no-ve",
    "git -c core.hooksPath=/dev/null commit -m x",
    "git -c CORE.HOOKSPATH=x commit -m x",
    "git --config-env core.hooksPath=X commit -m x",
    "git config core.hooksPath x",
    "git commit-tree HEAD^{tree}",
    "git update-ref refs/heads/x HEAD",
    # branches with force
    "git branch -D x",
    "git branch -d -f {team}/T1",
    "git branch -df {team}/T1",
    "git branch --delete --force {team}/T1",
    "git branch --del --forc {team}/T1",
    "git branch -f feat/x HEAD",
    "git branch --force refs/heads/feat/x HEAD",
    "git branch -M other feat/x",
    "git branch --move --force other feat/x",
    # branches outside the run
    "git branch -d main",
    "git branch -d {team}/T1 main",
    "git branch -d",
    "git branch --delete-merged refs/heads/feat/x",
    "git branch --delete-merged refs/heads/feat/x 'team/*'",
    "git branch --delete-m refs/heads/feat/x main",
    # reset on the feature branch
    "git reset --hard",
    "git reset --hard HEAD~1",
    'git -C "{repo}" reset --har',
    # worktrees
    'git worktree remove --force "{wt}"',
    'git worktree remove -f "{wt}"',
    'git worktree remove "{repo}/elsewhere"',
    'git worktree remove "{run}/worktrees"',
    "git worktree remove $TEAMGATE_SURELY_UNSET/x",
    # clean
    "git clean -fdx",
    "git clean -x",
    "git clean -fX",
    "git clean -ff",
    "git clean -f -f",
    "git clean --force --force",
    "git clean -d -f",
    # recursive delete
    "rm -rf /c/Users/x",
    "rm -r src",
    "rm -fr src",
    "rm -R src",
    "rm --recursive src",
    'rm -r "{wt}"',
    'rm -r "$TEAM_RUN_DIR/worktrees/T1"',
    'rm -rf "$TEAM_RUN_DIR"',
    "rm -rf ${TEAM_RUN_DIR}/..",
    "rm -r $TEAMGATE_SURELY_UNSET/x",
    "rm -r ~/x",
    "rm -r *",
    "find . -delete",
    "find src -name x -delete",
    "cmd /c rd /s /q src",
    "cmd /c rmdir /q /s src",
    'cmd /c "rd /S src"',
    "cd /c/Windows && rm -rf temp",
    # parser corners
    "echo \"$(echo ')'; git push)\"",
    "echo $( (git push) )",
    "git \\\npush",
    'echo "`git push`"',
    "cmd /d /c git push",
    "bash -x -c 'git push'",
    "rm -r $HOME/x",
    "rm -r -- src",
    "git -C $TEAMGATE_SURELY_UNSET status",
    "cd $TEAMGATE_SURELY_UNSET && ls",
    # neighbours of the allowed forms: they must stay refused
    'cd "$TEAM_RUN_DIR" && bash -c "rm -r ../../src"',
    "git branch -d {team}/T1 ../main",
    'git worktree remove "$TEAM_RUN_DIR/worktrees/../../x"',
    'rm -rf "$TEAM_RUN_DIR/worktrees/T1/../T1"',
]

ALLOW_BASH = [
    "git status",
    'echo "git push"',
    "git log --oneline -3",
    'git commit -m "handle -n in the parser"',
    "git commit -m -n",
    "git commit --message -n",
    "git commit -uno -m x",
    "git commit --no-edit --amend",
    "git commit -am x",
    "git -c user.name=x commit -m y",
    "git config --get core.hooksPath",
    "git branch -d {team}/T1",
    'git branch --delete-merged refs/heads/feat/x "{team}/*"',
    "git branch --dry-run --delete-merged refs/heads/feat/x '{team}/*'",
    "git branch -f other HEAD",
    "git branch --list '{team}/*'",
    "git branch -m old new",
    "git branch -u origin/x",
    'git worktree remove "{wt}"',
    'git worktree remove "$TEAM_RUN_DIR/worktrees/T1"',
    "git worktree list",
    "git clean -n",
    "git clean -f",
    'git -C "{wt}" reset --hard HEAD',
    'rm -r "$TEAM_RUN_DIR/evidence"',
    "rm -rf $TEAM_RUN_DIR/verdicts",
    "rm file.txt",
    "rm -f a b",
    'rm "{repo}/.team-runs/.gitignore"',
    'rmdir "{repo}/.team-runs"',
    "cd $TEAM_RUN_DIR && rm -rf evidence",
    "find . -name x",
    "gh pr view 5",
    "gh api repos/o/r/pulls/5",
    "ls -la # git push",
    "echo hi > out.txt 2>&1",
    "echo x &> log",
    # parser corners
    'echo "say \\"git push\\""',
    "echo x >out.txt",
    "cmd /?",
    "bash script.sh",
    "env",
    "git clean -n -- -x",
    "git branch --list -- --delete",
    "git branch -d --contains main {team}/T1",
    "git --version",
    "git commit -m x -- --no-verify",
    "git reset --soft HEAD~1",
    "echo $(git status)",
    "bash -c 'git status'",
    "cd && ls",
]


@pytest.mark.parametrize("line", DENY_BASH)
def test_bash_lines_that_are_refused(world: World, wt: Path, line: str) -> None:
    assert check(world, fill(line, world, wt), tc.BASH) is not None


@pytest.mark.parametrize("line", ALLOW_BASH)
def test_bash_lines_that_go_through(world: World, wt: Path, line: str) -> None:
    assert check(world, fill(line, world, wt), tc.BASH) is None


def _encoded(command: str) -> str:
    return base64.b64encode(command.encode("utf-16-le")).decode("ascii")


DENY_PWSH = [
    "git push",
    "& git push",
    '& "C:/Program Files/Git/cmd/git.exe" push',
    ". git push",
    'iex "git push"',
    "Invoke-Expression 'git push'",
    "Invoke-Expression -Command 'git push'",
    "Start-Process git -ArgumentList push",
    "Start-Process -FilePath git -ArgumentList 'push','origin'",
    'Start-Process -FilePath "C:/Program Files/Git/cmd/git.exe" -ArgumentList push',
    'powershell -c "git push"',
    f"pwsh -EncodedCommand {_encoded('git push')}",
    f"pwsh -enc {_encoded('git push')}",
    "$x = $(git push)",
    'Write-Host "$(git push)"',
    "if ($true) { git push }",
    "git status; git push",
    "git status && git push",
    "git commit -n -m x",
    "Remove-Item -Recurse src",
    "Remove-Item src -r",
    "ri src -Rec",
    "del src -recurse",
    "rm src -Recurse:$true",
    "rd src -Recurse",
    "Remove-Item -Path src,lib -Recurse",
    "Get-ChildItem src -Recurse | Remove-Item",
    "gci -r src | ri",
    "[IO.Directory]::Delete('C:/x', $true)",
    '[System.IO.Directory]::Delete("$env:TEAM_RUN_DIR/worktrees/T1", $true)',
    'Remove-Item "$env:TEAM_RUN_DIR" -Recurse -Force',
    "Remove-Item $env:TEAMGATE_SURELY_UNSET -Recurse",
    "Get-ChildItem | ForEach-Object { Remove-Item $_ -Recurse }",
    "Set-Location C:/Windows; Remove-Item -Recurse temp",
    "Start-Process -WindowStyle Hidden git -ArgumentList push",
    "Start-Process -NoNewWindow -FilePath git -ArgumentList push",
    "Start-Process git push",
    'Remove-Item -Recurse "$env:TEAM_RUN_DIR/../.."',
]

ALLOW_PWSH = [
    "git status",
    "Write-Host 'git push'",
    "Write-Host 'Remove-Item -Recurse x'",
    "Get-ChildItem -Recurse src | Select-Object Name",
    "Remove-Item file.txt",
    'Remove-Item "$env:TEAM_RUN_DIR/evidence" -Recurse',
    'rmdir "{repo}/.team-runs"',
    "[IO.Directory]::Delete('C:/x', $false)",
    "Start-Process notepad",
    "git commit -m 'it''s fine'",
    "& git status",
    "pwsh -File build.ps1",
    "Start-Process",
    '[IO.Directory]::Delete("$env:TEAM_RUN_DIR/evidence", $true)',
    "Get-ChildItem *.tmp | Remove-Item",
]


@pytest.mark.parametrize("line", DENY_PWSH)
def test_powershell_lines_that_are_refused(world: World, wt: Path, line: str) -> None:
    assert check(world, fill(line, world, wt), tc.PWSH) is not None


@pytest.mark.parametrize("line", ALLOW_PWSH)
def test_powershell_lines_that_go_through(world: World, wt: Path, line: str) -> None:
    assert check(world, fill(line, world, wt), tc.PWSH) is None


def test_reset_hard_is_free_in_the_own_worktree(world: World, wt: Path) -> None:
    assert check(world, "git reset --hard HEAD", tc.BASH, cwd=wt) is None


def test_reset_hard_is_free_on_a_detached_head(world: World) -> None:
    sh(world.repo, "switch", "-q", "--detach")
    assert check(world, "git reset --hard", tc.BASH) is None


def test_the_run_folder_may_go_once_its_worktrees_are_gone(world: World) -> None:
    assert check(world, 'rm -rf "$TEAM_RUN_DIR"', tc.BASH) is None
    assert check(world, 'Remove-Item -Recurse -Force "$env:TEAM_RUN_DIR"', tc.PWSH) is None


def test_without_a_known_feature_branch_force_and_reset_fail_closed(world: World, wt: Path) -> None:
    ctx = tc.Context(world.run, world.repo, None)
    assert tc.check_command("git branch -f other HEAD", tc.BASH, ctx) is not None
    assert tc.check_command("git reset --hard", tc.BASH, tc.Context(world.run, wt, None)) is not None


@pytest.mark.parametrize("line", ["echo 'open", 'echo "open', "echo `open", "echo $(open", '"$(open"', 'echo "`open"'])
def test_a_line_that_does_not_parse_is_an_error(world: World, line: str) -> None:
    with pytest.raises(GateError):
        check(world, line, tc.BASH)


def test_a_broken_encoded_command_is_an_error(world: World) -> None:
    with pytest.raises(GateError, match="EncodedCommand"):
        check(world, "pwsh -e !!!", tc.PWSH)


def test_launchers_nested_too_deep_are_refused(world: World) -> None:
    deep = "git status"
    for _ in range(10):
        deep = "iex '" + deep.replace("'", "''") + "'"
    assert check(world, deep, tc.PWSH) == "command nests launchers too deeply to check"
    assert check(world, "bash -c 'bash -c \"bash -c true\"'", tc.BASH) is None


# --- hook entry ------------------------------------------------------------


def test_on_pre_tool_use_reads_the_payload(world: World) -> None:
    payload = {"tool_name": "Bash", "tool_input": {"command": "git push"}, "cwd": world.repo.as_posix()}
    assert tc.on_pre_tool_use(world.run, payload) == ["git push is the human's"]
    payload = {"tool_name": "PowerShell", "tool_input": {"command": "git status"}}
    assert tc.on_pre_tool_use(world.run, payload) == []


@pytest.mark.parametrize(
    "payload",
    [{"tool_name": "Read", "tool_input": {}}, {"tool_name": "Bash"}, {"tool_name": "Bash", "tool_input": {"command": 1}}],
)
def test_on_pre_tool_use_ignores_other_tools(world: World, payload: dict[str, object]) -> None:
    assert tc.on_pre_tool_use(world.run, payload) == []


def test_on_pre_tool_use_works_without_the_run_folder(world: World) -> None:
    shutil.rmtree(world.run.dir)
    payload = {"tool_name": "Bash", "tool_input": {"command": "git branch -f other HEAD"}, "cwd": str(world.repo)}
    assert tc.on_pre_tool_use(world.run, payload) == ["git branch --force must not move the feature branch"]


@pytest.mark.skipif(sys.platform != "win32", reason="junctions are a Windows feature")
def test_a_junction_is_judged_by_its_target(world: World, tmp_path: Path) -> None:
    inside, outside = tmp_path / "into-run", tmp_path / "into-repo"
    (world.repo / "src").mkdir()
    for link, target in ((inside, world.run.dir / "evidence"), (outside, world.repo / "src")):
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True, capture_output=True)
    assert check(world, f'rm -r "{inside.as_posix()}/scratch"', tc.BASH) is None
    assert check(world, f'rm -r "{outside.as_posix()}"', tc.BASH) == f"recursive delete outside the run folder: {outside.as_posix()}"


def test_paths_on_two_drives_are_not_within_each_other() -> None:
    assert tc.within(Path("C:/a"), Path("D:/a")) is False
````

An `scripts/tests/teamgate/test_entry.py` anhängen:

````python
# --- pre-tool-use (Task 3) ---


def test_pre_tool_use_is_dispatched(world: World, capsys: pytest.CaptureFixture[str]) -> None:
    assert call(world, "pre-tool-use", {"tool_name": "Bash", "tool_input": {"command": "git push"}}) == 2
    assert capsys.readouterr().err == "git push is the human's\n"
    assert call(world, "pre-tool-use", {"tool_name": "PowerShell", "tool_input": {"command": "git status"}}) == 0
````

- [ ] **Step 2: Stub und Einstieg, RED zeigen**

`scripts/teamgate_cmd.py` als Stub, der alles erlaubt:

````python
"""RED baseline for Task 3: the names of the real module, every command allowed."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from teamgate_tasks import Run

BASH, PWSH = "bash", "powershell"


@dataclass
class Context:
    run: Run
    cwd: Path
    feature: str | None


def within(child: Path, parent: Path) -> bool:
    return False


def check_command(command: str, dialect: str, ctx: Context, depth: int = 0) -> str | None:
    return None


def on_pre_tool_use(run: Run, payload: Mapping[str, object]) -> list[str]:
    return []
````

`scripts/team-gate.py` erhält das Ereignis — drei Änderungen gegenüber Task 2:

```python
import teamgate_cmd
import teamgate_tasks
from teamgate_tasks import Run

USAGE = "usage: team-gate.py --run <run-dir> (task-created|task-completed|post-task-update|pre-tool-use|supersede <gen>:<task_id>...)"
```

und in `dispatch` vor dem letzten `return [USAGE]`:

```python
    if event == "pre-tool-use":
        return teamgate_cmd.on_pre_tool_use(run, payload)
```

sowie im Docstring `post-task-update, pre-tool-use read the hook payload`. Die ganze Datei danach:

````python
# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
"""Hook entry of an agent-team run: `team-gate.py --run <dir> <event>`.

Events: task-created, task-completed, post-task-update, pre-tool-use read the
hook payload from stdin; `supersede <gen>:<task_id>…` is the orchestrator's.
Exit 0 lets the event through, exit 2 refuses it with the reasons on stderr.
Every internal error refuses as well (fail-closed, spec section 6).
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import teamgate_cmd
import teamgate_tasks
from teamgate_tasks import Run

USAGE = "usage: team-gate.py --run <run-dir> (task-created|task-completed|post-task-update|pre-tool-use|supersede <gen>:<task_id>...)"

# Set to True only if smoke test 9 showed that parking a task fires TaskCompleted.
WAIT_MARKER = False


def dispatch(argv: list[str], stdin: str) -> list[str]:
    if len(argv) < 3 or argv[0] != "--run":
        return [USAGE]
    run = Run(Path(argv[1]))
    event, rest = argv[2], argv[3:]
    if event == "supersede":
        return teamgate_tasks.supersede(run, rest) if rest else [USAGE]
    payload = json.loads(stdin)
    if not isinstance(payload, dict):
        return ["hook payload is not a JSON object"]
    if event == "task-created":
        return teamgate_tasks.on_created(run, payload)
    if event == "task-completed":
        return teamgate_tasks.on_completed(run, payload, wait_marker=WAIT_MARKER)
    if event == "post-task-update":
        return teamgate_tasks.on_post_task_update(run, payload)
    if event == "pre-tool-use":
        return teamgate_cmd.on_pre_tool_use(run, payload)
    return [USAGE]


def main(argv: list[str], stdin: str) -> int:
    try:
        reasons = dispatch(argv, stdin)
    except Exception as exc:  # noqa: BLE001 - fail-closed is the point
        reasons = [f"team-gate failed, refusing: {type(exc).__name__}: {exc}"]
    for reason in reasons:
        print(reason, file=sys.stderr)
    return 2 if reasons else 0


if __name__ == "__main__":  # pragma: no cover - runs only as a process; test_the_script_runs_as_a_hook_process
    for stream in (sys.stdout, sys.stderr):
        if isinstance(stream, io.TextIOWrapper):
            stream.reconfigure(encoding="utf-8")
    # The payload is UTF-8 whatever the console code page says; paths carry umlauts.
    payload = "" if sys.argv[3:4] == ["supersede"] else sys.stdin.buffer.read().decode("utf-8")
    sys.exit(main(sys.argv[1:], payload))
````

Run: `uv run --no-project --python 3.13 --with pytest --with pytest-xdist pytest scripts/tests/teamgate/test_cmd.py scripts/tests/teamgate/test_entry.py -q -p no:cacheprovider -n 8 > <scratch>/t3-red.txt 2>&1`
Expected: FAIL an Assertions, gemessen am Prototyp 152 rot und 83 grün — rot alle `test_*_lines_that_are_refused`, `test_a_line_that_does_not_parse_is_an_error`, `test_pre_tool_use_is_dispatched`; grün die `…_go_through`-Zeilen und die übrigen Einstiegstests, denn der Stub erlaubt alles.

- [ ] **Step 3: Den echten Code einsetzen**

`scripts/teamgate_cmd.py` ganz ersetzen:

````python
"""PreToolUse command check of an agent-team run (spec section 6).

A parser, not a sandbox: it reads the command as Bash or PowerShell would
split it, unwraps the usual launchers and judges every simple command it
finds. What a script or the project's gate runs internally stays invisible.
"""

from __future__ import annotations

import base64
import itertools
import os
import re
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from teamgate_tasks import GateError, Run

BASH, PWSH = "bash", "powershell"


@dataclass
class Segment:
    words: list[str]
    piped: bool = False  # the previous segment's output flows into this one


@dataclass
class Parsed:
    segments: list[Segment] = field(default_factory=list)
    nested: list[tuple[str, str]] = field(default_factory=list)  # (dialect, command) from $(…) and `…`


_REDIRECT = re.compile(r"^[0-9]*(?:>>?|<|&>>?|>&)[0-9&-]*$")


def _closing(text: str, i: int) -> int:
    """Index of the ')' that closes the '(' at text[i]."""
    depth = 0
    quote = ""
    while i < len(text):
        c = text[i]
        if quote:
            if c == quote:
                quote = ""
        elif c in "'\"":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise GateError("unbalanced parenthesis")


def tokenize(text: str, dialect: str) -> Parsed:
    out = Parsed()
    words: list[str] = []
    word: list[str] = []
    in_word = False
    piped = False
    escape = "`" if dialect == PWSH else "\\"

    def end_word() -> None:
        nonlocal in_word
        if in_word:
            words.append("".join(word))
            word.clear()
            in_word = False

    def end_segment(next_piped: bool) -> None:
        nonlocal words, piped
        end_word()
        if words:
            out.segments.append(Segment(words, piped))
        words = []
        piped = next_piped

    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == escape and i + 1 < n:
            if text[i + 1] == "\n":
                i += 2
                continue
            word.append(text[i + 1])
            in_word = True
            i += 2
        elif c == "'":
            j = i + 1
            while True:
                j = text.find("'", j)
                if j < 0:
                    raise GateError("unterminated single quote")
                if dialect == PWSH and text[j + 1 : j + 2] == "'":
                    j += 2
                    continue
                break
            word.append(text[i + 1 : j].replace("''", "'") if dialect == PWSH else text[i + 1 : j])
            in_word = True
            i = j + 1
        elif c == '"':
            j = i + 1
            buf: list[str] = []
            while j < n and text[j] != '"':
                if text[j] == escape and j + 1 < n:
                    buf.append(text[j + 1])
                    j += 2
                    continue
                if text[j] == "$" and text[j + 1 : j + 2] == "(":
                    k = _closing(text, j + 1)
                    out.nested.append((dialect, text[j + 2 : k]))
                    buf.append(text[j : k + 1])
                    j = k + 1
                    continue
                if text[j] == "`" and dialect == BASH:
                    k = text.find("`", j + 1)
                    if k < 0:
                        raise GateError("unterminated backquote")
                    out.nested.append((dialect, text[j + 1 : k]))
                    j = k + 1
                    continue
                buf.append(text[j])
                j += 1
            if j >= n:
                raise GateError("unterminated double quote")
            word.append("".join(buf))
            in_word = True
            i = j + 1
        elif c == "$" and text[i + 1 : i + 2] == "(":
            k = _closing(text, i + 1)
            out.nested.append((dialect, text[i + 2 : k]))
            word.append(text[i : k + 1])
            in_word = True
            i = k + 1
        elif c == "`" and dialect == BASH:
            k = text.find("`", i + 1)
            if k < 0:
                raise GateError("unterminated backquote")
            out.nested.append((dialect, text[i + 1 : k]))
            i = k + 1
        elif c == "#" and not in_word:
            while i < n and text[i] != "\n":
                i += 1
        elif c in " \t\r":
            end_word()
            i += 1
        elif c in "\n;(){}":
            end_segment(False)
            i += 1
        elif c == "|":
            two = text[i : i + 2]
            end_segment(two != "||")
            i += 2 if two in ("||", "|&") else 1
        elif c == "&":
            two = text[i : i + 2]
            if two == "&&":
                end_segment(False)
                i += 2
            elif two == "&>":
                word.append(c)
                in_word = True
                i += 1
            elif dialect == PWSH and not in_word and not words:
                words.append("&")  # call operator
                i += 1
            elif in_word and word and word[-1] in "<>":
                word.append(c)
                i += 1
            else:
                end_segment(False)
                i += 1
        else:
            word.append(c)
            in_word = True
            i += 1
    end_segment(False)
    for seg in out.segments:
        seg.words = _drop_redirects(seg.words)
    out.segments = [s for s in out.segments if s.words]
    return out


def _drop_redirects(words: list[str]) -> list[str]:
    kept: list[str] = []
    skip = False
    for w in words:
        if skip:
            skip = False
            continue
        if _REDIRECT.match(w):
            skip = not w.endswith(("&1", "&2", "&-"))
            continue
        if re.match(r"^[0-9]*(?:>>?|<)\S", w):
            continue  # >file
        kept.append(w)
    return kept


def exe_name(word: str) -> str:
    base = re.split(r"[\\/]", word)[-1].lower()
    return re.sub(r"\.(exe|cmd|bat|com)$", "", base)


def _starts(word: str, full: str, minimum: int) -> bool:
    w = word.lower()
    return minimum <= len(w) <= len(full) and full.startswith(w)


# --- unwrapping launchers --------------------------------------------------


def unwrap(words: list[str], dialect: str) -> tuple[list[str], list[tuple[str, str]]]:
    """Strip launchers; return the inner command and commands to re-parse."""
    nested: list[tuple[str, str]] = []
    while words:
        first = words[0]
        exe = exe_name(first)
        if dialect == PWSH and first in ("&", "."):
            words = words[1:]
        elif dialect == BASH and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", first):
            words = words[1:]
        elif exe in ("env", "nohup", "exec", "command", "builtin", "time", "nice"):
            rest = words[1:]
            while rest and (rest[0].startswith("-") or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", rest[0])):
                rest = rest[2:] if rest[0] in ("-u", "--unset", "-C", "--chdir", "-n") else rest[1:]
            words = rest
        elif exe == "cmd":
            for idx, w in enumerate(words[1:], start=1):
                if w.lower() in ("/c", "/k", "/r"):
                    nested.append((BASH, " ".join(words[idx + 1 :])))
                    break
            return [], nested
        elif exe in ("bash", "sh", "zsh", "dash", "ksh"):
            for idx, w in enumerate(words[1:], start=1):
                if re.match(r"^-[A-Za-z]*c[A-Za-z]*$", w) and idx + 1 < len(words):
                    nested.append((BASH, words[idx + 1]))
                    return [], nested
            return words, nested
        elif exe in ("pwsh", "powershell"):
            for idx, w in enumerate(words[1:], start=1):
                lw = w.lower()
                if (lw == "-c" or _starts(lw, "-command", 3)) and idx + 1 < len(words):
                    nested.append((PWSH, " ".join(words[idx + 1 :])))
                    return [], nested
                if (lw in ("-e", "-ec") or _starts(lw, "-encodedcommand", 4)) and idx + 1 < len(words):
                    try:
                        decoded = base64.b64decode(words[idx + 1], validate=True).decode("utf-16-le")
                    except ValueError as exc:
                        raise GateError(f"cannot decode -EncodedCommand: {exc}") from None
                    nested.append((PWSH, decoded))
                    return [], nested
            return words, nested
        elif exe in ("invoke-expression", "iex"):
            args = [w for w in words[1:] if not _starts(w, "-command", 2)]
            nested.append((PWSH, " ".join(args)))
            return [], nested
        elif exe in ("start-process", "saps", "start"):
            file_path: str | None = None
            arg_list: list[str] = []
            rest = words[1:]
            k = 0
            while k < len(rest):
                lw = rest[k].lower()
                if _starts(lw, "-filepath", 2) and k + 1 < len(rest):
                    file_path = rest[k + 1]
                    k += 2
                elif (_starts(lw, "-argumentlist", 2) or lw == "-args") and k + 1 < len(rest):
                    arg_list = [a for part in rest[k + 1 :] for a in part.split(",") if a]
                    break
                elif lw.startswith("-"):
                    k += 2 if k + 1 < len(rest) and not rest[k + 1].startswith("-") else 1
                elif file_path is None:
                    file_path = rest[k]
                    k += 1
                else:
                    arg_list = [a for part in rest[k:] for a in part.split(",") if a]
                    break
            if file_path is None:
                return [], nested
            words = [file_path, *arg_list]
            nested.append((dialect, " ".join(_quote(w) for w in words)))
            return [], nested
        else:
            return words, nested
    return words, nested


def _quote(word: str) -> str:
    return "'" + word.replace("'", "''") + "'" if re.search(r"\s", word) else word


# --- paths -----------------------------------------------------------------

_VAR = re.compile(r"\$\{?(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}?|%([A-Za-z_][A-Za-z0-9_]*)%", re.IGNORECASE)


def resolve(word: str, cwd: Path, run: Run) -> Path | None:
    """The real path a command word names, or None when it cannot be known."""

    def var(m: re.Match[str]) -> str:
        name = m.group(1) or m.group(2)
        if name.upper() == "TEAM_RUN_DIR":
            return str(run.dir)
        if name.upper() in ("HOME", "USERPROFILE"):
            return str(Path.home())
        value = next((v for k, v in os.environ.items() if k.upper() == name.upper()), None)
        if value is None:
            raise KeyError(name)
        return value

    try:
        text = _VAR.sub(var, word)
    except KeyError:
        return None
    if "$" in text or "`" in text or "%" in text:
        return None
    if text == "~" or text.startswith(("~/", "~\\")):
        text = str(Path.home()) + text[1:]
    m = re.match(r"^/([a-zA-Z])(/.*)?$", text)
    if m:
        text = f"{m.group(1).upper()}:{m.group(2) or '/'}"
    glob = re.search(r"[*?\[]", text)
    if glob:
        cut = max(text.rfind("/", 0, glob.start()), text.rfind("\\", 0, glob.start()))
        text = text[: cut + 1] if cut >= 0 else "."
    path = Path(text)
    if not path.is_absolute():
        path = cwd / path
    return Path(os.path.realpath(path))


def within(child: Path, parent: Path) -> bool:
    c, p = os.path.normcase(str(child)), os.path.normcase(str(parent))
    try:
        return os.path.commonpath([c, p]) == p
    except ValueError:  # different drives
        return False


# --- the rules -------------------------------------------------------------


@dataclass
class Context:
    run: Run
    cwd: Path
    feature: str | None

    def worktrees(self, repo: Path) -> list[Path]:
        out = subprocess.run(
            ["git", "-C", str(repo), "worktree", "list", "--porcelain"],
            capture_output=True, text=True, encoding="utf-8", check=False,
        ).stdout
        return [Path(os.path.realpath(line[9:])) for line in out.splitlines() if line.startswith("worktree ")]


def _shorts(args: list[str], value: str = "", stuck: str = "", value_longs: frozenset[str] = frozenset()) -> str:
    """Letters of bundled short options as git reads them.

    A letter in `value` takes the rest of its word, or the next word, as its
    value (`-m msg`, `-mmsg`); a letter in `stuck` takes only the rest of its
    word (`-uno`). Values are skipped, so `-m -n` is a message, not -n.
    """
    letters = ""
    skip = False
    for a in args:
        if skip:
            skip = False
            continue
        if a == "--":
            break
        if a in value_longs:
            skip = True
        elif re.match(r"^-[A-Za-z]", a):
            for idx, ch in enumerate(a[1:], start=1):
                letters += ch
                if ch in value or ch in stuck:
                    skip = ch in value and idx == len(a) - 1
                    break
    return letters


def _longs(args: list[str], known: list[str]) -> set[str]:
    """Long options as git reads them: exact, or every option an abbreviation may mean."""
    found: set[str] = set()
    for a in args:
        if a == "--":
            break
        if a.startswith("--") and len(a) > 2:
            name = a.split("=", 1)[0]
            if name in known:
                found.add(name)
            else:
                found.update(k for k in known if k.startswith(name))
    return found


_GIT_GLOBAL_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--exec-path", "--super-prefix"}

_COMMIT_VALUE_LONGS = frozenset({
    "--message", "--file", "--author", "--date", "--reuse-message", "--reedit-message",
    "--fixup", "--squash", "--template", "--trailer", "--cleanup", "--pathspec-from-file",
})


def _positionals(args: list[str], value_shorts: str = "", value_longs: set[str] | None = None) -> list[str]:
    out: list[str] = []
    skip = False
    dashdash = False
    for a in args:
        if skip:
            skip = False
            continue
        if dashdash or not a.startswith("-") or a == "-":
            out.append(a)
        elif a == "--":
            dashdash = True
        elif value_longs and a in value_longs:
            skip = True
        elif re.match(r"^-[A-Za-z]+$", a) and a[-1] in value_shorts:
            skip = True
    return out


def check_git(args: list[str], ctx: Context, cwd: Path) -> str | None:
    i = 0
    while i < len(args) and args[i].startswith("-"):
        a = args[i]
        name, _, inline = a.partition("=")
        value = inline if inline else (args[i + 1] if name in _GIT_GLOBAL_WITH_VALUE and i + 1 < len(args) else "")
        if name in ("-c", "--config-env") and value.split("=", 1)[0].lower() == "core.hookspath":
            return "git -c core.hooksPath bypasses the hooks"
        if name == "-C" and value:
            target = resolve(value, cwd, ctx.run)
            if target is None:
                return f"cannot resolve git -C {value}"
            cwd = target
        i += 1 if inline or name not in _GIT_GLOBAL_WITH_VALUE else 2
    if i >= len(args):
        return None
    sub, rest = args[i].lower(), args[i + 1 :]

    if sub == "push":
        return "git push is the human's"
    if sub in ("commit-tree", "update-ref"):
        return f"git {sub} bypasses the commit gate"
    if sub == "config" and any(a.lower() == "core.hookspath" for a in rest) and not {"--get", "--get-all", "get", "-l", "--list"} & set(rest):
        return "git config core.hooksPath bypasses the hooks"
    if sub == "commit":
        if "n" in _shorts(rest, value="mFcCt", stuck="uS", value_longs=_COMMIT_VALUE_LONGS):
            return "git commit -n skips the commit gate"
        skip = False
        for a in rest:
            if skip:
                skip = False
                continue
            if a == "--":
                break
            skip = a in _COMMIT_VALUE_LONGS
            # Every abbreviation git could read as --no-verify (--no-v is ambiguous, still refused).
            if _starts(a.split("=", 1)[0], "--no-verify", 6):
                return "git commit --no-verify skips the commit gate"
        return None
    if sub == "branch":
        return _check_branch(rest, ctx)
    if sub == "reset":
        if any(_starts(a, "--hard", 3) for a in rest):
            return _check_reset(cwd, ctx)
        return None
    if sub == "worktree" and rest and rest[0] == "remove":
        opts = rest[1:]
        if "f" in _shorts(opts) or "--force" in _longs(opts, ["--force"]):
            return "git worktree remove --force can drop unsaved work"
        root = Path(os.path.realpath(ctx.run.dir / "worktrees"))
        for p in _positionals(opts):
            target = resolve(p, cwd, ctx.run)
            if target is None or not within(target, root) or target == root:
                return f"git worktree remove outside {root}: {p}"
        return None
    if sub == "clean":
        letters = _shorts(rest)
        forces = letters.count("f") + sum(1 for a in rest if _starts(a, "--force", 4))
        if set(letters) & {"x", "X", "d"} or forces >= 2:
            return "git clean -x/-X/-d/-ff deletes untracked state"
        return None
    return None


_BRANCH_LONGS = [
    "--delete", "--delete-merged", "--force", "--move", "--copy", "--dry-run", "--list",
    "--merged", "--no-merged", "--contains", "--no-contains", "--points-at", "--set-upstream-to",
    "--unset-upstream", "--track", "--no-track", "--create-reflog", "--edit-description",
    "--show-current", "--sort", "--format", "--color", "--no-color", "--column", "--no-column",
    "--verbose", "--quiet", "--abbrev", "--no-abbrev", "--all", "--remotes", "--ignore-case", "--omit-empty",
]


def _check_branch(args: list[str], ctx: Context) -> str | None:
    letters = _shorts(args, value="u")
    longs = _longs(args, _BRANCH_LONGS)
    delete = "d" in letters or "--delete" in longs
    force = "f" in letters or "--force" in longs
    if "D" in letters or (delete and force):
        return "git branch -D deletes unmerged work"
    prefix = f"team/{ctx.run.name}/"
    positional = _positionals(args, value_shorts="u", value_longs={"--sort", "--format", "--contains", "--no-contains", "--points-at", "--merged", "--no-merged", "--set-upstream-to"})
    if "--delete-merged" in longs:
        patterns = positional[1:]
        if not patterns or not all(p.startswith(prefix) for p in patterns):
            return f"git branch --delete-merged must name only {prefix}* branches"
    if delete and (not positional or not all(p.startswith(prefix) for p in positional)):
        return f"git branch -d may only delete {prefix}* branches"
    moving = "M" in letters or "C" in letters or ({"--move", "--copy"} & longs and force)
    if (force or moving) and not delete:
        target = positional[-1] if moving and positional else (positional[0] if positional else "")
        target = target.removeprefix("refs/heads/")
        if ctx.feature is None or target == ctx.feature:
            return "git branch --force must not move the feature branch"
    return None


def _check_reset(tree: Path, ctx: Context) -> str | None:
    ref = subprocess.run(
        ["git", "-C", str(tree), "symbolic-ref", "-q", "HEAD"],
        capture_output=True, text=True, encoding="utf-8", check=False,
    )
    if ctx.feature is None:
        return "git reset --hard needs a known feature branch (run.json unreadable)"
    if ref.returncode == 0 and ref.stdout.strip() == f"refs/heads/{ctx.feature}":
        return "git reset --hard on the feature branch"
    return None


def check_gh(args: list[str]) -> str | None:
    lowered = [a.lower() for a in args]
    if lowered[:2] == ["pr", "merge"]:
        return "gh pr merge is the human's"
    if lowered[:1] == ["api"] and any("/merge" in a for a in lowered[1:]):
        return "gh api …/merge is the human's"
    return None


_REMOVE_PS = {"remove-item", "ri", "del", "erase", "rd", "rmdir", "rm"}
_LIST_PS = {"get-childitem", "gci", "ls", "dir"}


def _ps_recurse(args: list[str]) -> bool:
    return any(_starts(a.split(":", 1)[0], "-recurse", 2) for a in args)


def _ps_targets(args: list[str]) -> list[str]:
    out: list[str] = []
    k = 0
    while k < len(args):
        lw = args[k].lower()
        if (_starts(lw, "-path", 2) or _starts(lw, "-literalpath", 2) or lw == "-lp") and k + 1 < len(args):
            out += [p for p in args[k + 1].split(",") if p]
            k += 2
        elif lw.startswith("-"):
            k += 1
        else:
            out += [p for p in args[k].split(",") if p]
            k += 1
    return out


def recursive_delete_targets(exe: str, args: list[str], dialect: str) -> list[str] | None:
    """Paths a recursive delete would remove; None if the command deletes nothing recursively."""
    if exe in ("rd", "rmdir") and any(re.match(r"^/[sq](/[sq])?$", a, re.IGNORECASE) and "s" in a.lower() for a in args):
        return [a for a in args if not a.startswith("/")] or ["."]
    if exe == "rm" and dialect == BASH:
        if re.search(r"[rR]", _shorts(args)) or any(_starts(a, "--recursive", 3) for a in args):
            return _positionals(args) or ["."]
        return None
    if exe in _REMOVE_PS and dialect == PWSH and _ps_recurse(args):
        return _ps_targets(args) or ["."]
    if exe == "find" and "-delete" in args:
        starts = list(itertools.takewhile(lambda a: not a.startswith(("-", "(", "!")), args))
        return starts or ["."]
    return None


_DIRECTORY_DELETE = re.compile(
    r"\[(?:System\.)?IO\.Directory\]::Delete\(\s*(?P<path>'[^']*'|\"[^\"]*\"|[^,)]+?)\s*,\s*\$true\s*\)",
    re.IGNORECASE,
)


def check_delete(targets: list[str], ctx: Context, cwd: Path) -> str | None:
    run_dir = Path(os.path.realpath(ctx.run.dir))
    worktrees = [w for w in ctx.worktrees(ctx.run.repo) if within(w, run_dir / "worktrees")]
    for t in targets:
        path = resolve(t, cwd, ctx.run)
        if path is None:
            return f"recursive delete of a path that cannot be resolved: {t}"
        if not within(path, run_dir):
            return f"recursive delete outside the run folder: {t}"
        for w in worktrees:
            if within(w, path) or within(path, w):
                return f"recursive delete of a worktree git still lists: {w}"
    return None


def check_command(command: str, dialect: str, ctx: Context, depth: int = 0) -> str | None:
    if depth > 8:
        return "command nests launchers too deeply to check"
    for m in _DIRECTORY_DELETE.finditer(command):
        reason = check_delete([m.group("path").strip("'\"")], ctx, ctx.cwd)
        if reason:
            return reason
    parsed = tokenize(command, dialect)
    for sub_dialect, sub in parsed.nested:
        reason = check_command(sub, sub_dialect, ctx, depth + 1)
        if reason:
            return reason
    cwd = ctx.cwd
    previous: tuple[str, list[str], Path] | None = None
    for seg in parsed.segments:
        words, nested = unwrap(seg.words, dialect)
        for sub_dialect, sub in nested:
            reason = check_command(sub, sub_dialect, Context(ctx.run, cwd, ctx.feature), depth + 1)
            if reason:
                return reason
        if not words:
            previous = None
            continue
        exe, args = exe_name(words[0]), words[1:]
        if exe in ("cd", "set-location", "sl", "chdir", "pushd", "push-location"):
            target = resolve(_positionals(args)[0], cwd, ctx.run) if _positionals(args) else Path.home()
            if target is None:
                return f"cannot follow cd {args}"
            cwd = target
        reason = None
        if exe == "git":
            reason = check_git(args, ctx, cwd)
        elif exe == "gh":
            reason = check_gh(args)
        else:
            targets = recursive_delete_targets(exe, args, dialect)
            target_cwd = cwd
            if targets is None and seg.piped and previous and dialect == PWSH and exe in _REMOVE_PS:
                # Get-ChildItem -Recurse <dir> | Remove-Item deletes the tree of <dir>.
                p_exe, p_args, p_cwd = previous
                if p_exe in _LIST_PS and _ps_recurse(p_args):
                    targets, target_cwd = _ps_targets(p_args) or ["."], p_cwd
            if targets is not None:
                reason = check_delete(targets, ctx, target_cwd)
        if reason:
            return reason
        previous = (exe, args, cwd)
    return None


def on_pre_tool_use(run: Run, payload: Mapping[str, object]) -> list[str]:
    tool = payload.get("tool_name")
    tool_input = payload.get("tool_input")
    if tool not in ("Bash", "PowerShell") or not isinstance(tool_input, dict):
        return []
    command = tool_input.get("command")
    if not isinstance(command, str):
        return []
    cwd_value = payload.get("cwd")
    cwd = Path(cwd_value) if isinstance(cwd_value, str) and cwd_value else run.repo
    try:
        feature: str | None = run.feature
    except (OSError, ValueError, GateError):
        feature = None  # run folder gone or broken: rules that need the branch fail closed
    reason = check_command(command, BASH if tool == "Bash" else PWSH, Context(run, cwd, feature))
    return [reason] if reason else []
````

- [ ] **Step 4: GREEN, Coverage, Typen**

Run: `uv run --no-project --python 3.13 --with pytest --with pytest-cov --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate -q -p no:cacheprovider -n 8 --cov=scripts --cov-branch --cov-report=term-missing --cov-fail-under=100`
Expected: PASS, 100 %.

Run: `MYPYPATH="scripts;scripts/tests/teamgate" uvx --python 3.13 --with pytest --with types-PyYAML mypy --strict --explicit-package-bases scripts/team-gate.py scripts/teamgate_tasks.py scripts/teamgate_cmd.py scripts/tests/teamgate`
Expected: `Success: no issues found`

- [ ] **Step 5: Mutationsrunde**

`<scratch>/mutants-task3.json`:

````json
[
  {"file": "scripts/teamgate_cmd.py", "old": "\"n\" in _shorts(rest, value=\"mFcCt\", stuck=\"uS\", value_longs=_COMMIT_VALUE_LONGS)", "new": "\"n\" in _shorts(rest)"},
  {"file": "scripts/teamgate_cmd.py", "old": "if _starts(a.split(\"=\", 1)[0], \"--no-verify\", 6):", "new": "if a == \"--no-verify\":"},
  {"file": "scripts/teamgate_cmd.py", "old": "if (force or moving) and not delete:", "new": "if force and not delete:"},
  {"file": "scripts/teamgate_cmd.py", "old": "if within(w, path) or within(path, w):", "new": "if within(path, w):"},
  {"file": "scripts/teamgate_cmd.py", "old": "if not within(path, run_dir):", "new": "if False:"},
  {"file": "scripts/teamgate_cmd.py", "old": "end_segment(two != \"||\")", "new": "end_segment(False)"},
  {"file": "scripts/teamgate_cmd.py", "old": "or forces >= 2:", "new": "or forces >= 3:"},
  {"file": "scripts/teamgate_cmd.py", "old": "return any(_starts(a.split(\":\", 1)[0], \"-recurse\", 2) for a in args)", "new": "return any(_starts(a, \"-recurse\", 2) for a in args)"},
  {"file": "scripts/teamgate_cmd.py", "old": "if ref.returncode == 0 and ref.stdout.strip() == f\"refs/heads/{ctx.feature}\":", "new": "if ref.returncode == 0 and ref.stdout.strip() == \"refs/heads/main\":"},
  {"file": "scripts/teamgate_cmd.py", "old": "if not patterns or not all(p.startswith(prefix) for p in patterns):", "new": "if not all(p.startswith(prefix) for p in patterns):"},
  {"file": "scripts/teamgate_cmd.py", "old": "if name in (\"-c\", \"--config-env\") and value.split(\"=\", 1)[0].lower() == \"core.hookspath\":", "new": "if name == \"-c\" and value.split(\"=\", 1)[0] == \"core.hooksPath\":"},
  {"file": "scripts/teamgate_cmd.py", "old": "if delete and (not positional or not all(p.startswith(prefix) for p in positional)):", "new": "if delete and positional and not all(p.startswith(prefix) for p in positional):"},
  {"file": "scripts/teamgate_cmd.py", "old": "if target is None or not within(target, root) or target == root:", "new": "if target is None or not within(target, root):"},
  {"file": "scripts/teamgate_cmd.py", "old": "if set(letters) & {\"x\", \"X\", \"d\"} or forces >= 2:", "new": "if set(letters) & {\"x\", \"X\"} or forces >= 2:"},
  {"file": "scripts/teamgate_cmd.py", "old": "if exe == \"rm\" and dialect == BASH:", "new": "if exe == \"rm\" and dialect == PWSH:"},
  {"file": "scripts/teamgate_cmd.py", "old": "if lowered[:1] == [\"api\"] and any(\"/merge\" in a for a in lowered[1:]):", "new": "if False:"},
  {"file": "scripts/teamgate_cmd.py", "old": "skip = ch in value and idx == len(a) - 1", "new": "skip = False"},
  {"file": "scripts/teamgate_cmd.py", "old": "if dialect == PWSH and first in (\"&\", \".\"):", "new": "if dialect == PWSH and first == \"&\":"},
  {"file": "scripts/teamgate_cmd.py", "old": "if name.upper() == \"TEAM_RUN_DIR\":", "new": "if False:"},
  {"file": "scripts/teamgate_cmd.py", "old": "if exe in (\"cd\", \"set-location\", \"sl\", \"chdir\", \"pushd\", \"push-location\"):", "new": "if False:"},
  {"file": "scripts/teamgate_cmd.py", "old": "if p_exe in _LIST_PS and _ps_recurse(p_args):", "new": "if p_exe in _LIST_PS:"},
  {"file": "scripts/teamgate_cmd.py", "old": "    if depth > 8:", "new": "    if depth > 80:"}
]
````

Run: `python -B <scratch>/mutants.py <scratch>/mutants-task3.json -n 8 scripts/tests/teamgate/test_cmd.py scripts/tests/teamgate/test_entry.py > <scratch>/t3-mutants.txt 2>&1`
Expected: `22 mutants, 0 survived, 0 bad`.

Run: `python -B <scratch>/check_clean.py <scratch>/mutants-task3.json`
Expected: `clean` (auch nach jedem Abbruch der Runde, siehe Task 2 Step 8).

- [ ] **Step 6: Commit**

```bash
git add scripts/team-gate.py scripts/teamgate_cmd.py scripts/tests/teamgate/test_cmd.py scripts/tests/teamgate/test_entry.py
git commit -m "Refuse publishing, gate bypasses and forced deletes during a team run"
```

### Task 4: Rollen und Urteilsregeln

**Files:**
- Create: `agents/planner.md`, `agents/orchestrator.md`, `agents/explorer.md`, `agents/researcher.md`, `agents/implementer-infra.md`, `agents/implementer-backend.md`, `agents/implementer-frontend.md`, `agents/implementer-ux.md`, `agents/code-reviewer.md`, `agents/security-reviewer.md`, `agents/bug-hunter.md`, `agents/verifier.md`, `agents/cleaner.md`
- Create: `docs/agent-team/verdicts.md`
- Test: `scripts/tests/teamgate/test_agents.py`

**Interfaces:**
- Consumes: Titelformen und Urteilsregeln aus Task 2 (die Rümpfe beschreiben, was die Hooks prüfen); `team-gate.py supersede <gen>:<task_id>` aus Task 2; das Protokoll aus Task 1 (Rückfälle 1, 6, 12).
- Produces: die Definitionen, die Task 5 (`--agent orchestrator`, `--agent cleaner`) und Task 6 starten. Der Orchestrator erwartet im Startprompt: Plan, `Run folder: <pfad>`, `Generation: <n>`, `Feature branch: <zweig>`, `Verdict rules: <pfad>` — genau das baut Task 5.

- [ ] **Step 1: Test schreiben**

`scripts/tests/teamgate/test_agents.py` legt die Tabelle aus Spec Abschnitt 3 fest:

````python
"""The thirteen role definitions under agents/ match the table of spec section 3."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml
from conftest import SCRIPTS

REPO = SCRIPTS.parent
AGENTS = REPO / "agents"
CLAUDE_HOME = Path.home() / ".claude"

IMPL_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "Skill"]
IMPL_SKILLS = {"superpowers:test-driven-development", "superpowers:verification-before-completion"}
JUDGE_TOOLS = ["Read", "Grep", "Glob", "Bash", "Write", "Skill"]

# name: (model, effort, tools, skills the body must invoke)
TABLE: dict[str, tuple[str, str, list[str], set[str]]] = {
    "planner": ("opus", "high", ["Read", "Grep", "Glob", "Bash", "Write", "Edit", "Agent", "Skill", "AskUserQuestion"],
                {"superpowers:brainstorming", "superpowers:writing-plans"}),
    "orchestrator": ("opus", "medium", ["Read", "Grep", "Glob", "Bash", "Write", "Edit", "Agent", "SendMessage", "TaskCreate",
                                        "TaskGet", "TaskList", "TaskUpdate", "Skill", "AskUserQuestion"], set()),
    "explorer": ("haiku", "high", ["Read", "Grep", "Glob"], set()),
    "researcher": ("sonnet", "high", ["Read", "Grep", "Glob", "WebSearch", "WebFetch"], set()),
    "implementer-infra": ("sonnet", "xhigh", IMPL_TOOLS, IMPL_SKILLS),
    "implementer-backend": ("sonnet", "xhigh", IMPL_TOOLS, IMPL_SKILLS),
    "implementer-frontend": ("sonnet", "xhigh", IMPL_TOOLS, IMPL_SKILLS),
    "implementer-ux": ("sonnet", "xhigh", IMPL_TOOLS, IMPL_SKILLS),
    "code-reviewer": ("opus", "medium", JUDGE_TOOLS, {"superpowers:receiving-code-review"}),
    "security-reviewer": ("opus", "high", JUDGE_TOOLS, {"vulnhunt", "security-review"}),
    "bug-hunter": ("opus", "high", JUDGE_TOOLS, {"vulnhunt"}),
    "verifier": ("opus", "high", ["Read", "Grep", "Glob", "Bash", "Write"], set()),
    "cleaner": ("haiku", "high", ["Read", "Glob", "Bash"], set()),
}

KNOWN_TOOLS = {
    "Read", "Grep", "Glob", "Bash", "PowerShell", "Write", "Edit", "Agent", "Skill", "AskUserQuestion",
    "SendMessage", "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "WebSearch", "WebFetch",
}
BUILT_IN_SKILLS = {"security-review"}
# A body names its skills as "invoke `name`"; teammates ignore the skills field.
SKILL_CALL = re.compile(r"[Ii]nvoke\s+`([a-z0-9:-]+)`")
WRITES_VERDICTS = {"code-reviewer", "security-reviewer", "bug-hunter", "verifier", "orchestrator"}


def split(path: Path) -> tuple[dict[str, object], str]:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    assert m, f"{path.name} has no frontmatter"
    meta = yaml.safe_load(m.group(1))
    assert isinstance(meta, dict)
    return meta, m.group(2)


def skill_exists(name: str) -> bool:
    if name in BUILT_IN_SKILLS:
        return True
    if ":" in name:
        plugin, skill = name.split(":", 1)
        return any(CLAUDE_HOME.glob(f"plugins/cache/*/{plugin}/*/skills/{skill}/SKILL.md"))
    return (CLAUDE_HOME / "skills" / name / "SKILL.md").is_file()


def test_there_are_exactly_the_thirteen_roles() -> None:
    assert sorted(p.stem for p in AGENTS.glob("*.md")) == sorted(TABLE)


@pytest.mark.parametrize("name", sorted(TABLE))
def test_a_definition_matches_its_table_row(name: str) -> None:
    meta, body = split(AGENTS / f"{name}.md")
    model, effort, tools, skills = TABLE[name]
    assert meta["name"] == name
    assert isinstance(meta.get("description"), str) and meta["description"]
    assert (meta["model"], meta["effort"]) == (model, effort)
    listed = [t.strip() for t in str(meta["tools"]).split(",")]
    assert set(listed) <= KNOWN_TOOLS
    assert listed == tools
    assert set(SKILL_CALL.findall(body)) == skills


@pytest.mark.parametrize("name", sorted(TABLE))
def test_every_skill_a_body_invokes_exists(name: str) -> None:
    _, body = split(AGENTS / f"{name}.md")
    for skill in SKILL_CALL.findall(body):
        assert skill_exists(skill), f"{name} invokes {skill}, which is not installed"


@pytest.mark.parametrize("name", sorted(WRITES_VERDICTS))
def test_roles_that_handle_verdicts_point_at_the_reference(name: str) -> None:
    _, body = split(AGENTS / f"{name}.md")
    assert "verdicts.md" in body  # the lead passes its path on; the starter names it
    assert (REPO / "docs" / "agent-team" / "verdicts.md").is_file()


def test_no_body_names_a_skill_by_its_versioned_path() -> None:
    for path in AGENTS.glob("*.md"):
        assert "plugins/cache" not in path.read_text(encoding="utf-8"), path.name
````

- [ ] **Step 2: RED zeigen**

Run: `uv run --no-project --python 3.13 --with pytest --with pyyaml pytest scripts/tests/teamgate/test_agents.py -q -p no:cacheprovider`
Expected: FAIL — `test_there_are_exactly_the_thirteen_roles` an der Assertion (kein `agents/`), die parametrisierten Tests an `FileNotFoundError` beim Lesen; grün nur `test_no_body_names_a_skill_by_its_versioned_path` (leerer Ordner). Hier ist das Fehlen der Datei das alte Verhalten; ein Stub ergäbe keinen schärferen Nachweis, die Gegenproben in Step 7 zeigen die Assertions rot.

- [ ] **Step 3: Urteilsregeln schreiben**

`docs/agent-team/verdicts.md`:

````markdown
# Agent-team verdicts and evidence

Reference for every role that ends a task with a verdict file. The hooks of
the run check these rules; a verdict that breaks one keeps the task open and
the refusal tells you which rule.

## Where

- Verdict: `$TEAM_RUN_DIR/verdicts/g<gen>-<task_id>.json`. `<gen>` is the
  generation the lead named in your spawn prompt, `<task_id>` the id of your
  task.
- Evidence: any file under `$TEAM_RUN_DIR/evidence/`, non-empty. Name it
  `g<gen>-<task_id>-<finding id>.txt`.
- Gate log (verifier, `verify:impl`, `verify:fix`, `verify:rebase` only):
  `$TEAM_RUN_DIR/evidence/gate-<root>-<head>.txt`. Line 1 the full HEAD hash,
  line 2 the exit code of the gate command, then its output.

## Shape

```json
{
  "task_id": "task-017",
  "subject": "[verify:review] T3",
  "role": "verifier",
  "head": "<full 40-character hash of the commit you judged>",
  "judges": ["task-015", "task-016"],
  "verdict": "fail",
  "findings": [
    {
      "id": "T3-sec-F1",
      "kind": "defect",
      "severity": "high",
      "claim": "Empty password is accepted",
      "location": "internal/auth/login.go:42",
      "status": "confirmed",
      "evidence": {
        "command": "go test ./internal/auth -run TestEmptyPassword",
        "output_file": "evidence/g1-task-017-T3-sec-F1.txt"
      }
    }
  ]
}
```

## Rules

- `task_id` and `subject` are exactly those of your task; `role` is your role
  name; `head` is the full hash of the commit you judged.
- `kind` is `defect` (something wrong in the code) or `claim` (a statement,
  such as "RED was red" or "the gate is green"). `severity` is `low`,
  `medium`, `high` or `critical`.
- **Reviews** (`review:code`, `review:security`) and **hunts** carry no
  `verdict`. Every finding has `status: "open"`. A hunt finding also carries
  `"patch": "evidence/R<r>-P<n>-F<k>.patch"`, the red repro test.
- **Verify** verdicts carry `verdict`: `fail` exactly when a `defect` is
  `confirmed` or a `claim` is `refuted`, otherwise `pass`. Every finding is
  `confirmed` or `refuted`, each with `evidence` (`command` plus an
  `output_file` that exists under the run folder and is not empty). No probe,
  no `confirmed`.
- `verify:review` names in `judges` the two review tasks it judged: the latest
  completed `review:code` and `review:security` of the root, both with the
  same `head` as the verify verdict.
- `verify:rebase` adds `rebased_from` (the HEAD before the rebase) and
  `evidence` with the `git range-diff` output. When the own commits are
  unchanged and the gate is green it passes and adds `inherits`: the task ids
  of the trio that was green before (review:code, review:security,
  verify:review). When the commits changed, it refutes the claim "own commits
  unchanged" and fails; then the reviews run again.
- `verify:hunt` may add `"duplicate_of": "B<n>"` to a finding that repeats a
  known bug.
- A red gate log never goes with `pass`. With `fail` it is right when a claim
  "gate is green" is `refuted` and carries the gate log as its `output_file`.
- Finding ids name target and role: `T3-code-F1`, `T3-sec-F1`, `T3-ver-F1`,
  `R1-P2-F4`. Bug numbers `B<n>` are the lead's to give.
````

- [ ] **Step 4: Definitionen schreiben**

`agents/orchestrator.md`:

````markdown
---
name: orchestrator
description: Lead of an agent-team run. Started by claude-team.ps1 as the main session; turns a committed plan into a PR-ready feature branch through implementers, verifiers, reviewers and bug hunters. Never use it as a subagent.
tools: Read, Grep, Glob, Bash, Write, Edit, Agent, SendMessage, TaskCreate, TaskGet, TaskList, TaskUpdate, Skill, AskUserQuestion
model: opus
effort: medium
---

You are the orchestrator, the lead of an agent-team run. You turn a committed
implementation plan into a feature branch that is ready for a pull request.
You write no product code. The human approved spec and plan; from here you run
autonomously until the cleanup, except where this prompt says to ask.

Your start prompt names the plan, the run folder (`TEAM_RUN_DIR`), the
generation and the feature branch. The repository's main tree has the feature
branch checked out. Read `$TEAM_RUN_DIR/run.json` first. The commands below
are Bash; in PowerShell the run folder is `$env:TEAM_RUN_DIR`.

## Vocabulary

- **Root**: a unit of work with its own worktree and chain. `T<n>` for plan
  task n, `B<n>` for a confirmed bug, `F` for rework after a refuted final.
- **Worktree** of root W: `$TEAM_RUN_DIR/worktrees/W` on branch
  `team/<run>/W`, created with
  `git worktree add --track -b team/<run>/W "$TEAM_RUN_DIR/worktrees/W" <feature>`.
  `<run>` is the last segment of the run folder.
- **Task titles** (the hooks refuse every other form):
  `[impl:<domain>] W <title>`, `[fix:<domain>] W <title>`,
  `[fix:<domain>:conflict] W <title>`, `[review:code] W`,
  `[review:security] W`, `[verify:impl|fix|review|rebase] W`,
  `[verify:hunt] B<n>`, `[verify:final] F`, `[merge] W`,
  `[hunt] R<r>.P<n> <partition>`, `[final]`, `[cleanup]`. `<domain>` is
  `infra`, `backend`, `frontend` or `ux`.
- **Verdicts and evidence**: your start prompt names the verdict rules
  (`verdicts.md`). Read them once at the start; you need them to read verdicts
  and to judge what the hooks will refuse. Pass that path on in every spawn
  prompt of a reviewer, verifier or bug hunter.
- **Green**: the latest `verify:review` of W passes, names both reviews of
  this round, and all three carry the HEAD of `team/<run>/W` — or the latest
  passing `verify:rebase` carries that HEAD and inherits such a trio.

## Spawning teammates

- Spawn with the Agent tool, `subagent_type` set to the role and a `name`
  (`impl-T3`, `verify-T3-2`, …). Never pass `model` and never pass
  `isolation`: both override the role definition.
- Every spawn prompt names: the run folder, the generation, the task id and
  exact title, the worktree path (if any), the feature branch, and the plan
  task text copied verbatim for implementers. Reviewers and verifiers get the
  root and what to judge.
- At most five teammates at a time. A finished teammate you need again for
  the same root may be resumed with SendMessage instead of a new spawn.
- Assign each task to its teammate (`TaskUpdate`, owner). A teammate marks its
  task completed itself; the hook refuses completion until its evidence is in
  place.

## The run

1. **Resume?** If the generation is above 1, read `status.md`, `tasks.jsonl`,
   the verdicts and `git branch --list "team/<run>/*"`. Close every task of an
   older generation that is still open with
   `uv run --script "$HOME/.claude/scripts/team-gate.py" --run "$TEAM_RUN_DIR" supersede <gen>:<task_id> …`
   (`<gen>` is the old generation; `$HOME` works in Bash and PowerShell)
   and create it again in this generation. Then continue below where the
   register left off.
2. **Split.** Read the plan. Each `### Task N` is root `TN` with its
   `**Domain:**` and `**Files:**`. Task B depends on task A when the plan says
   so or when their Files lists share a path; B starts only after `[merge] A`.
   For each task that is ready: create its worktree first, then
   `[impl:<domain>] TN <task title>` and `[merge] TN` (blocked by the impl).
3. **Chain of a root W**, in this order, each step a task and a teammate:
   - `[impl]` or `[fix]` → `implementer-<domain>`.
   - `[verify:impl]` or `[verify:fix]` → `verifier`. Fail → new
     `[fix:<domain>] W` with the confirmed findings in its description.
   - Pass → `[review:code] W` → `code-reviewer` and `[review:security] W` →
     `security-reviewer`, in parallel.
   - Both done → `[verify:review] W` → `verifier`, naming both review task ids.
     A confirmed finding → `[fix:<domain>] W`; none → the root is green.
   - Point `[merge] W`'s blockedBy at the newest `[verify:review] W` each round.
   - A round is every `[impl]` and every `[fix]` without `:conflict`. Before a
     fourth round of the same root, ask the human with AskUserQuestion.
4. **Merge W** (only you, only when W is green for the HEAD of its branch):
   - If the feature branch is an ancestor of that HEAD:
     `git merge --ff-only team/<run>/W` in the main tree. Done.
   - Otherwise `git -C <worktree> rebase <feature>`.
     Conflict → `git -C <worktree> rebase --abort`, then
     `[fix:<domain>:conflict] W` and the chain from verify:fix on.
     No conflict → `[verify:rebase] W`; if it passes with `inherits`, go back
     to the merge check; if it fails, run both reviews and verify:review again.
     Any other rebase error → ask the human.
   - Then complete `[merge] W`. A dependent task's worktree is created only now.
5. **Hunt**, once every `[merge] T<n>` is complete. Round r: split the feature
   branch into at most five partitions (by component or directory); for each,
   `git worktree add --detach "$TEAM_RUN_DIR/worktrees/R<r>.P<n>" <feature>` and
   `[hunt] R<r>.P<n> <partition>` → `bug-hunter`. For every finding in the
   hunt verdicts give the next free bug number `B<n>` and create
   `[verify:hunt] B<n>` → `verifier`, naming the finding and its patch.
   Confirmed and not `duplicate_of` → worktree of `B<n>`,
   `[fix:<domain>] B<n> <claim>` with the patch path, `[merge] B<n>`, and the
   chain. Stop hunting after two rounds in a row without a new confirmed
   finding, or after five rounds — then ask the human whether to go on.
6. **Final.** Run the command in `.claude/team-gate` on the feature branch in
   the main tree; it must exit 0. Tick the plan checkboxes, write the report to
   `docs/.superpowers/reports/<date>-<plan name>.md` (roots, rounds, verdicts,
   findings, bugs, costs if known, anything left open), commit both, create
   and complete `[final]`. Then `[verify:final] F` → `verifier`. If it fails:
   worktree of `F`, `[fix:<domain>] F`, `[merge] F`, the chain; after
   `[merge] F` rewrite and commit the report and create a new
   `[verify:final] F`.
7. **Cleanup**, once the latest `[verify:final] F` passes. Run
   `git branch --no-merged <feature> --list "team/<run>/*"` and put its output
   into the description of `[cleanup]` (expected empty; anything listed goes
   into the report). Spawn `cleaner`. When it reports done, tell the human the
   feature branch is ready for push and pull request.

## Failures

- A teammate dies (API error, limit): read `git log` and `git status` of its
  worktree and its verdict, then continue it with SendMessage; spawn anew
  only if that fails.
- A task hangs: nudge its teammate; the hooks keep tasks open that lack a
  commit or a verdict.
- A teammate asks a question: it set its task to pending with a description
  starting `WAITING:`; answer with SendMessage, remove the `WAITING:` line
  from the description and assign the task again.
- A worktree cannot be removed: ask the human; only the human removes a
  worktree with unsaved work.

## Never

- Never push, never merge a pull request, never `--no-verify`.
- Never write in the main tree except `git merge --ff-only` and the final
  commit of plan checkboxes and report.
- Never write to `tasks.jsonl` by hand; only through `team-gate.py supersede`.
- Never delete a task. A task you no longer need you close with `supersede`.
- Never end processes by name, only by PID. Never start an interpreter that
  reads code from stdin (`python -`).
- Never pass `model` or `isolation` when spawning.
````

`agents/planner.md`:

````markdown
---
name: planner
description: Main session for phase 1 of an agent-team run (`claude --agent planner`). Brainstorms with the human, writes spec and plan, has both verified, then commits them on a new feature branch. Never use it as a subagent.
tools: Read, Grep, Glob, Bash, Write, Edit, Agent, Skill, AskUserQuestion
model: opus
effort: high
---

You are the planner. Together with the human you turn a request into an
approved spec and an approved implementation plan, committed on a feature
branch. The orchestrator builds from that plan later; you write no product
code.

## Helpers

Call `explorer` (code, with file:line), `researcher` (docs and web, with URLs)
and `verifier` through the Agent tool **without a `name`**. Without a name
they stay ordinary subagents and return their result to you; with a name they
would become teammates. Use them whenever a question about the code or the
outside world comes up, already during brainstorming.

## Steps

1. Invoke `superpowers:brainstorming` and follow it with the human.
2. Write the spec to `docs/.superpowers/specs/<date>-<topic>-design.md`.
3. Have `verifier` try to refute the spec: every claim about code, tools and
   behaviour. Rework what it refutes and ask it again.
4. Ask the human to approve the spec (AskUserQuestion). No plan before that.
5. Invoke `superpowers:writing-plans`. Save the plan to
   `docs/.superpowers/plans/<date>-<topic>.md`. Every task carries, next to
   the fields of writing-plans, a line `**Domain:** infra|backend|frontend|ux`
   and its `**Files:**` list. Dependencies between tasks are stated in the
   task ("Depends on Task 2").
6. Have `verifier` try to refute the plan: code snippets against the code,
   expected test outcomes by hand, task order against the interfaces. Rework
   and ask again, then ask the human to approve the plan.
7. Create the feature branch (`git switch -c feat/<topic>` from the current
   main branch), commit spec and plan on it, and tell the human the start
   command: `pwsh -File "$HOME/.claude/scripts/claude-team.ps1" <plan path>`.

## Never

- Never push. Never commit on the main branch.
- Never end processes by name, only by PID. Never start an interpreter that
  reads code from stdin (`python -`).
````

`agents/implementer-backend.md`:

````markdown
---
name: implementer-backend
description: Agent-team teammate that implements one backend task (services, APIs, data, domain logic) of a plan with TDD in its own worktree. Spawned by the orchestrator only.
tools: Read, Grep, Glob, Edit, Write, Bash, Skill
model: sonnet
effort: xhigh
---

You implement exactly one task of an agent-team run: a plan task (`[impl]`)
or a fix (`[fix]`). The spawn prompt names the run folder, the generation,
your task, your worktree and the feature branch.

Your domain: backend — services, APIs, persistence, domain logic.

## How

1. Work only in your worktree. The main tree is read-only for you.
2. Before writing code, invoke `superpowers:test-driven-development` and
   follow it. Every new test runs red against the state before your change;
   keep the command and its failing output.
3. For a bug fix `[fix] B<n>`: first apply the hunter's patch named in the
   task (`git apply <run folder>/evidence/<patch>`), run it and see it red.
   That is your RED.
4. For a conflict fix `[fix:…:conflict]`: rebase your worktree onto the
   feature branch and resolve the conflicts so that both sides keep their
   meaning; run the tests.
5. Run the project's gate (the command in `.claude/team-gate`) in your
   worktree until it is green. Before you report, invoke
   `superpowers:verification-before-completion`.
6. Commit in your worktree; nothing uncommitted may remain
   (`git status --porcelain` is empty).
7. Mark your task completed (TaskUpdate). If the hook refuses, its message
   says why; fix that and try again.
8. Send the lead (SendMessage) a short report: commits, the RED command with
   its failing assertion, the gate result, anything you could not do.

## Teammate rules

- Need an answer? Set your task to pending with a description that starts
  with `WAITING:` and holds your question, send the question to the lead,
  and end your turn.
- In PowerShell the run folder is `$env:TEAM_RUN_DIR`, in Bash
  `$TEAM_RUN_DIR`.
- Never push, never `--no-verify`, never `git stash` (the stash is shared).
- Never end processes by name, only by PID you started. Never start an
  interpreter that reads code from stdin (`python -`).
- Leave no background process running when you end your turn.
````

`agents/implementer-infra.md`:

````markdown
---
name: implementer-infra
description: Agent-team teammate that implements one infrastructure task (build, CI, scripts, packaging, configuration) of a plan with TDD in its own worktree. Spawned by the orchestrator only.
tools: Read, Grep, Glob, Edit, Write, Bash, Skill
model: sonnet
effort: xhigh
---

You implement exactly one task of an agent-team run: a plan task (`[impl]`)
or a fix (`[fix]`). The spawn prompt names the run folder, the generation,
your task, your worktree and the feature branch.

Your domain: infrastructure — build, CI, scripts, packaging, configuration.

## How

1. Work only in your worktree. The main tree is read-only for you.
2. Before writing code, invoke `superpowers:test-driven-development` and
   follow it. Every new test runs red against the state before your change;
   keep the command and its failing output.
3. For a bug fix `[fix] B<n>`: first apply the hunter's patch named in the
   task (`git apply <run folder>/evidence/<patch>`), run it and see it red.
   That is your RED.
4. For a conflict fix `[fix:…:conflict]`: rebase your worktree onto the
   feature branch and resolve the conflicts so that both sides keep their
   meaning; run the tests.
5. Run the project's gate (the command in `.claude/team-gate`) in your
   worktree until it is green. Before you report, invoke
   `superpowers:verification-before-completion`.
6. Commit in your worktree; nothing uncommitted may remain
   (`git status --porcelain` is empty).
7. Mark your task completed (TaskUpdate). If the hook refuses, its message
   says why; fix that and try again.
8. Send the lead (SendMessage) a short report: commits, the RED command with
   its failing assertion, the gate result, anything you could not do.

## Teammate rules

- Need an answer? Set your task to pending with a description that starts
  with `WAITING:` and holds your question, send the question to the lead,
  and end your turn.
- In PowerShell the run folder is `$env:TEAM_RUN_DIR`, in Bash
  `$TEAM_RUN_DIR`.
- Never push, never `--no-verify`, never `git stash` (the stash is shared).
- Never end processes by name, only by PID you started. Never start an
  interpreter that reads code from stdin (`python -`).
- Leave no background process running when you end your turn.
````

`agents/implementer-frontend.md`:

````markdown
---
name: implementer-frontend
description: Agent-team teammate that implements one frontend task (UI code, components, client state, styling) of a plan with TDD in its own worktree. Spawned by the orchestrator only.
tools: Read, Grep, Glob, Edit, Write, Bash, Skill
model: sonnet
effort: xhigh
---

You implement exactly one task of an agent-team run: a plan task (`[impl]`)
or a fix (`[fix]`). The spawn prompt names the run folder, the generation,
your task, your worktree and the feature branch.

Your domain: frontend — UI code, components, client state, styling.

## How

1. Work only in your worktree. The main tree is read-only for you.
2. Before writing code, invoke `superpowers:test-driven-development` and
   follow it. Every new test runs red against the state before your change;
   keep the command and its failing output.
3. For a bug fix `[fix] B<n>`: first apply the hunter's patch named in the
   task (`git apply <run folder>/evidence/<patch>`), run it and see it red.
   That is your RED.
4. For a conflict fix `[fix:…:conflict]`: rebase your worktree onto the
   feature branch and resolve the conflicts so that both sides keep their
   meaning; run the tests.
5. Run the project's gate (the command in `.claude/team-gate`) in your
   worktree until it is green. Before you report, invoke
   `superpowers:verification-before-completion`.
6. Commit in your worktree; nothing uncommitted may remain
   (`git status --porcelain` is empty).
7. Mark your task completed (TaskUpdate). If the hook refuses, its message
   says why; fix that and try again.
8. Send the lead (SendMessage) a short report: commits, the RED command with
   its failing assertion, the gate result, anything you could not do.

## Teammate rules

- Need an answer? Set your task to pending with a description that starts
  with `WAITING:` and holds your question, send the question to the lead,
  and end your turn.
- In PowerShell the run folder is `$env:TEAM_RUN_DIR`, in Bash
  `$TEAM_RUN_DIR`.
- Never push, never `--no-verify`, never `git stash` (the stash is shared).
- Never end processes by name, only by PID you started. Never start an
  interpreter that reads code from stdin (`python -`).
- Leave no background process running when you end your turn.
````

`agents/implementer-ux.md`:

````markdown
---
name: implementer-ux
description: Agent-team teammate that implements one UX task (interaction, copy, accessibility, visual consistency) of a plan with TDD in its own worktree. Spawned by the orchestrator only.
tools: Read, Grep, Glob, Edit, Write, Bash, Skill
model: sonnet
effort: xhigh
---

You implement exactly one task of an agent-team run: a plan task (`[impl]`)
or a fix (`[fix]`). The spawn prompt names the run folder, the generation,
your task, your worktree and the feature branch.

Your domain: UX — interaction, copy, accessibility, visual consistency; your tests check what a person sees and does.

## How

1. Work only in your worktree. The main tree is read-only for you.
2. Before writing code, invoke `superpowers:test-driven-development` and
   follow it. Every new test runs red against the state before your change;
   keep the command and its failing output.
3. For a bug fix `[fix] B<n>`: first apply the hunter's patch named in the
   task (`git apply <run folder>/evidence/<patch>`), run it and see it red.
   That is your RED.
4. For a conflict fix `[fix:…:conflict]`: rebase your worktree onto the
   feature branch and resolve the conflicts so that both sides keep their
   meaning; run the tests.
5. Run the project's gate (the command in `.claude/team-gate`) in your
   worktree until it is green. Before you report, invoke
   `superpowers:verification-before-completion`.
6. Commit in your worktree; nothing uncommitted may remain
   (`git status --porcelain` is empty).
7. Mark your task completed (TaskUpdate). If the hook refuses, its message
   says why; fix that and try again.
8. Send the lead (SendMessage) a short report: commits, the RED command with
   its failing assertion, the gate result, anything you could not do.

## Teammate rules

- Need an answer? Set your task to pending with a description that starts
  with `WAITING:` and holds your question, send the question to the lead,
  and end your turn.
- In PowerShell the run folder is `$env:TEAM_RUN_DIR`, in Bash
  `$TEAM_RUN_DIR`.
- Never push, never `--no-verify`, never `git stash` (the stash is shared).
- Never end processes by name, only by PID you started. Never start an
  interpreter that reads code from stdin (`python -`).
- Leave no background process running when you end your turn.
````

`agents/verifier.md`:

````markdown
---
name: verifier
description: Tries to refute every claim — of a spec, a plan, an implementer's evidence, review findings, hunt findings, a fix, a rebase or a final report — and backs what survives with a command and its output. Use after each step of an agent-team run, or as a planning subagent on spec and plan.
tools: Read, Grep, Glob, Bash, Write
model: opus
effort: high
---

You are the verifier. Your job is to refute. Every claim you are given is
false until a probe you ran shows otherwise; what survives you back with data:
the exact command and its output. Without a probe there is no "confirmed".

## As a planning subagent (no run folder in your prompt)

Check the spec or plan you are given against the code and the tools it talks
about: read the code it cites, run the commands it relies on, compute its
expected test results by hand. Return your findings as text, each with claim,
location, status (`confirmed` or `refuted`), the command you ran and the
relevant output. Write nothing in the repository.

## As a teammate (your prompt names a run folder)

Read the verdict rules (`verdicts.md`, path in your spawn prompt) before
writing a verdict. Your task title says what to judge:

- `[verify:impl] W`, `[verify:fix] W`: the implementer's claims, probed in
  the worktree of W. RED: put the changed non-test files back to the state
  before the change (`git checkout <base> -- <files>`, and move away files
  the change added), run the new tests and see them fail, then restore with
  `git checkout HEAD -- <files>`. `<base>` is the commit the lead names.
  Then run the gate — the command in `.claude/team-gate` — in the worktree and
  write the gate log.
- `[verify:review] W`: every finding of the two reviews named by the lead.
  Confirm a defect only with a probe that shows it (a failing test, a command
  output); refute what the code shows to be fine. Name both review task ids in
  `judges`.
- `[verify:rebase] W`: run the gate on the new HEAD and
  `git range-diff <feature before>..<old head> <feature>..<new head>`. Own
  commits unchanged and gate green → pass with `inherits`; otherwise refute
  the claim "own commits unchanged" or "gate is green".
- `[verify:hunt] B<n>`: apply the hunter's patch in a scratch copy, run the
  repro test, and decide whether it shows a real defect. A finding that
  repeats a known bug gets `duplicate_of`.
- `[verify:final] F`: the report and the plan checkboxes against the register,
  the verdicts and the feature branch; run the gate on the feature branch.

The gate log lives at `$TEAM_RUN_DIR/evidence/gate-<root>-<head>.txt`: line 1
the full HEAD hash, line 2 the exit code, then the output.

Leave every worktree as you found it: `git status --porcelain` is empty before
you end your turn. Delete only files your own runs created and git lists as
untracked; never `git clean -x`/`-d`, never `git stash`, never
`git reset --hard`.

Then mark your task completed (TaskUpdate). If the hook refuses, its message
names the broken rule; fix the verdict and try again. Send the lead a short
summary: verdict, confirmed findings, refuted claims.

## Teammate rules

- Need an answer? Set your task to pending with a description that starts
  with `WAITING:` and holds your question, send the question to the lead,
  and end your turn.
- In PowerShell the run folder is `$env:TEAM_RUN_DIR`, in Bash
  `$TEAM_RUN_DIR`.
- Never push. Never end processes by name, only by PID you started. Never
  start an interpreter that reads code from stdin (`python -`).
- Leave no background process running when you end your turn.
````

`agents/code-reviewer.md`:

````markdown
---
name: code-reviewer
description: Agent-team teammate that reviews the whole diff of one root against spec and plan — correctness, fidelity to the spec, tests, readability — and writes open findings. Spawned by the orchestrator only.
tools: Read, Grep, Glob, Bash, Write, Skill
model: opus
effort: medium
---

You review one root of an agent-team run. The spawn prompt names the run
folder, the generation, your task (`[review:code] W`), the worktree of W, the
feature branch, the spec and the plan.

## How

1. Invoke `superpowers:receiving-code-review` for its standard of technical
   rigour: every finding must hold against the code, not against a hunch.
2. Read the whole diff of the root: `git -C <worktree> diff <feature>...HEAD`.
   Note the HEAD you review (`git -C <worktree> rev-parse HEAD`).
3. Judge correctness first, then fidelity to spec and plan, then the tests (do
   they fail without the change, do they test the rule and not its neighbour),
   then readability. Name each defect with file:line and why it is one.
4. Read the verdict rules (`verdicts.md`, path in your spawn prompt) and
   write your verdict: every finding `status: "open"`, no
   `verdict` field. No findings is a valid review.
5. Mark your task completed (TaskUpdate) and send the lead a one-line summary.

The worktree is read-only for you: run commands, change nothing.

## Teammate rules

- Need an answer? Set your task to pending with a description that starts
  with `WAITING:` and holds your question, send the question to the lead,
  and end your turn.
- In PowerShell the run folder is `$env:TEAM_RUN_DIR`, in Bash
  `$TEAM_RUN_DIR`.
- Never push. Never end processes by name, only by PID you started. Never
  start an interpreter that reads code from stdin (`python -`).
- Leave no background process running when you end your turn.
````

`agents/security-reviewer.md`:

````markdown
---
name: security-reviewer
description: Agent-team teammate that reviews the whole diff of one root for security defects — injection, path traversal, authz, secrets, unsafe defaults — and writes open findings. Spawned by the orchestrator only.
tools: Read, Grep, Glob, Bash, Write, Skill
model: opus
effort: high
---

You review one root of an agent-team run for security. The spawn prompt names
the run folder, the generation, your task (`[review:security] W`), the
worktree of W and the feature branch.

## How

1. Read the whole diff of the root: `git -C <worktree> diff <feature>...HEAD`
   and note the HEAD you review.
2. Invoke `security-review` on that diff. Where the diff adds inputs that reach
   files, processes, queries or the network, invoke `vulnhunt` scoped to the
   changed files and trace each input to its sink.
3. Report each defect with file:line, the input that reaches it, and the
   impact. Do not build exploits; a precise location and the path of the input
   are enough for the verifier to probe.
4. Read the verdict rules (`verdicts.md`, path in your spawn prompt) and
   write your verdict: every finding `status: "open"`, no
   `verdict` field. No findings is a valid review.
5. Mark your task completed (TaskUpdate) and send the lead a one-line summary.

The worktree is read-only for you: run commands, change nothing.

## Teammate rules

- Need an answer? Set your task to pending with a description that starts
  with `WAITING:` and holds your question, send the question to the lead,
  and end your turn.
- In PowerShell the run folder is `$env:TEAM_RUN_DIR`, in Bash
  `$TEAM_RUN_DIR`.
- Never push. Never end processes by name, only by PID you started. Never
  start an interpreter that reads code from stdin (`python -`).
- Leave no background process running when you end your turn.
````

`agents/bug-hunter.md`:

````markdown
---
name: bug-hunter
description: Agent-team teammate that hunts bugs and exploitable defects in one partition of a finished feature branch and proves each with a red, runnable repro test. Spawned by the orchestrator only.
tools: Read, Grep, Glob, Bash, Write, Skill
model: opus
effort: high
---

You hunt bugs in one partition of an agent-team run's feature branch. The
spawn prompt names the run folder, the generation, your task
(`[hunt] R<r>.P<n> <partition>`), your detached worktree
(`$TEAM_RUN_DIR/worktrees/R<r>.P<n>`) and the feature branch.

## How

1. Read the partition and the spec. Look for wrong results, crashes and
   broken edge cases (empty, huge, unicode, concurrent, missing files). For
   exploitable inputs, invoke `vulnhunt` scoped to the partition.
2. For each suspected bug write a test that fails because of it and only
   because of it. Run it and keep the failing output.
3. Commit your repro tests in your worktree (it has no branch; the commit
   stays loose). For finding k export its patch:
   `git -C <worktree> diff <feature> HEAD -- <its test files> > "$TEAM_RUN_DIR/evidence/R<r>-P<n>-F<k>.patch"`.
4. Read the verdict rules (`verdicts.md`, path in your spawn prompt) and
   write your verdict: finding ids `R<r>-P<n>-F<k>`, each
   `status: "open"` with its `patch`. No findings is a valid hunt.
5. Leave the worktree clean (`git status --porcelain` empty), mark your task
   completed (TaskUpdate) and send the lead the list of findings.

## Teammate rules

- Need an answer? Set your task to pending with a description that starts
  with `WAITING:` and holds your question, send the question to the lead,
  and end your turn.
- In PowerShell the run folder is `$env:TEAM_RUN_DIR`, in Bash
  `$TEAM_RUN_DIR`.
- Never push. Never end processes by name, only by PID you started. Never
  start an interpreter that reads code from stdin (`python -`).
- Leave no background process running when you end your turn.
````

`agents/cleaner.md`:

````markdown
---
name: cleaner
description: Removes what an agent-team run leaves behind — its worktrees, its merged team branches and its run folder — without force, and reports what it cannot remove. Spawned by the orchestrator, or run by claude-team.ps1 -Cleanup.
tools: Read, Glob, Bash
model: haiku
effort: high
---

You clean up after an agent-team run. Your prompt names the repository, the
run (`<run>`, the last segment of `.team-runs/<run>`), the feature branch and
the unmerged team branches to keep and report. Run every command in the
repository's main tree. Never use `--force`, `-f`, `-D` or `reset --hard`.

1. For every folder under `.team-runs/<run>/worktrees/`:
   `git worktree remove <path>`. Then `git worktree prune`. If a removal
   fails, stop and report the folder with its `git -C <path> status --porcelain`;
   only the human removes a worktree with unsaved work.
2. `git branch --dry-run --delete-merged refs/heads/<feature> "team/<run>/*"`.
   Check that every line of the output names a `team/<run>/` branch, then run
   the same command without `--dry-run`. If git does not know
   `--delete-merged`, list `git branch --merged <feature> --list "team/<run>/*"`
   and delete each with `git branch -d <branch>`.
3. Delete the run folder: `rm -r .team-runs/<run>`. If `.team-runs/` then holds
   only `.gitignore`, remove that file (`rm .team-runs/.gitignore`) and the
   empty folder (`rmdir .team-runs`).
4. Check: `git worktree list` names no worktree under `.team-runs/<run>`,
   `git branch --list "team/<run>/*"` names only the branches you were told to
   keep, and `.team-runs/<run>` is gone.
5. If you hold a `[cleanup]` task, mark it completed (TaskUpdate) and send the
   lead what you removed and what is left. Otherwise print that report.

Never end processes by name. Never start an interpreter that reads code from
stdin (`python -`).
````

`agents/explorer.md`:

````markdown
---
name: explorer
description: Finds and summarises code for a question — where something lives, how a flow runs, who calls what — and answers with file:line references. Read-only. Use from the planner or the orchestrator.
tools: Read, Grep, Glob
model: haiku
effort: high
---

You find code and explain it. Answer the question you were given with the
facts the code shows, each with `path:line`. Quote only the lines that carry
the answer. Say plainly what you looked for and did not find; never guess what
code you have not read does. Change nothing.
````

`agents/researcher.md`:

````markdown
---
name: researcher
description: Answers questions from documentation, the web and other outside sources — tool behaviour, library APIs, release notes, standards — with a URL for every fact. Use from the planner or the orchestrator.
tools: Read, Grep, Glob, WebSearch, WebFetch
model: sonnet
effort: high
---

You research a question in outside sources. Prefer primary sources: the
project's own documentation, release notes, the standard, the source code.
Give every fact its URL and, for versioned software, the version it holds for.
When a long page matters, read the section itself, not a summary of it. Say
what you could not settle and which sources disagree. Change nothing.
````

- [ ] **Step 5: Rückfälle aus Task 1 (nur die durchgefallenen)**

- **Rauchtest 1** (Teammate kann `Skill` nicht rufen): In jedem Rumpf mit „invoke `<skill>`“ den Satz ergänzen: „If the Skill tool is not available, read the skill's `SKILL.md` with Read; its path is `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<name>/SKILL.md` for a plugin skill and `~/.claude/skills/<name>/SKILL.md` otherwise.“ Den Test `test_no_body_names_a_skill_by_its_versioned_path` behält das, weil der Satz ein Muster nennt, keinen Pfad mit Version.
- **Rauchtest 6** (Haiku startet nicht mit `effort`): In `agents/explorer.md` und `agents/cleaner.md` die Zeile `effort: high` streichen; in `test_agents.py` deren Tabellenzeile auf `effort` `None` stellen und die Assertion auf `(meta.get("model"), meta.get("effort"))` ändern.
- **Rauchtest 12** (unbenannter Agent wird trotzdem Teammate): In `agents/planner.md` den Startbefehl in Schritt 7 und am Kopf um den Hinweis ergänzen, dass der planner mit `--settings '{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"0"}}'` startet; Task 5 schreibt denselben Befehl in die README.

- [ ] **Step 6: GREEN und Typen**

Run: `uv run --no-project --python 3.13 --with pytest --with pytest-cov --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate -q -p no:cacheprovider -n 8 --cov=scripts --cov-branch --cov-report=term-missing --cov-fail-under=100`
Expected: PASS, 100 %.

Run: `MYPYPATH="scripts;scripts/tests/teamgate" uvx --python 3.13 --with pytest --with types-PyYAML mypy --strict --explicit-package-bases scripts/team-gate.py scripts/teamgate_tasks.py scripts/teamgate_cmd.py scripts/tests/teamgate`
Expected: `Success: no issues found`

- [ ] **Step 7: Gegenproben zum Definitionstest**

Je eine Änderung einzeln, Test rot, zurück (Edit, kein `sed`): in `agents/verifier.md` `effort: high` → `effort: medium` (rot: `test_a_definition_matches_its_table_row[verifier]`); in `agents/bug-hunter.md` „invoke `vulnhunt`“ → „invoke `vulnhunt-x`“ (rot: Tabellenzeile und `test_every_skill_a_body_invokes_exists`); `agents/explorer.md` nach `agents/explorer2.md` kopieren (rot: `test_there_are_exactly_the_thirteen_roles`). Danach `git status --porcelain` zeigt nur die neuen Dateien des Tasks.

- [ ] **Step 8: Commit**

```bash
git add agents docs/agent-team/verdicts.md scripts/tests/teamgate/test_agents.py
git commit -m "Define the thirteen roles of the agent team and their verdict rules"
```

### Task 5: Starter `claude-team.ps1`

**Files:**
- Create: `scripts/claude-team.ps1`
- Test: `scripts/tests/ClaudeTeam.Tests.ps1` (Name nach der Regel in `Repo.Tests.ps1`: `ToTitleCase('claude-team')` ohne Bindestrich)
- Modify: `README.md` (Abschnitt „Agent-Team“ vor `## Tests`), `scripts/tests/Repo.Tests.ps1` (ein `It` im `Describe 'README'`)

**Interfaces:**
- Consumes: `scripts/team-gate.py` mit den Ereignissen `task-created`, `task-completed`, `post-task-update`, `pre-tool-use` (Task 2, 3); `agents/orchestrator.md` und `agents/cleaner.md` (Task 4) und deren erwarteter Startprompt; `docs/agent-team/verdicts.md` (Task 4).
- Produces: `claude-team.ps1 <plan> | -Resume <lauf> | -Cleanup <lauf>`; `run.json` mit `plan`, `repo`, `feature_branch`, `claude_version`, `git_version`, `generation`; die Settings-Datei `~/.claude/team-settings/<repo>-<lauf>.json`. Exit 0 Erfolg, 1 Voraussetzung fehlt oder `-Cleanup` ließ Reste, 2 falscher Aufruf; sonst der Exit-Code von `claude`.

- [ ] **Step 1: Tests schreiben**

`scripts/tests/ClaudeTeam.Tests.ps1`:

````powershell
BeforeAll {
    $script:ScriptDir = Split-Path -Parent $PSScriptRoot
    . (Join-Path $script:ScriptDir 'claude-team.ps1') -DotSourceOnly

    function New-TestRepo {
        param([string]$Name = 'proj')
        $repo = Join-Path $TestDrive "$Name-$([guid]::NewGuid().ToString('N').Substring(0, 6))"
        New-Item -ItemType Directory -Path $repo | Out-Null
        git -C $repo init -q -b main
        git -C $repo config user.email t@example.org
        git -C $repo config user.name T
        New-Item -ItemType Directory -Path (Join-Path $repo '.claude') | Out-Null
        Set-Content -LiteralPath (Join-Path $repo '.claude/team-gate') -Value 'pwsh -File gate.ps1'
        New-Item -ItemType Directory -Path (Join-Path $repo 'docs') | Out-Null
        Set-Content -LiteralPath (Join-Path $repo 'docs/plan.md') -Value '# Plan'
        git -C $repo add -A
        git -C $repo commit -q -m init
        git -C $repo switch -q -c feat/x
        return ($repo -replace '\\', '/')
    }
}

Describe 'Get-GitVersion' {
    It 'reads a Windows build string' {
        Mock git { 'git version 2.54.0.vfs.0.4' }
        Get-GitVersion | Should -Be ([version]'2.54.0')
    }
    It 'throws on a string without a version' {
        Mock git { 'nothing here' }
        { Get-GitVersion } | Should -Throw '*cannot read the git version*'
    }
}

Describe 'Test-TeamPrerequisite' {
    BeforeEach {
        $script:Repo = New-TestRepo
        Mock Get-GitVersion { [version]'2.56.0' }
    }

    It 'lets a clean repo with a committed plan through' {
        @(Test-TeamPrerequisite -Repo $Repo -Plan 'docs/plan.md' -New) | Should -HaveCount 0
    }
    It 'refuses git older than 2.56' {
        Mock Get-GitVersion { [version]'2.54.0' }
        Test-TeamPrerequisite -Repo $Repo -Plan 'docs/plan.md' -New | Should -Match 'git 2.54.0 is too old'
    }
    It 'refuses a repo without .claude/team-gate' {
        git -C $Repo rm -q .claude/team-gate
        git -C $Repo commit -q -m 'drop gate'
        Test-TeamPrerequisite -Repo $Repo -Plan 'docs/plan.md' -New | Should -Match 'team-gate is missing'
    }
    It 'refuses a dirty tree for a new run' {
        Set-Content -LiteralPath "$Repo/loose.txt" -Value x
        Test-TeamPrerequisite -Repo $Repo -Plan 'docs/plan.md' -New | Should -Match 'not clean'
    }
    It 'refuses a plan that is not committed' {
        Test-TeamPrerequisite -Repo $Repo -Plan 'docs/other.md' -New | Should -Match 'is not committed'
    }
    It 'only warns about a dirty tree on resume' {
        Set-Content -LiteralPath "$Repo/loose.txt" -Value x
        @(Test-TeamPrerequisite -Repo $Repo -WarningVariable warned -WarningAction SilentlyContinue) | Should -HaveCount 0
        $warned | Should -Match 'not clean'
    }
}

Describe 'New-TeamRun' {
    BeforeEach {
        $script:Repo = New-TestRepo
        Mock Get-GitVersion { [version]'2.56.0' }
        Mock Get-ClaudeVersion { '2.1.293' }
    }

    It 'builds the run folder and leaves git status empty' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name '20261008-120000'
        foreach ($sub in 'verdicts', 'evidence', 'worktrees') { Join-Path $run $sub | Should -Exist }
        Get-Content -LiteralPath "$Repo/.team-runs/.gitignore" -Raw | Should -Be "*`n"
        @(git -C $Repo status --porcelain) | Should -HaveCount 0
    }
    It 'writes run.json with generation 1 and the feature branch' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1'
        $meta = Read-RunJson -Run $run
        $meta.generation | Should -Be 1
        $meta.feature_branch | Should -Be 'feat/x'
        $meta.plan | Should -Be 'docs/plan.md'
        $meta.claude_version | Should -Be '2.1.293'
        $meta.git_version | Should -Be '2.56.0'
    }
    It 'keeps an existing .gitignore' {
        New-Item -ItemType Directory -Path "$Repo/.team-runs" | Out-Null
        [System.IO.File]::WriteAllText("$Repo/.team-runs/.gitignore", "*`n# mine`n")
        New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1' | Out-Null
        Get-Content -LiteralPath "$Repo/.team-runs/.gitignore" -Raw | Should -Match '# mine'
    }
}

Describe 'New-TeamSettings' {
    BeforeAll {
        $script:Repo = New-TestRepo
        Mock Get-SettingsPath { Join-Path $TestDrive 'settings/proj-r1.json' }
        $script:Path = New-TeamSettings -Repo $Repo -Run "$Repo/.team-runs/r1" -Name 'r1'
        $script:Settings = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
    }

    It 'switches teams and the task tools on and names the run folder' {
        $Settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS | Should -Be '1'
        $Settings.env.CLAUDE_CODE_ENABLE_TODO_TOOLS | Should -Be '1'
        $Settings.env.TEAM_RUN_DIR | Should -Be "$Repo/.team-runs/r1"
    }
    It 'wires every hook to team-gate with the run and a 30 s timeout' {
        $expect = @{ TaskCreated = 'task-created'; TaskCompleted = 'task-completed'; PostToolUse = 'post-task-update'; PreToolUse = 'pre-tool-use' }
        foreach ($event in $expect.Keys) {
            $hook = $Settings.hooks[$event][0].hooks[0]
            $hook.timeout | Should -Be 30
            $hook.command | Should -Match '^uv run --script ".*/team-gate\.py" --run ".*/\.team-runs/r1" '
            $hook.command | Should -Match "$($expect[$event])$"
        }
        $Settings.hooks.PostToolUse[0].matcher | Should -Be 'TaskUpdate'
        $Settings.hooks.PreToolUse[0].matcher | Should -Be 'Bash|PowerShell'
        $Settings.hooks.TaskCreated[0].ContainsKey('matcher') | Should -BeFalse
    }
    It 'denies push, merge and --no-verify for Bash and PowerShell' {
        $Settings.permissions.deny | Should -HaveCount 6
        $Settings.permissions.deny | Should -Contain 'Bash(git push:*)'
        $Settings.permissions.deny | Should -Contain 'PowerShell(gh pr merge:*)'
        $Settings.permissions.deny | Should -Contain 'PowerShell(git commit --no-verify:*)'
    }
}

Describe 'Get-SettingsPath' {
    It 'lies under ~/.claude/team-settings and names repo and run' {
        $path = Get-SettingsPath -Repo 'C:/x/proj' -Name 'r1'
        $path | Should -BeLike "$([Environment]::GetFolderPath('UserProfile'))*team-settings*proj-r1.json"
    }
}

Describe 'Get-LeadArgument' {
    It 'starts the orchestrator in-process with the run folder and settings' {
        $argv = Get-LeadArgument -Run 'C:/r' -Settings 'C:/s.json' -Meta @{ plan = 'p.md'; generation = 2; feature_branch = 'feat/x' }
        $argv[0..7] -join ' ' | Should -Be '--agent orchestrator --teammate-mode in-process --add-dir C:/r --settings C:/s.json'
        $argv[8] | Should -Match 'p\.md.*Run folder: C:/r.*Generation: 2.*Feature branch: feat/x.*Verdict rules: .*/docs/agent-team/verdicts\.md'
        $argv | Should -Not -Contain '--model'
    }
}

Describe 'Invoke-WithoutEffortOverride' {
    It 'hides CLAUDE_CODE_EFFORT_LEVEL from claude and restores it' {
        $env:CLAUDE_CODE_EFFORT_LEVEL = 'max'
        try {
            Mock Invoke-ClaudeProcess { $script:Seen = $env:CLAUDE_CODE_EFFORT_LEVEL; 0 }
            Invoke-WithoutEffortOverride -ArgumentList @('x') | Should -Be 0
            $script:Seen | Should -BeNullOrEmpty
            $env:CLAUDE_CODE_EFFORT_LEVEL | Should -Be 'max'
        } finally { Remove-Item env:CLAUDE_CODE_EFFORT_LEVEL -ErrorAction SilentlyContinue }
    }
    It 'restores it when claude throws' {
        $env:CLAUDE_CODE_EFFORT_LEVEL = 'low'
        try {
            Mock Invoke-ClaudeProcess { throw 'boom' }
            { Invoke-WithoutEffortOverride -ArgumentList @('x') } | Should -Throw 'boom'
            $env:CLAUDE_CODE_EFFORT_LEVEL | Should -Be 'low'
        } finally { Remove-Item env:CLAUDE_CODE_EFFORT_LEVEL -ErrorAction SilentlyContinue }
    }
}

Describe 'Invoke-ClaudeTeam' {
    BeforeEach {
        $script:Repo = New-TestRepo
        Mock Get-GitVersion { [version]'2.56.0' }
        Mock Get-ClaudeVersion { '2.1.293' }
        Mock Get-SettingsPath { Join-Path $TestDrive "settings/$Name.json" }
        Mock Invoke-ClaudeProcess { $script:Argv = $ArgumentList; 0 }
        Push-Location $Repo
    }
    AfterEach { Pop-Location }

    It 'refuses no or two modes' {
        Invoke-ClaudeTeam | Should -Be 2
        Invoke-ClaudeTeam -Plan 'docs/plan.md' -Resume 'r' | Should -Be 2
    }
    It 'starts a new run and keeps the settings while the run folder lives' {
        Invoke-ClaudeTeam -Plan 'docs/plan.md' | Should -Be 0
        $run = @(Get-ChildItem "$Repo/.team-runs" -Directory)[0]
        $Argv | Should -Contain '--agent'
        $Argv | Should -Contain $run.FullName
        Get-ChildItem (Join-Path $TestDrive 'settings') -Filter "$($run.Name).json" | Should -HaveCount 1
    }
    It 'stops before claude when a prerequisite fails' {
        Mock Get-GitVersion { [version]'2.54.0' }
        Invoke-ClaudeTeam -Plan 'docs/plan.md' | Should -Be 1
        Should -Invoke Invoke-ClaudeProcess -Times 0
        Test-Path "$Repo/.team-runs" | Should -BeFalse
    }
    It 'resumes with the next generation' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1'
        Invoke-ClaudeTeam -Resume 'r1' | Should -Be 0
        (Read-RunJson -Run $run).generation | Should -Be 2
        $Argv[-1] | Should -Match 'Generation: 2'
    }
    It 'deletes the settings once the lead has cleaned the run away' {
        Remove-Item (Join-Path $TestDrive 'settings') -Recurse -Force -ErrorAction SilentlyContinue
        Mock Invoke-ClaudeProcess { Remove-Item -Recurse -Force "$Repo/.team-runs"; 0 }
        Invoke-ClaudeTeam -Plan 'docs/plan.md' | Should -Be 0
        @(Get-ChildItem (Join-Path $TestDrive 'settings') -ErrorAction SilentlyContinue | Where-Object Name -Like '2*') | Should -HaveCount 0
    }
    It 'cleans up through the cleaner and exits 0 when nothing is left' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1'
        Mock Invoke-ClaudeProcess { $script:Argv = $ArgumentList; Remove-Item -Recurse -Force $run; 0 }
        Invoke-ClaudeTeam -Cleanup 'r1' | Should -Be 0
        $Argv[0..2] -join ' ' | Should -Be '-p --agent cleaner'
        $Argv | Should -Contain 'auto'
        $Argv[-1] | Should -Match 'Unmerged branches to keep and report: none'
    }
    It 'exits 1 and names what the cleaner left' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1'
        git -C $Repo worktree add -q --track -b team/r1/T1 "$run/worktrees/T1" feat/x
        git -C "$run/worktrees/T1" commit -q --allow-empty -m wip
        Invoke-ClaudeTeam -Cleanup 'r1' | Should -Be 1
        $left = @(Get-CleanupLeftover -Repo $Repo -Name 'r1' -Allowed @('team/r1/T1'))
        $left | Should -HaveCount 2
        $left[0] | Should -BeLike 'worktree *worktrees/T1'
        $left[1] | Should -BeLike 'folder *r1'
    }
    It 'leaves the caller environment as it was' {
        $before = (Get-ChildItem env: | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join "`n"
        Invoke-ClaudeTeam -Plan 'docs/plan.md' | Out-Null
        (Get-ChildItem env: | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join "`n" | Should -Be $before
    }
}
````

- [ ] **Step 2: Stub anlegen, RED zeigen**

`scripts/claude-team.ps1` zunächst als Stub:

````powershell
# RED baseline for Task 5: the functions of the real starter, none doing anything.
[CmdletBinding()]
param([string]$Plan, [string]$Resume, [string]$Cleanup, [switch]$DotSourceOnly)

function Get-GitVersion { param() }
function Get-RepoRoot { param() }
function Test-TeamPrerequisite { param([string]$Repo, [string]$Plan, [switch]$New) }
function New-TeamRun { param([string]$Repo, [string]$Plan, [string]$Name) }
function Get-ClaudeVersion { param() }
function Read-RunJson { param([string]$Run) }
function Write-RunJson { param([string]$Run, $Meta) }
function Get-SettingsPath { param([string]$Repo, [string]$Name) }
function New-TeamSettings { param([string]$Repo, [string]$Run, [string]$Name) }
function Get-LeadArgument { param([string]$Run, [string]$Settings, $Meta) }
function Invoke-ClaudeProcess { param([string[]]$ArgumentList) }
function Invoke-WithoutEffortOverride { param([string[]]$ArgumentList) }
function Get-CleanupLeftover { param([string]$Repo, [string]$Name, [string[]]$Allowed) }
function Remove-ClosedSettings { param([string]$Settings, [string]$Run) }
function Invoke-ClaudeTeam { param([string]$Plan, [string]$Resume, [string]$Cleanup) }
````

Run: `pwsh -NoProfile -c 'Invoke-Pester -Path scripts/tests/ClaudeTeam.Tests.ps1 -Output Detailed' > <scratch>/t5-red.txt 2>&1`
Expected: 23 rot, 3 grün — grün sind nur `lets a clean repo with a committed plan through`, `keeps an existing .gitignore` und `leaves the caller environment as it was`, die ein Stub ohne Wirkung erfüllt. (Gemessen gegen den Prototyp.)

- [ ] **Step 3: Den echten Starter einsetzen**

`scripts/claude-team.ps1` ganz ersetzen:

````powershell
# Start, resume or clean up an agent-team run of a committed plan.
# Spec: docs/.superpowers/specs/2026-10-08-agent-team-design.md, section 7.
#
#   claude-team.ps1 <plan>              new run on the current (feature) branch
#   claude-team.ps1 -Resume <run>       next generation of a run whose lead died
#   claude-team.ps1 -Cleanup <run>      tidy away a run nobody will resume
#
# Dot-source with -DotSourceOnly to get the functions without running.
[CmdletBinding(DefaultParameterSetName = 'New')]
param(
    [Parameter(Position = 0)][string]$Plan,
    [string]$Resume,
    [string]$Cleanup,
    [switch]$DotSourceOnly
)

$ErrorActionPreference = 'Stop'

$script:MinimumGit = [version]'2.56.0'
$script:GatePath = (Join-Path $PSScriptRoot 'team-gate.py') -replace '\\', '/'
# Next to the scripts, not under ~/.claude: a run from a worktree of this repo
# then reads the rules of that worktree.
$script:VerdictRules = (Join-Path (Split-Path -Parent $PSScriptRoot) 'docs/agent-team/verdicts.md') -replace '\\', '/'

function Get-GitVersion {
    [OutputType([version])]
    param()
    $text = git --version
    if ($text -notmatch '(\d+)\.(\d+)\.(\d+)') { throw "cannot read the git version from: $text" }
    return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
}

function Get-RepoRoot {
    [OutputType([string])]
    param()
    $root = git rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'claude-team must run inside a git repository' }
    return $root
}

function Test-TeamPrerequisite {
    <#
        Reasons that refuse the start; an empty list lets it go ahead. A
        resumed run only warns about a dirty tree: the dead lead may have
        left it so, and the new lead reads it.
    #>
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][string]$Repo,
        [AllowEmptyString()][string]$Plan,
        [switch]$New
    )
    $reasons = [System.Collections.Generic.List[string]]::new()
    $git = Get-GitVersion
    if ($git -lt $script:MinimumGit) {
        $reasons.Add("git $git is too old; the run needs git $($script:MinimumGit) for branch --delete-merged")
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Repo '.claude/team-gate') -PathType Leaf)) {
        $reasons.Add('.claude/team-gate is missing: it names the gate command the verifier runs')
    }
    $dirty = @(git -C $Repo status --porcelain)
    if ($New) {
        if ($dirty.Count -gt 0) { $reasons.Add('the working tree is not clean') }
        git -C $Repo ls-files --error-unmatch -- $Plan 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { $reasons.Add("the plan $Plan is not committed on the current branch") }
    } elseif ($dirty.Count -gt 0) {
        Write-Warning 'the working tree is not clean; the new lead will find it so'
    }
    return @($reasons)
}

function New-TeamRun {
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$Plan,
        [Parameter(Mandatory)][string]$Name
    )
    $runs = Join-Path $Repo '.team-runs'
    $run = Join-Path $runs $Name
    foreach ($sub in 'verdicts', 'evidence', 'worktrees') {
        New-Item -ItemType Directory -Path (Join-Path $run $sub) -Force | Out-Null
    }
    # git ignores the folder and this file with it; nothing outside is touched.
    $ignore = Join-Path $runs '.gitignore'
    if (-not (Test-Path -LiteralPath $ignore)) { [System.IO.File]::WriteAllText($ignore, "*`n") }
    $meta = [ordered]@{
        plan           = $Plan -replace '\\', '/'
        repo           = $Repo -replace '\\', '/'
        feature_branch = (git -C $Repo branch --show-current)
        claude_version = (Get-ClaudeVersion)
        git_version    = [string](Get-GitVersion)
        generation     = 1
    }
    Write-RunJson -Run $run -Meta $meta
    return $run
}

function Get-ClaudeVersion {
    [OutputType([string])]
    param()
    return (claude --version) -replace ' \(Claude Code\)', ''
}

function Read-RunJson {
    param([Parameter(Mandatory)][string]$Run)
    return Get-Content -LiteralPath (Join-Path $Run 'run.json') -Raw | ConvertFrom-Json -AsHashtable
}

function Write-RunJson {
    param([Parameter(Mandatory)][string]$Run, [Parameter(Mandatory)]$Meta)
    $json = $Meta | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText((Join-Path $Run 'run.json'), $json + "`n")
}

function Get-SettingsPath {
    [OutputType([string])]
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$Name)
    $home_ = [Environment]::GetFolderPath('UserProfile')
    return Join-Path $home_ ".claude/team-settings/$(Split-Path -Leaf $Repo)-$Name.json"
}

function New-TeamSettings {
    <#
        The run's own settings file. Outside the run folder, because the
        cleaner deletes that; the hooks and the team switch live only here,
        so no other session ever loads them.
    #>
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$Run,
        [Parameter(Mandatory)][string]$Name
    )
    $runSlash = $Run -replace '\\', '/'
    function hook([string]$event) {
        @{ type = 'command'; timeout = 30; command = "uv run --script `"$($script:GatePath)`" --run `"$runSlash`" $event" }
    }
    $deny = foreach ($tool in 'Bash', 'PowerShell') {
        foreach ($cmd in 'git push', 'gh pr merge', 'git commit --no-verify') { "$tool($($cmd):*)" }
    }
    $settings = [ordered]@{
        env         = [ordered]@{
            CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
            CLAUDE_CODE_ENABLE_TODO_TOOLS        = '1'
            TEAM_RUN_DIR                         = $runSlash
        }
        hooks       = [ordered]@{
            TaskCreated   = @(@{ hooks = @(hook 'task-created') })
            TaskCompleted = @(@{ hooks = @(hook 'task-completed') })
            PostToolUse   = @(@{ matcher = 'TaskUpdate'; hooks = @(hook 'post-task-update') })
            PreToolUse    = @(@{ matcher = 'Bash|PowerShell'; hooks = @(hook 'pre-tool-use') })
        }
        permissions = @{ deny = @($deny) }
    }
    $path = Get-SettingsPath -Repo $Repo -Name $Name
    New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
    [System.IO.File]::WriteAllText($path, ($settings | ConvertTo-Json -Depth 8) + "`n")
    return $path
}

function Get-LeadArgument {
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][string]$Run,
        [Parameter(Mandatory)][string]$Settings,
        [Parameter(Mandatory)]$Meta
    )
    $prompt = "Run the agent-team plan $($Meta.plan). Run folder: $($Run -replace '\\', '/'). " +
        "Generation: $($Meta.generation). Feature branch: $($Meta.feature_branch). " +
        "Verdict rules: $($script:VerdictRules). Follow your orchestrator instructions."
    return @('--agent', 'orchestrator', '--teammate-mode', 'in-process', '--add-dir', $Run, '--settings', $Settings, $prompt)
}

function Invoke-ClaudeProcess {
    # The one place that starts claude; tests replace it.
    param([string[]]$ArgumentList)
    & claude @ArgumentList
    return $LASTEXITCODE
}

function Invoke-WithoutEffortOverride {
    <#
        CLAUDE_CODE_EFFORT_LEVEL would override the effort of every role
        definition. Removed for the child only: the caller's environment is
        exactly as before once claude ends, even if it throws.
    #>
    param([Parameter(Mandatory)][string[]]$ArgumentList)
    $saved = [Environment]::GetEnvironmentVariable('CLAUDE_CODE_EFFORT_LEVEL', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('CLAUDE_CODE_EFFORT_LEVEL', $null, 'Process')
        return Invoke-ClaudeProcess -ArgumentList $ArgumentList
    } finally {
        [Environment]::SetEnvironmentVariable('CLAUDE_CODE_EFFORT_LEVEL', $saved, 'Process')
    }
}

function Get-CleanupLeftover {
    <# What a finished cleanup must not leave behind (spec section 8, step 4). #>
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$Name,
        [AllowEmptyCollection()][string[]]$Allowed = @()
    )
    $run = Join-Path $Repo ".team-runs/$Name"
    $prefix = ((Join-Path $run 'worktrees') -replace '\\', '/').ToLowerInvariant()
    $left = foreach ($line in @(git -C $Repo worktree list --porcelain)) {
        if ($line -like 'worktree *') {
            $path = $line.Substring(9)
            if ($path.ToLowerInvariant().StartsWith($prefix)) { "worktree $path" }
        }
    }
    $branches = @(git -C $Repo branch --list "team/$Name/*" --format='%(refname:short)')
    $left = @($left) + @($branches | Where-Object { $_ -and $Allowed -notcontains $_ } | ForEach-Object { "branch $_" })
    if (Test-Path -LiteralPath $run) { $left += "folder $run" }
    return @($left)
}

function Remove-ClosedSettings {
    param([Parameter(Mandatory)][string]$Settings, [Parameter(Mandatory)][string]$Run)
    if (-not (Test-Path -LiteralPath $Run) -and (Test-Path -LiteralPath $Settings)) {
        Remove-Item -LiteralPath $Settings
    }
}

function Invoke-ClaudeTeam {
    [OutputType([int])]
    param([string]$Plan, [string]$Resume, [string]$Cleanup)

    $repo = Get-RepoRoot
    $chosen = @($Plan, $Resume, $Cleanup | Where-Object { $_ }).Count
    if ($chosen -ne 1) {
        Write-Host 'usage: claude-team.ps1 <plan> | -Resume <run> | -Cleanup <run>' -ForegroundColor Red
        return 2
    }

    if ($Cleanup) {
        $run = Join-Path $repo ".team-runs/$Cleanup"
        $settings = Get-SettingsPath -Repo $repo -Name $Cleanup
        $meta = Read-RunJson -Run $run
        $keep = @(git -C $repo branch --no-merged $meta.feature_branch --list "team/$Cleanup/*" --format='%(refname:short)')
        $prompt = "Clean up the agent-team run $Cleanup in $($repo -replace '\\', '/'). Feature branch: $($meta.feature_branch). " +
            "Unmerged branches to keep and report: $(if ($keep) { $keep -join ', ' } else { 'none' })."
        Invoke-WithoutEffortOverride -ArgumentList @('-p', '--agent', 'cleaner', '--settings', $settings,
            '--permission-mode', 'auto', $prompt) | Out-Null
        $left = @(Get-CleanupLeftover -Repo $repo -Name $Cleanup -Allowed $keep)
        Remove-ClosedSettings -Settings $settings -Run $run
        if ($left.Count -gt 0) {
            $left | ForEach-Object { Write-Host "left behind: $_" -ForegroundColor Red }
            return 1
        }
        return 0
    }

    $reasons = @(Test-TeamPrerequisite -Repo $repo -Plan $Plan -New:([bool]$Plan))
    if ($reasons.Count -gt 0) {
        $reasons | ForEach-Object { Write-Host "claude-team: $_" -ForegroundColor Red }
        return 1
    }

    if ($Resume) {
        $name = $Resume
        $run = Join-Path $repo ".team-runs/$name"
        $meta = Read-RunJson -Run $run
        $meta.generation = [int]$meta.generation + 1
        Write-RunJson -Run $run -Meta $meta
    } else {
        $name = Get-Date -Format 'yyyyMMdd-HHmmss'
        $run = New-TeamRun -Repo $repo -Plan $Plan -Name $name
        $meta = Read-RunJson -Run $run
    }
    $settings = New-TeamSettings -Repo $repo -Run $run -Name $name
    $code = Invoke-WithoutEffortOverride -ArgumentList (Get-LeadArgument -Run $run -Settings $settings -Meta $meta)
    Remove-ClosedSettings -Settings $settings -Run $run
    return $code
}

if (-not $DotSourceOnly) {
    exit (Invoke-ClaudeTeam -Plan $Plan -Resume $Resume -Cleanup $Cleanup)
}
````

- [ ] **Step 4: Rückfälle aus Task 1 (nur die durchgefallenen)**

- **Rauchtest 0** (Task-Werkzeuge nur über `--allowedTools`): in `Get-LeadArgument` vor `$prompt` die Elemente `'--allowedTools', 'TaskCreate,TaskGet,TaskList,TaskUpdate'` einfügen und im Test `starts the orchestrator in-process …` die erwartete Zeile um genau diese zwei Wörter ergänzen.
- **Rauchtest 5** (`--agent` wendet `effort` nicht an): in `Get-LeadArgument` `'--effort', 'medium'` ergänzen, im Test ebenso; in der README beim planner-Befehl `--effort high` ergänzen.
- **Rauchtest 12**: in der README den planner-Befehl um `--settings '{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"0"}}'` ergänzen (wie Task 4 im planner-Rumpf).

- [ ] **Step 5: README und Repo-Test**

In `README.md` direkt vor der Zeile `## Tests` einfügen:

````markdown
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
````

In `scripts/tests/Repo.Tests.ps1` im `Describe 'README'` nach `It 'records that plugin state files are deliberately not versioned'` einfügen:

```powershell
    It 'documents how to start an agent-team run' {
        # Without the starter line and the gate file nobody finds the way in.
        $script:Readme | Should -Match 'claude-team\.ps1'
        $script:Readme | Should -Match '\.claude/team-gate'
    }
```

- [ ] **Step 6: GREEN**

Run: `pwsh -NoProfile -c 'Invoke-Pester -Path scripts/tests -Output Detailed' > <scratch>/t5-green.txt 2>&1`
Expected: alle Tests von `ClaudeTeam.Tests.ps1` grün (26), `documents how to start an agent-team run` grün, `has a test module for every script` grün; rot nur die fünf Tests des Vorbestands aus den Global Constraints.

- [ ] **Step 7: Gegenproben**

Einzeln per Edit, Test rot, zurück: in `Invoke-WithoutEffortOverride` das `finally` entfernen und die Wiederherstellung hinter den Aufruf ziehen (rot: `restores it when claude throws`); in `New-TeamSettings` `timeout = 30` → `timeout = 300` (rot: `wires every hook …`); in `Test-TeamPrerequisite` `-lt` → `-le` (rot: `lets a clean repo …`, weil 2.56.0 dann abgelehnt wird); in `Invoke-ClaudeTeam` den Aufruf `Remove-ClosedSettings` streichen (rot: `deletes the settings once the lead has cleaned the run away`).

- [ ] **Step 8: Commit**

```bash
git add scripts/claude-team.ps1 scripts/tests/ClaudeTeam.Tests.ps1 scripts/tests/Repo.Tests.ps1 README.md
git commit -m "Add the starter that opens, resumes and cleans up a team run"
```

### Task 6: Rauchtests 13 und 14, Ende-zu-Ende-Lauf

**Wer:** Controller zusammen mit dem Menschen (interaktive Sitzung für den Lauf).

**Files:**
- Create: `docs/.superpowers/smoke/2026-10-08-ende-zu-ende.md` (Protokoll mit Rauchtest 13, 14, Ergebnis und Kosten je Rolle)
- Modify, nur bei Rückfall: `scripts/claude-team.ps1` und `scripts/tests/ClaudeTeam.Tests.ps1` (Rauchtest 14), `agents/cleaner.md` (Rauchtest 13)
- Temporär: Junction `~/.claude/agents` → `agents/` dieses Worktrees; Spielzeug-Repo `<scratchpad>/e2e-repo`

**Interfaces:**
- Consumes: alles aus Task 2–5.
- Produces: das Protokoll; der Bericht des Laufs bleibt im Spielzeug-Repo und wird ins Protokoll zitiert.

- [ ] **Step 1: git ≥ 2.56**

Der Mensch aktualisiert git (`winget upgrade --id Git.Git`). Danach `git --version` — erwartet ≥ 2.56.0; sonst hier anhalten.

- [ ] **Step 2: Rauchtest 13**

Per Write nach `<scratchpad>/rt13.ps1`:

````powershell
# Smoke test 13: the git 2.56 forms the cleaner relies on, in a throwaway repo.
param([Parameter(Mandatory)][string]$Root)
$ErrorActionPreference = 'Stop'
$repo = Join-Path $Root 'rt13'
New-Item -ItemType Directory -Force -Path $repo | Out-Null
git -C $repo init -q -b main
git -C $repo config user.email t@example.org
git -C $repo config user.name T
Set-Content -LiteralPath "$repo/a.txt" -Value a
git -C $repo add a.txt
git -C $repo commit -q -m init
git -C $repo switch -q -c feat/x
foreach ($root in 'T1', 'T2') {
    git -C $repo worktree add -q --track -b "team/r/$root" "$repo/.team-runs/r/worktrees/$root" feat/x
    git -C "$repo/.team-runs/r/worktrees/$root" commit -q --allow-empty -m $root
}
git -C $repo merge -q --ff-only team/r/T1                      # T1 merged, T2 not
git -C $repo worktree add -q --detach "$repo/.team-runs/r/worktrees/R1.P1" feat/x

"--- 1: worktree remove without --force on a clean detached worktree"
git -C $repo worktree remove "$repo/.team-runs/r/worktrees/R1.P1"; "exit $LASTEXITCODE"
"--- 2: dry run while T1 is still checked out (expected: T1 skipped or listed?)"
git -C $repo branch --dry-run --delete-merged refs/heads/feat/x "team/r/*"; "exit $LASTEXITCODE"
git -C $repo worktree remove "$repo/.team-runs/r/worktrees/T1"
git -C $repo worktree remove "$repo/.team-runs/r/worktrees/T2"
"--- 3: dry run after the worktrees are gone (expected: only team/r/T1)"
git -C $repo branch --dry-run --delete-merged refs/heads/feat/x "team/r/*"; "exit $LASTEXITCODE"
"--- 4: the real run"
git -C $repo branch --delete-merged refs/heads/feat/x "team/r/*"; "exit $LASTEXITCODE"
"--- 5: what is left (expected: team/r/T2)"
git -C $repo branch --list "team/r/*"
````

Run: `pwsh -NoProfile -File <scratchpad>/rt13.ps1 -Root <scratchpad> > <scratchpad>/rt13.txt 2>&1`

Ungeprobt beim Planen (installiert war git 2.54). Bestanden, wenn: Abschnitt 1 Exit 0; Abschnitt 3 nennt nur `team/r/T1`; Abschnitt 4 Exit 0; Abschnitt 5 nennt nur `team/r/T2`. Abschnitt 2 wird nur notiert (überspringt git den ausgecheckten Zweig still, wie Spec Abschnitt 2 Punkt 11 sagt?). **Rückfall Rauchtest 13:** Kennt git die Form nicht oder listet anderes, in `agents/cleaner.md` Schritt 2 auf den schon beschriebenen Weg `git branch --merged … --list` plus `git branch -d` umstellen (den ersten Satz streichen, den „If git does not know“-Satz zur Regel machen) und das ins Protokoll schreiben.

- [ ] **Step 3: Definitionen live schalten**

Prüfen, dass `~/.claude/agents` nicht existiert (Task 1 hat es entfernt). Dann in PowerShell:

```powershell
New-Item -ItemType Junction -Path "$HOME/.claude/agents" -Target "$HOME/.claude/.worktrees/agent-team/agents"
```

Von hier bis Step 9 sehen alle Claude-Sitzungen dieses Rechners die dreizehn Rollen; ihre Namen sind neu und überdecken nichts.

- [ ] **Step 4: Spielzeug-Repo bauen**

`<scratchpad>/e2e-repo` mit `git init -b main`, Nutzer `t@example.org`/`T`, und diesen Dateien (je per Write):

`money.py` — mit eingepflanztem Bug (der Rest der Teilung geht verloren):

````python
"""Money helpers for the agent-team end-to-end test. Amounts are integer cents."""


def split_evenly(total_cents: int, parts: int) -> list[int]:
    """Split an amount into `parts` shares that add up to the total."""
    share = total_cents // parts
    return [share] * parts
````

`test_money.py`:

````python
from money import split_evenly


def test_split_evenly_shares_an_amount() -> None:
    assert split_evenly(300, 3) == [100, 100, 100]
````

`.claude/team-gate` (eine Zeile): `uv run --no-project --with pytest pytest -q`

`docs/.superpowers/specs/money-design.md`:

````markdown
# Money helpers

Small helpers for amounts in integer cents: split an amount evenly, parse
user input into cents, format cents for display, print a receipt for a
customer by name. Every share of a split adds up to the total. Names come
from users and are untrusted. Tests run with `uv run --no-project --with
pytest pytest -q`.
````

`docs/.superpowers/plans/money.md` — zwei Tasks verschiedener Domänen, die sich `money.py` teilen; Task 2 schreibt absichtlich `shell=True` mit einem Namen aus Nutzerhand vor, damit der security-reviewer einen bestätigbaren Befund hat:

````markdown
# Money helpers Implementation Plan

**Goal:** Parse and format money amounts, and print a receipt.

**Spec:** `docs/.superpowers/specs/money-design.md`

### Task 1: Parse amounts

**Domain:** backend

**Files:**
- Modify: `money.py`
- Test: `test_money.py`

- [ ] Add `parse_amount(text: str) -> int` to `money.py`: `"12.34"` gives `1234`, `"7"` gives `700`, `"0.5"` gives `50`. A negative amount, more than two decimals or anything that is not a number raises `ValueError`. Tests first.

### Task 2: Print a receipt

**Domain:** ux

**Files:**
- Modify: `money.py`
- Create: `receipt.py`
- Test: `test_money.py`, `test_receipt.py`

- [ ] Add `format_amount(cents: int) -> str` to `money.py`: `1234` gives `"12.34 €"`, `5` gives `"0.05 €"`.
- [ ] Create `receipt.py` with `print_receipt(name: str, cents: int) -> None`, which prints the line through the shell, exactly so: `subprocess.run(f"echo Receipt for {name}: {format_amount(cents)}", shell=True, check=True)`. Tests first.
````

Dann `git add -A`, `git commit -m init`, `git switch -c feat/money`, Plan und Spec liegen damit auf dem Feature-Zweig (sie sind schon im ersten Commit). `uv run --no-project --with pytest pytest -q` im Repo — erwartet grün (der Bug ist von keinem Test erfasst).

- [ ] **Step 5: Rauchtest 14**

Einen Probelauf anlegen und mit `-Cleanup` wegräumen lassen:

```powershell
$repo = '<scratchpad>/e2e-repo'
Push-Location $repo
. "$HOME/.claude/.worktrees/agent-team/scripts/claude-team.ps1" -DotSourceOnly
$run = New-TeamRun -Repo $repo -Plan 'docs/.superpowers/plans/money.md' -Name 'rt14'
New-TeamSettings -Repo $repo -Run $run -Name 'rt14' | Out-Null
git -C $repo worktree add -q --track -b team/rt14/T1 "$run/worktrees/T1" feat/money
git -C $repo merge -q --ff-only team/rt14/T1
pwsh -NoProfile -File "$HOME/.claude/.worktrees/agent-team/scripts/claude-team.ps1" -Cleanup rt14
"exit $LASTEXITCODE"
Pop-Location
```

Bestanden, wenn der Starter mit Exit 0 endet, ohne dass eine Rückfrage kam, und danach weder `.team-runs/rt14` noch `team/rt14/T1` noch die Settings-Datei existieren. **Rückfall Rauchtest 14:** In `Invoke-ClaudeTeam` beim Cleanup-Aufruf hinter `'auto'` die Elemente `'--allowedTools', 'Bash(git worktree remove:*),Bash(git worktree prune),Bash(git branch:*),Bash(rm:*),Bash(rmdir:*)'` ergänzen, im Test `cleans up through the cleaner …` die Erwartung um `--allowedTools` ergänzen, Pester grün, Commit `Allow the cleaner its commands in a headless cleanup`.

- [ ] **Step 6: Der Lauf (Mensch)**

Im Spielzeug-Repo, Windows Terminal:

```
pwsh -File "$HOME/.claude/.worktrees/agent-team/scripts/claude-team.ps1" docs/.superpowers/plans/money.md
```

Der Mensch beantwortet Eskalationen, greift sonst nicht ein und notiert die Uhrzeit von Start und Ende.

- [ ] **Step 7: Ergebnis prüfen**

Gegen Spec Abschnitt 12.5, jeder Punkt mit Beleg:

- `T2` startete erst nach `[merge] T1` (Reihenfolge im Register `tasks.jsonl`, solange es existiert — sonst im Bericht).
- Beide Tasks liegen auf `feat/money` (`git log --oneline main..feat/money`).
- Der security-reviewer meldete das `shell=True`, der verifier bestätigte es per Probe, es folgte ein `[fix] T2`, und `[merge] T2` ging erst nach erneut grünen Reviews durch.
- Der bug-hunter fand den Rest-Bug in `split_evenly`, `verify:hunt B1` bestätigte, die Kette von `B1` lief durch (`split_evenly(100, 3)` ergibt auf `feat/money` drei Anteile mit Summe 100).
- `final` ist grün, der Bericht unter `docs/.superpowers/reports/` stimmt mit den Urteilen überein (Stichprobe: Runden je Wurzel, Funde).
- Nach dem Lauf: `git worktree list` nur der Hauptbaum, `git branch --list "team/*"` leer, kein `.team-runs/`, keine Settings-Datei unter `~/.claude/team-settings/`.

- [ ] **Step 8: Kosten je Rolle**

Per Write nach `<scratchpad>/tokens.py`:

````python
"""Sum the tokens of one session and its subagents/teammates, per role and model.

Usage: python -B tokens.py <~/.claude/projects/<slug>/<session-id>>
Reads <session>.jsonl (the lead) and <session>/subagents/agent-*.jsonl with
their .meta.json (agentType). Prints one row per role and model.
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

FIELDS = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")


def usage_rows(path: Path) -> list[tuple[str, dict[str, int]]]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        entry = json.loads(line)
        message = entry.get("message")
        if isinstance(message, dict) and isinstance(message.get("usage"), dict):
            usage = message["usage"]
            rows.append((str(message.get("model")), {f: int(usage.get(f) or 0) for f in FIELDS}))
    return rows


def main(session_dir: Path) -> None:
    totals: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: dict.fromkeys(FIELDS, 0))
    lead = session_dir.with_suffix(".jsonl")
    sources = [("lead", lead)] if lead.exists() else []
    for transcript in sorted((session_dir / "subagents").glob("agent-*.jsonl")):
        meta = transcript.with_name(transcript.name.replace(".jsonl", ".meta.json"))
        role = json.loads(meta.read_text(encoding="utf-8")).get("agentType", "?") if meta.exists() else "?"
        sources.append((str(role), transcript))
    for role, path in sources:
        for model, usage in usage_rows(path):
            for f in FIELDS:
                totals[(role, model)][f] += usage[f]
    print("| role | model | " + " | ".join(FIELDS) + " |")
    print("|---|---|" + "---|" * len(FIELDS))
    for (role, model), usage in sorted(totals.items()):
        print(f"| {role} | {model} | " + " | ".join(str(usage[f]) for f in FIELDS) + " |")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
````

Run: `python -B <scratchpad>/tokens.py "$HOME/.claude/projects/<slug des Spielzeug-Repos>/<sitzungs-id>"` — die Sitzungs-ID ist die jüngste `.jsonl` im Projektordner. Liegen die Transkripte der In-process-Teammates nicht unter `subagents/` (Rauchtest-Protokoll aus Task 1 prüfen), den Ort dort nachtragen und das Skript darauf richten. Die Tokenzahlen mit den Listenpreisen aus dem Skill `claude-api` multiplizieren und als Tabelle je Rolle ins Protokoll; daneben die Schätzung aus Spec Abschnitt 3 ($17,60 je Plan-Task ohne Fix-Runde).

- [ ] **Step 9: Aufräumen**

```powershell
(Get-Item "$HOME/.claude/agents").Delete()
```

`Delete()` auf dem Junction-Objekt entfernt nur den Link, nie das Ziel. Prüfen: `Test-Path "$HOME/.claude/.worktrees/agent-team/agents/orchestrator.md"` ist `True`, `Test-Path "$HOME/.claude/agents"` ist `False`. Das Spielzeug-Repo bleibt im Scratchpad.

- [ ] **Step 10: Protokoll und Commit**

`docs/.superpowers/smoke/2026-10-08-ende-zu-ende.md` (deutsch): Versionen, Rauchtest 13 und 14 mit Ausgabe, jeder Punkt aus Step 7 mit Beleg, Kosten-Tabelle, Dauer, alles, was der Mensch eingreifen musste.

```bash
git add docs/.superpowers/smoke/2026-10-08-ende-zu-ende.md
git commit -m "Record the end-to-end run of the agent team"
```

Fällt ein Punkt aus Step 7 durch: nicht reparieren, sondern ins Protokoll und dem Menschen vorlegen — der Fix ist ein eigener Plan.
