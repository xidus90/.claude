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
