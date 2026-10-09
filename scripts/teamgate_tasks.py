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
        except PermissionError:
            # Windows refuses to open a file whose deletion is pending: another hook is releasing it.
            if time.monotonic() > deadline:
                raise GateError(f"register lock held for more than {wait_s} s: {lock}") from None
            time.sleep(0.05)
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
        with suppress(FileNotFoundError):  # another hook broke it as stale
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


def gate_exit(log: Path, head: str) -> int | None:
    """The exit code a gate log records for head; None when the log is missing or malformed."""
    if not log.is_file():
        return None
    lines = log.read_text(encoding="utf-8").splitlines()
    if len(lines) < 2 or lines[0].strip() != head or not re.match(r"^-?[0-9]+$", lines[1].strip()):
        return None
    return int(lines[1])


def check_gate_log(run: Run, title: Title, v: JsonObj) -> list[str]:
    root = str(title.root)
    worktree_head = head_of(run.worktree(root))
    if v.get("head") != worktree_head:
        return [f"verdict head is not the HEAD of worktree {root}"]
    log = run.dir / "evidence" / f"gate-{root}-{worktree_head}.txt"
    if not log.is_file():
        return [f"gate log missing: {log}"]
    code = gate_exit(log, worktree_head)
    if code is None:
        return ["gate log must start with the HEAD hash and the exit code"]
    if code == 0:
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
        if task.subject != subject:
            # A teammate may rename a task; the gate follows what was registered at creation.
            return [f"task subject changed since creation: {task.subject!r} -> {subject!r}"]
        errors = _completion_errors(run, task.title, task, payload, by_key, done)
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
    # A failed verify:rebase sends the root back through the reviews only, so its green gate log
    # counts; a failed verify:impl/fix confirmed a defect and does not.
    gates = judged(run, done, root, {"verify"}, {"impl", "fix", "rebase"})
    if not any(
        g.verdict.get("head") == head
        and (g.verdict.get("verdict") == "pass" or g.task.title.sub == "rebase")
        and gate_exit(run.dir / "evidence" / f"gate-{root}-{head}.txt", head) == 0
        for g in gates
    ):
        return [f"root {root} has no passing gate run for {head}"]
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
