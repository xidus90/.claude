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
