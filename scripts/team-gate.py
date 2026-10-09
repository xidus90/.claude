# /// script
# requires-python = ">=3.13"
# dependencies = []
# ///
"""Hook entry of an agent-team run: `team-gate.py --run <dir> <event>`.

Events: task-created, task-completed, post-task-update, post-ask-user, pre-tool-use read the
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

USAGE = "usage: team-gate.py --run <run-dir> (task-created|task-completed|post-task-update|post-ask-user|pre-tool-use|supersede <gen>:<task_id>...)"

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
    if event == "post-ask-user":
        return teamgate_tasks.on_post_ask_user(run, payload)
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
