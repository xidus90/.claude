# Geparkte Wurzeln Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Wurzel, die der Mensch per `AskUserQuestion` aufgibt, wird geparkt und hält `[final]` nicht mehr auf.

**Architecture:** Ein neues Hook-Ereignis `post-ask-user` (`PostToolUse` auf `AskUserQuestion`) liest die Antwort des Menschen aus `tool_response.answers`. Bei `Park <wurzel>` schreibt es ein Register-Ereignis `parked` und schließt die offenen Tasks der Wurzel. `TaskCreated` verweigert Tasks geparkter Wurzeln, `check_final` lässt sie aus, `status.md` zeigt `parked`. Der Starter verdrahtet den Hook; Orchestrator, Verifier und Urteilsregeln lernen das Format.

**Tech Stack:** Python 3.13 über `uv` (PEP 723, keine Abhängigkeiten), pytest, mypy strict; PowerShell 7 mit Pester 6.

**Spec:** `docs/.superpowers/specs/2026-10-09-parked-roots-design.md`, Nachtrag zu `docs/.superpowers/specs/2026-10-08-agent-team-design.md` („Hauptspec“).

## Global Constraints

- Python nur über `uv`, nie `pip`. `scripts/team-gate.py` behält seinen PEP-723-Kopf, `requires-python = ">=3.13"`, keine Abhängigkeiten.
- 100 % Zweig-Coverage für `scripts/team-gate.py`, `scripts/teamgate_tasks.py`, `scripts/teamgate_cmd.py`; ein Ausschluss nur als `# pragma: no cover - <grund>`. `mypy --strict` über Code und Tests, kein `Any`, kein `type: ignore`.
- Testbefehl (Repo-Wurzel): `uv run --no-project --python 3.13 --with pytest --with pytest-cov --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate -q -p no:cacheprovider -n 8 --cov=scripts --cov-branch --cov-report=term-missing --cov-fail-under=100`
- Typprüfung: `MYPYPATH="scripts;scripts/tests/teamgate" uvx --python 3.13 --with pytest --with types-PyYAML mypy --strict --explicit-package-bases scripts/team-gate.py scripts/teamgate_tasks.py scripts/teamgate_cmd.py scripts/tests/teamgate`
- Pester: `pwsh -NoProfile -c 'Invoke-Pester -Path scripts/tests -Output Detailed'`. Schon rot vor diesem Plan (nicht anfassen, keine neuen roten): `tracked content.tracks nothing outside the permitted set`, `global CLAUDE.md.requires specs and plans to live in the project repo`, `statusline rendering.line 1.shows the project folder`, `statusline rendering.line 2.shows the Claude Code version from the cached file`, `statusline rendering.cost.renders in under 250 ms`, `statusline rendering.line 2.shows the peak usage marker` (uhrzeitabhängig, eigene Aufgabe).
- Code, Code-Kommentare, Bezeichner, Meldungen und Commits englisch; Plan, Spec und Protokolle deutsch.
- Commits per Nachrichtendatei und `git commit -F`; nie `Co-Authored-By:`; vor jedem Commit Zweig und Index in eigenen Aufrufen prüfen.
- Optionsformat exakt `Park <wurzel>` (Spec 4.1); parkbar sind nur `T<n>` und `B<n>`, nie `F` (Spec 3.2).

## Rauchtest 15 (gemessen beim Planen, Claude Code 2.1.295)

- Die Nutzlast von `PostToolUse` auf `AskUserQuestion` trägt `tool_response = {"questions": [...], "answers": {"<fragetext>": "<antworttext>"}, "annotations": {}}`; `tool_input` trägt dieselben `answers`.
- Ein Aufruf, dessen `tool_input` schon `answers` vorgab (`Park B9`), wurde dem Menschen trotzdem gestellt; Nutzlast und Ergebnis trugen seine Antwort (`Keep going`). Ein Agent kann die Antwort also nicht vorgeben.
- Ob eine über „Other“ getippte Antwort als bloßer Text in `answers` steht, ist nicht gemessen (die zweite Probe kam als gewählte Option `Park T1` an). Der Hook behandelt jede Antwort als Text; eine getippte `Park B3` parkt also genauso.
- Kein Rückfall nötig. Rohdaten: Scratchpad der Planungssitzung, `rt15/payloads.jsonl`; Task 4 hält sie im Protokoll fest.

## Geprobt beim Planen

Prototyp in einer Kopie von `scripts/` (Scratchpad `proto/`, Stand `6338bb8`), Python 3.13, Pester 6.1.0:
- Die Tests aus Task 1 und 2 gegen den heutigen Code: 12 failed (Attribut fehlt, Register-Fehlertext, Exit 2), wie in den RED-Schritten beschrieben.
- Mit dem Code aus Task 1 und 2: 540 passed, `teamgate_tasks.py` und `team-gate.py` je 100 % Zweige, mypy `Success: no issues found in 8 source files` (`test_agents.py` in der Kopie abgewählt, weil ihr `agents/` fehlt).
- Task 3: `ClaudeTeam.Tests.ps1` 34 passed, 0 failed.

## Review Focus

1. **Mehrfachauswahl oder Zusatztext**: `Park B3, Keep going` oder `Park B3 now` darf nicht still parken oder still ignoriert werden — der Hook meldet es (Test in Task 1).
2. **Kleinschreibung oder Tippfehler** (`park B3`, `Parking`): parkt nicht und meldet nichts; der Orchestrator kennt das exakte Format aus seinem Rumpf (Test in Task 1, Rumpf in Task 4).
3. **Zweimal parken in einer Antwort oder nacheinander**: das zweite Mal wird gemeldet, nicht doppelt geschrieben (Test in Task 1).
4. **Ein `[final]`, das vor dem Parken schon abgelehnt wurde**, geht nach dem Parken beim erneuten Abschließen desselben Tasks durch (Test in Task 2).
5. **Eine geparkte Wurzel in `status.md`** behält ihre Rundenzahl und zeigt `parked` statt `fix round k` (Test in Task 2).

---

### Task 1: Register-Ereignis `parked` und der Hook `post-ask-user`

**Files:**
- Modify: `scripts/teamgate_tasks.py` (`tasks()`, neue `parked()`, neue `on_post_ask_user()`)
- Modify: `scripts/team-gate.py` (Ereignis `post-ask-user`, `USAGE`)
- Test: `scripts/tests/teamgate/test_tasks.py` (Abschnitt `# --- parking ---` vor `# --- status.md ---` anhängen), `scripts/tests/teamgate/test_entry.py`

**Interfaces:**
- Consumes: `Run`, `GateError`, `locked`, `read_register`, `append_event`, `tasks`, `write_status` aus `teamgate_tasks.py`.
- Produces: `teamgate_tasks.parked(events: list[JsonObj]) -> dict[str, str]` (Wurzel → gespeicherte Frage); `teamgate_tasks.on_post_ask_user(run: Run, payload: Mapping[str, object]) -> list[str]`; Kommandozeile `uv run --script scripts/team-gate.py --run <lauf> post-ask-user` (Nutzlast auf stdin). Register-Ereignis `{"event": "parked", "gen": <int>, "root": "<T|B><n>", "question": "<text>"}`.

- [ ] **Step 1: Tests schreiben**

In `scripts/tests/teamgate/test_tasks.py` direkt vor der Zeile `# --- status.md -----…` einfügen (die Hilfen `merged`, `verify`, `finding` und `shutil` stehen schon in der Datei):

```python
# --- parking ---------------------------------------------------------------


def ask(w: World, *answers: tuple[str, str]) -> list[str]:
    """A PostToolUse payload of AskUserQuestion as Claude Code 2.1.295 sends it (smoke test 15)."""
    questions = [{"question": q, "header": "Root", "options": [{"label": a, "description": a}], "multiSelect": False}
                 for q, a in answers]
    response = {"questions": questions, "answers": dict(answers), "annotations": {}}
    return tg.on_post_ask_user(w.run, {"tool_name": "AskUserQuestion", "tool_input": response, "tool_response": response})


def test_a_park_answer_parks_the_root_and_closes_its_open_tasks(world: World) -> None:
    wt = world.worktree("B3")
    world.created("x1", "[fix:backend] B3 Repair")
    world.commit(wt, "b3.txt")
    assert world.completed("x1", "[fix:backend] B3 Repair") == []  # done: must not be superseded
    world.created("m", "[merge] B3")
    world.created("h", "[hunt] R1.P1 All")
    assert ask(world, ("B3 is stuck after three rounds. Park it?", "Park B3")) == []
    register = world.register()
    assert register[-2:] == [
        {"event": "parked", "gen": 1, "root": "B3", "question": "B3 is stuck after three rounds. Park it?"},
        {"event": "superseded", "gen": 1, "task_id": "m"},
    ]
    assert tg.parked(register) == {"B3": "B3 is stuck after three rounds. Park it?"}
    by_key, _ = tg.tasks(register)
    assert by_key[(1, "h")].open  # another root's task stays open


@pytest.mark.parametrize("answer", ["Keep going", "park B3", "Parking B3"])
def test_other_answers_park_nothing(world: World, answer: str) -> None:
    world.worktree("B3")
    world.created("x1", "[fix:backend] B3 Repair")
    assert ask(world, ("What now?", answer)) == []
    assert [e["event"] for e in world.register()] == ["created"]


def test_a_park_answer_that_names_no_parkable_root_is_reported(world: World) -> None:
    merged(world, "T1")
    world.worktree("B3")
    world.created("x1", "[fix:backend] B3 Repair")
    before = world.register()
    assert ask(world, ("z?", "Park B9")) == ["cannot park B9: no task of it in the register"]
    assert world.register() == before  # nothing to write when every pick is refused
    assert ask(world, ("a?", "Park F"), ("b?", "Park B3, Keep going"), ("c?", "Park B9"), ("d?", "Park T1"),
               ("e?", "Park B3"), ("f?", "Park B3")) == [
        "cannot park 'F': only T<n> and B<n> roots can be parked",
        "cannot park 'B3, Keep going': only T<n> and B<n> roots can be parked",
        "cannot park B9: no task of it in the register",
        "cannot park T1: it is merged",
        "cannot park B3: it is already parked",
    ]
    assert [e["root"] for e in world.register() if e["event"] == "parked"] == ["B3"]


def test_a_payload_without_answers_is_reported(world: World) -> None:
    for payload in ({}, {"tool_response": "x"}, {"tool_response": {"answers": ["Park B3"]}}):
        assert tg.on_post_ask_user(world.run, payload) == ["AskUserQuestion payload carries no answers"]
    assert tg.on_post_ask_user(world.run, {"tool_response": {"answers": {"q": 3}}}) == []


def test_without_a_run_folder_parking_does_nothing(world: World) -> None:
    shutil.rmtree(world.run.dir)
    assert tg.on_post_ask_user(world.run, {}) == []


def test_a_register_that_parks_a_root_without_tasks_is_broken() -> None:
    with pytest.raises(GateError, match="register parks a root without tasks: 'B3'"):
        tg.tasks([{"event": "parked", "gen": 1, "root": "B3", "question": "q"}])
```

In `scripts/tests/teamgate/test_entry.py` nach `test_post_task_update_is_dispatched` einfügen:

```python
def test_post_ask_user_is_dispatched(world: World, capsys: pytest.CaptureFixture[str]) -> None:
    assert call(world, "post-ask-user", {"tool_response": {"answers": {"q": "Keep going"}}}) == 0
    assert call(world, "post-ask-user", {}) == 2
    assert "carries no answers" in capsys.readouterr().err
```

- [ ] **Step 2: RED zeigen**

Run: `uv run --no-project --python 3.13 --with pytest --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate/test_tasks.py scripts/tests/teamgate/test_entry.py -q -p no:cacheprovider -k "park or ask_user or without_answers" > <sdd>/p1-red.txt 2>&1`
Expected: alle neuen Tests FAIL mit `AttributeError: module 'teamgate_tasks' has no attribute 'on_post_ask_user'` bzw. `'parked'`, der Register-Test mit `GateError: register event without gen/task_id`, der Einstiegstest mit Exit 2 statt 0 (`usage:` auf stderr). Ein reiner Importfehler der Testdatei zählt nicht als RED.

- [ ] **Step 3: `tasks()` und `parked()`**

In `scripts/teamgate_tasks.py` die Schleife von `tasks()` ersetzen. Alt:

```python
    for e in events:
        gen, tid = e.get("gen"), e.get("task_id")
        if not isinstance(gen, int) or not isinstance(tid, str):
            raise GateError(f"register event without gen/task_id: {e}")
        kind = e.get("event")
        if kind == "created":
```

Neu:

```python
    for e in events:
        kind = e.get("event")
        if kind == "parked":
            # Parking names a root, not a task; the root must have shown up before.
            if not any(t.title.root == e.get("root") for t in by_key.values()):
                raise GateError(f"register parks a root without tasks: {e.get('root')!r}")
            continue
        gen, tid = e.get("gen"), e.get("task_id")
        if not isinstance(gen, int) or not isinstance(tid, str):
            raise GateError(f"register event without gen/task_id: {e}")
        if kind == "created":
```

Direkt nach `tasks()` einfügen:

```python
def parked(events: list[JsonObj]) -> dict[str, str]:
    """Parked roots and the question the human answered with `Park <root>` (parked-roots spec 4.3)."""
    return {str(e.get("root")): str(e.get("question", "")) for e in events if e.get("event") == "parked"}
```

- [ ] **Step 4: `on_post_ask_user()`**

In `scripts/teamgate_tasks.py` nach `on_post_task_update()` einfügen:

```python
PARK_ANSWER = "Park "
PARKABLE = re.compile(r"^(T[1-9][0-9]*|B[1-9][0-9]*)$")


def on_post_ask_user(run: Run, payload: Payload) -> list[str]:
    """PostToolUse on AskUserQuestion: the human's answer `Park <root>` parks that root (parked-roots spec 4.2).

    The answers come from tool_response, which the harness fills with what the human chose; a
    caller cannot preset them (smoke test 15)."""
    if not run.exists():
        return []
    response = payload.get("tool_response")
    answers = response.get("answers") if isinstance(response, dict) else None
    if not isinstance(answers, dict):
        return ["AskUserQuestion payload carries no answers"]
    picks = [(q, a) for q, a in answers.items() if isinstance(q, str) and isinstance(a, str) and a.startswith(PARK_ANSWER)]
    if not picks:
        return []
    errors: list[str] = []
    with locked(run):
        events = read_register(run)
        by_key, done = tasks(events)
        held = set(parked(events))
        new: list[JsonObj] = []
        for question, answer in picks:
            root = answer[len(PARK_ANSWER):]
            if not PARKABLE.match(root):
                errors.append(f"cannot park {root!r}: only T<n> and B<n> roots can be parked")
            elif not any(t.title.root == root for t in by_key.values()):
                errors.append(f"cannot park {root}: no task of it in the register")
            elif any(t.title.kind == "merge" and t.title.root == root for t in done):
                errors.append(f"cannot park {root}: it is merged")
            elif root in held:
                errors.append(f"cannot park {root}: it is already parked")
            else:
                held.add(root)
                new.append({"event": "parked", "gen": run.gen, "root": root, "question": question})
                new += [{"event": "superseded", "gen": t.gen, "task_id": t.task_id}
                        for t in by_key.values() if t.title.root == root and t.open]
        for e in new:
            append_event(run, e)
        if new:
            write_status(run, [*events, *new])
    return errors
```

- [ ] **Step 5: Einstieg**

In `scripts/team-gate.py`: Docstring-Zeile 7 ändern zu
`Events: task-created, task-completed, post-task-update, post-ask-user, pre-tool-use read the`;
`USAGE` ändern zu
`USAGE = "usage: team-gate.py --run <run-dir> (task-created|task-completed|post-task-update|post-ask-user|pre-tool-use|supersede <gen>:<task_id>...)"`;
in `dispatch()` nach dem Zweig für `post-task-update` einfügen:

```python
    if event == "post-ask-user":
        return teamgate_tasks.on_post_ask_user(run, payload)
```

- [ ] **Step 6: GREEN und Typen**

Run: den Testbefehl aus Global Constraints `> <sdd>/p1-green.txt 2>&1`
Expected: alle grün, `Required test coverage of 100% reached`.
Run: die Typprüfung aus Global Constraints `> <sdd>/p1-mypy.txt 2>&1`
Expected: `Success: no issues found`.

- [ ] **Step 7: Mutanten**

`<sdd>/mutants-parked-1.json` mit je einer Mutation, die eine Teilbedingung entfernt, über die ganze Suite im Vordergrund; jede muss getötet werden:
1. `if kind == "parked":` → `if False:` (Register-Test)
2. `if not PARKABLE.match(root):` → `if False:` (Meldung für `F`)
3. `elif not any(t.title.root == root …)` → `elif False:` (Meldung für `B9`)
4. `elif any(t.title.kind == "merge" …)` → `elif False:` (Meldung für `T1`)
5. `elif root in held:` → `elif False:` (Meldung „already parked“)
6. `held.add(root)` → `pass` (Meldung „already parked“ für `f?`)
7. `and t.open]` → `]` (supersedet auch das erledigte `x1`; stirbt an `register[-2:]`)
8. `and a.startswith(PARK_ANSWER)` → `` (alle Antworten; `test_other_answers_park_nothing` mit `Keep going`)
Danach `check_clean.py` → `clean`, und per grep kein Mutant im Baum.

- [ ] **Step 8: Commit**

```bash
git add scripts/teamgate_tasks.py scripts/team-gate.py scripts/tests/teamgate/test_tasks.py scripts/tests/teamgate/test_entry.py
git commit -F <msgfile>   # subject: Park a root when the human answers Park <root>
```

### Task 2: Was die Tore mit geparkten Wurzeln tun

**Files:**
- Modify: `scripts/teamgate_tasks.py` (`on_created`, `on_completed`, `_completion_errors`, `check_final`, `write_status`)
- Test: `scripts/tests/teamgate/test_tasks.py` (Abschnitt `# --- parking ---`)

**Interfaces:**
- Consumes: `parked()`, `on_post_ask_user()` und die Testhilfe `ask()` aus Task 1.
- Produces: `check_final(run, final, by_key, done, parked_roots: Collection[str] = ())`; `_completion_errors(..., parked_roots: Collection[str] = ())`; Meldung `root <r> is parked`; Zustand `parked` in `status.md`.

- [ ] **Step 1: Tests schreiben**

Im Abschnitt `# --- parking ---` anhängen:

```python
def test_a_parked_root_gets_no_new_tasks(world: World) -> None:
    world.worktree("B3")
    world.created("x1", "[fix:backend] B3 Repair")
    ask(world, ("Park?", "Park B3"))
    assert world.created("m2", "[merge] B3") == ["root B3 is parked"]
    assert world.created("h", "[hunt] R1.P1 All") == []


def test_final_passes_once_the_failing_root_is_parked(world: World) -> None:
    merged(world, "T1")
    wt = world.worktree("B3")
    world.created("x1", "[fix:backend] B3 Repair")
    head = world.commit(wt, "b3.txt")
    assert world.completed("x1", "[fix:backend] B3 Repair") == []
    world.created("vf", "[verify:fix] B3")
    log = world.gate_log("B3", head, 1)
    red = finding("B3-ver-F1", "claim", "refuted", evidence={"command": "gate", "output_file": log})
    verify(world, "vf", "[verify:fix] B3", head, "fail", [red])
    assert world.completed("vf", "[verify:fix] B3") == []
    world.created("f", "[final]")
    assert world.completed("f", "[final]") == ["root B3 has no completed [merge]", "the latest verify verdict of root B3 is fail"]
    assert ask(world, ("B3 failed its gate. Park it?", "Park B3")) == []
    assert world.completed("f", "[final]") == []  # the same [final] task, completed again


def test_status_shows_a_parked_root(world: World) -> None:
    world.worktree("B3")
    world.created("x1", "[fix:backend] B3 Repair")
    ask(world, ("Park?", "Park B3"))
    assert "| B3 | parked | 1 | — |" in (world.run.dir / "status.md").read_text(encoding="utf-8")
```

- [ ] **Step 2: RED zeigen**

Run: `uv run --no-project --python 3.13 --with pytest --with pytest-xdist --with pyyaml pytest scripts/tests/teamgate/test_tasks.py -q -p no:cacheprovider -k "parked_root_gets or failing_root_is_parked or shows_a_parked" > <sdd>/p2-red.txt 2>&1`
Expected: 3 failed — `[merge] B3` wird angelegt (`[] != ['root B3 is parked']`), das zweite `[final]` meldet weiter die zwei Fehler, `status.md` zeigt `fix round 1` bzw. `open` statt `parked`.

- [ ] **Step 3: `TaskCreated` verweigert**

In `on_created()` nach `by_key, done = tasks(events)` einfügen:

```python
        if title.root and title.root in parked(events):
            return [f"root {title.root} is parked"]
```

- [ ] **Step 4: `final` lässt geparkte Wurzeln aus**

In `teamgate_tasks.py` die Zeile `from collections.abc import Iterator, Mapping` ersetzen durch `from collections.abc import Collection, Iterator, Mapping`.

In `on_completed()` die Zeile
`errors = _completion_errors(run, task.title, task, payload, by_key, done)`
ersetzen durch
`errors = _completion_errors(run, task.title, task, payload, by_key, done, set(parked(events)))`.

`_completion_errors` bekommt den Parameter `parked_roots: Collection[str] = ()` als letzten und gibt ihn in der letzten Zeile weiter:
`return check_final(run, task, by_key, done, parked_roots)`.

`check_final` bekommt denselben Parameter als letzten; in der Schleife über die Wurzeln als erste Zeile:

```python
    for root in roots(by_key):
        if root in parked_roots:
            continue  # parked by the human: not merged on purpose (parked-roots spec 4.4)
```

- [ ] **Step 5: `status.md`**

In `write_status()` nach `by_key, done = tasks(events)` einfügen `held = parked(events)` und in der Zeile, die die Wurzelzeile anhängt,
`{_state(root, by_key, done, rounds, run)}` ersetzen durch
`{'parked' if root in held else _state(root, by_key, done, rounds, run)}`.

- [ ] **Step 6: GREEN und Typen**

Run: Testbefehl und Typprüfung aus Global Constraints, `> <sdd>/p2-green.txt` und `> <sdd>/p2-mypy.txt`.
Expected: grün bei 100 %, `Success: no issues found`.

- [ ] **Step 7: Mutanten**

`<sdd>/mutants-parked-2.json`, ganze Suite, Vordergrund; jede getötet:
1. `if title.root and title.root in parked(events):` → `if False:`
2. `if root in parked_roots:` → `if False:`
3. `set(parked(events))` im Aufruf von `_completion_errors` → `set()`
4. `'parked' if root in held else _state(...)` → `_state(...)`
Danach `check_clean.py` → `clean`.

- [ ] **Step 8: Commit**

```bash
git add scripts/teamgate_tasks.py scripts/tests/teamgate/test_tasks.py
git commit -F <msgfile>   # subject: Let a parked root pass final and refuse its new tasks
```

### Task 3: Der Starter verdrahtet den Hook

**Files:**
- Modify: `scripts/claude-team.ps1` (`New-TeamSettings`, Eintrag `PostToolUse`)
- Test: `scripts/tests/ClaudeTeam.Tests.ps1` (`It 'wires every hook …'`)

**Interfaces:**
- Consumes: das Ereignis `post-ask-user` aus Task 1.
- Produces: Settings-Datei mit `hooks.PostToolUse[1] = { matcher: "AskUserQuestion", hooks: [ { type, command: "uv run --script \"…/team-gate.py\" --run \"…\" post-ask-user", timeout: 30 } ] }`.

- [ ] **Step 1: Test erweitern**

In `scripts/tests/ClaudeTeam.Tests.ps1` im `It 'wires every hook to team-gate with the run and a 30 s timeout'` vor der schließenden `}` anhängen:

```powershell
        $ask = $Settings.hooks.PostToolUse[1]
        $ask.matcher | Should -Be 'AskUserQuestion'
        $ask.hooks[0].timeout | Should -Be 30
        $ask.hooks[0].command | Should -Match '^uv run --script ".*/team-gate\.py" --run ".*/\.team-runs/r1" post-ask-user$'
```

- [ ] **Step 2: RED zeigen**

Run: `pwsh -NoProfile -c 'Invoke-Pester -Path scripts/tests/ClaudeTeam.Tests.ps1 -Output Detailed' > <sdd>/p3-red.txt 2>&1`
Expected: genau `wires every hook to team-gate with the run and a 30 s timeout` rot (`$ask` ist `$null`, Matcher erwartet `AskUserQuestion`).

- [ ] **Step 3: Hook eintragen**

In `scripts/claude-team.ps1` die Zeile
`PostToolUse   = @(@{ matcher = 'TaskUpdate'; hooks = @(hook 'post-task-update') })`
ersetzen durch

```powershell
            PostToolUse   = @(
                @{ matcher = 'TaskUpdate'; hooks = @(hook 'post-task-update') }
                @{ matcher = 'AskUserQuestion'; hooks = @(hook 'post-ask-user') }
            )
```

- [ ] **Step 4: GREEN**

Run: `pwsh -NoProfile -c 'Invoke-Pester -Path scripts/tests/ClaudeTeam.Tests.ps1 -Output Detailed' > <sdd>/p3-green.txt 2>&1` und die volle Pester-Suite `> <sdd>/p3-pester.txt 2>&1`.
Expected: ClaudeTeam ganz grün; in der vollen Suite nur die in Global Constraints genannten roten Tests.

- [ ] **Step 5: Gegenprobe**

Matcher `'AskUserQuestion'` → `'AskUser'`: der Test wird rot; zurück per Edit.

- [ ] **Step 6: Commit**

```bash
git add scripts/claude-team.ps1 scripts/tests/ClaudeTeam.Tests.ps1
git commit -F <msgfile>   # subject: Wire the park hook into the run settings
```

### Task 4: Rollen, Urteilsregeln, Hauptspec und Protokoll

**Files:**
- Modify: `agents/orchestrator.md`, `agents/verifier.md`, `docs/agent-team/verdicts.md`, `docs/.superpowers/specs/2026-10-08-agent-team-design.md`
- Create: `docs/.superpowers/smoke/2026-10-09-rauchtest-15.md`
- Test: `scripts/tests/teamgate/test_agents.py` (nur laufen lassen; die Definitionen ändern Rumpf, nicht Kopf)

**Interfaces:**
- Consumes: Optionsformat `Park <wurzel>`, Meldung `root <r> is parked`, Zustand `parked` aus Task 1–2.
- Produces: Rümpfe und Spec, die genau das beschreiben, was die Hooks tun.

- [ ] **Step 1: `agents/orchestrator.md`**

Die zwei Zeilen
```
   - A round is every `[impl]` and every `[fix]` without `:conflict`. Before a
     fourth round of the same root, ask the human with AskUserQuestion.
```
ersetzen durch
```
   - A round is every `[impl]` and every `[fix]` without `:conflict`. Before a
     fourth round of the same root, ask the human with AskUserQuestion and
     offer an option labelled exactly `Park W` (e.g. `Park B3`). If the human
     picks it, the hook parks W: its open tasks close, no new task of W is
     accepted, its branch stays unmerged and does not hold `[final]`.
   - A root whose `[merge]` waits on a parked root: ask the human about that
     root with its own `Park <root>` option; nothing is parked along with
     another root. `F` cannot be parked.
```

Im Schritt **6. Final** nach dem Satz, der mit „findings, bugs, costs if known, anything left open)“ endet, einfügen:
```
   The report has a section `## Parked roots`: one line per parked root
   (`status.md` shows them) with the question the human answered and its
   unmerged branch `team/<run>/<root>`. If the hook refuses `[final]` because
   of a root, ask the human with a `Park <root>` option before anything else.
```

Unter `## Never` die Zeile
`- Never write to `tasks.jsonl` by hand; only through `team-gate.py supersede`.`
ersetzen durch
`- Never write to `tasks.jsonl` by hand; only through `team-gate.py supersede` and the human's `Park <root>` answer.`

- [ ] **Step 2: `agents/verifier.md`**

Die Zeilen
```
- `[verify:final] F`: the report and the plan checkboxes against the register,
  the verdicts and the feature branch; run the gate on the feature branch.
```
ersetzen durch
```
- `[verify:final] F`: the report and the plan checkboxes against the register,
  the verdicts and the feature branch; run the gate on the feature branch.
  Every root with a `parked` event in `tasks.jsonl` must appear in the report's
  `## Parked roots` with its question and branch; a parked root missing there,
  or a root listed there without the event, is a confirmed defect.
```

- [ ] **Step 3: `docs/agent-team/verdicts.md`**

Am Ende des Abschnitts `## Rules` anhängen:
```
- A parked root (an event `{"event": "parked", "root": …, "question": …}` in
  `tasks.jsonl`) has no `[merge]` and needs none. Its open tasks were closed
  when it was parked; the hook refuses new ones. `[verify:final]` checks that
  the report lists every parked root under `## Parked roots`.
```

- [ ] **Step 4: Hauptspec**

In `docs/.superpowers/specs/2026-10-08-agent-team-design.md`:

1. „Runden und Grenzen“ (Abschnitt 4), nach dem Punkt zur dritten Runde:
   `- Antwortet der Mensch dabei mit der Option `Park <wurzel>`, ist die Wurzel **geparkt** (Nachtrag `2026-10-09-parked-roots-design.md`): offene Tasks geschlossen, keine neuen, ihr Zweig bleibt ungemergt und hält `final` nicht auf.`
2. „Status“ (Abschnitt 5): in der Aufzählung der Zustände `gemergt` ergänzen zu `gemergt, geparkt`.
3. „Task-Ereignisse“ (Abschnitt 6): Zeile `TaskCreated, jede` um `, oder die Wurzel geparkt ist` im Exit-2-Feld ergänzen; Zeile `TaskCompleted, final` um ` (geparkte Wurzeln ausgenommen)` nach „eine Wurzel“ ergänzen; neue Zeile nach `PostToolUse` auf `TaskUpdate`:
   `| `PostToolUse` auf `AskUserQuestion` | … die Antwort `Park <wurzel>` lautet und die Wurzel nicht parkbar ist (nicht `T<n>`/`B<n>`, unbekannt, gemergt, schon geparkt), oder die Nutzlast keine Antworten trägt | Register `parked` und `superseded` für die offenen Tasks der Wurzel |`
4. „Aufräumen“ (Abschnitt 8): Satz anhängen: `Der Zweig einer geparkten Wurzel steht in `--no-merged` und bleibt; der Bericht nennt ihn.` (Abschnitt 7 verweist für die Hooks auf Abschnitt 6 und braucht keine Änderung.)
5. „Fehlerfälle“ (Abschnitt 9): Zeile `| Dritte Runde einer Wurzel vorbei | `AskUserQuestion` an den Menschen. |` ersetzen durch `| Dritte Runde einer Wurzel vorbei | `AskUserQuestion` an den Menschen, mit der Option `Park <wurzel>`. |`
6. „Annahmen und Rauchtests“ (Abschnitt 10): Zeile 15 anhängen: `| 15 | `PostToolUse` auf `AskUserQuestion` trägt die Antwort des Menschen in `tool_response.answers`, und ein Aufrufer kann sie nicht vorgeben. Gemessen 2026-10-09 mit 2.1.295. | Parken nur durch den Menschen im eigenen Terminal (Nachtrag, Abschnitt 6). |`

Jede Stelle per Edit; vorher den Wortlaut der Zielzeile mit Grep lesen.

- [ ] **Step 5: Protokoll Rauchtest 15**

`docs/.superpowers/smoke/2026-10-09-rauchtest-15.md` mit dem Abschnitt „Rauchtest 15“ dieses Plans (Messung, Version, offene Frage zu „Other“, kein Rückfall), dazu die drei Nutzlasten gekürzt auf `tool_input.answers` und `tool_response.answers`:
`{"Probe one: which?": "Park B3"}`, `{"Probe two: type Park B7 via Other": "Park T1"}`, `{"Probe three: prefilled?": "Keep going"}` (vorgegeben war `Park B9`).

- [ ] **Step 6: Prüfen**

Run: den Testbefehl aus Global Constraints (die Rollendefinitionen laufen über `test_agents.py` mit) `> <sdd>/p4-green.txt 2>&1`.
Expected: grün bei 100 %.
Grep: `Park <` in `agents/orchestrator.md`, `agents/verifier.md`, `docs/agent-team/verdicts.md` und der Hauptspec trifft je mindestens einmal; `post-ask-user` steht in Hauptspec, `scripts/claude-team.ps1` und `scripts/team-gate.py`.

- [ ] **Step 7: Commit**

```bash
git add agents/orchestrator.md agents/verifier.md docs/agent-team/verdicts.md docs/.superpowers/specs/2026-10-08-agent-team-design.md docs/.superpowers/smoke/2026-10-09-rauchtest-15.md
git commit -F <msgfile>   # subject: Teach the roles and the spec how a root is parked
```
