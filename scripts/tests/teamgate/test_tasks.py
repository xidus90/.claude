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


def reviewed_after_failed_rebase(w: World, code: int) -> str:
    wt, head = build(w)
    reviewed(w, "T1", head)
    w.commit(w.repo, "other.txt")
    sh(wt, "rebase", "-q", FEATURE)
    new = sh(wt, "rev-parse", "HEAD")
    w.created("vrb", "[verify:rebase] T1")
    log = w.gate_log("T1", new, code)
    rd = {"command": "git range-diff", "output_file": w.evidence("rd.txt")}
    findings = [settled(w, "T1-ver-F1", "claim", "refuted")]
    if code:
        findings.append(finding("T1-ver-F2", "claim", "refuted", evidence={"command": "gate", "output_file": log}))
    verify(w, "vrb", "[verify:rebase] T1", new, "fail", findings, rebased_from=head, evidence=rd)
    assert w.completed("vrb", "[verify:rebase] T1") == []
    reviewed(w, "T1", new, tag="2")
    w.created("m", "[merge] T1")
    sh(w.repo, "merge", "-q", "--ff-only", w.run.branch("T1"))
    return new


def test_a_failed_rebase_with_a_green_gate_log_merges_after_new_reviews(world: World) -> None:
    reviewed_after_failed_rebase(world, 0)
    assert world.completed("m", "[merge] T1") == []


def test_a_failed_rebase_with_a_red_gate_log_does_not_merge(world: World) -> None:
    new = reviewed_after_failed_rebase(world, 1)
    assert world.completed("m", "[merge] T1") == [f"root T1 has no passing gate run for {new}"]


def test_a_gate_log_removed_after_the_rebase_check_does_not_merge(world: World) -> None:
    new = reviewed_after_failed_rebase(world, 0)
    (world.run.dir / "evidence" / f"gate-T1-{new}.txt").unlink()
    assert world.completed("m", "[merge] T1") == [f"root T1 has no passing gate run for {new}"]


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


# --- fix round 1: renamed tasks, gate run at the merged head, lock release ---


def test_a_renamed_merge_task_is_refused(world: World) -> None:
    world.worktree("T1")
    world.created("i1", "[impl:backend] T1 Build")
    world.commit(world.run.worktree("T1"))
    world.completed("i1", "[impl:backend] T1 Build")
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert world.completed("m", "[impl:backend] T1 renamed") == [
        "task subject changed since creation: '[merge] T1' -> '[impl:backend] T1 renamed'"
    ]
    assert {"event": "completed", "gen": 1, "task_id": "m"} not in world.register()


def test_a_renamed_verify_review_is_refused(world: World) -> None:
    build(world)
    world.created("vr", "[verify:review] T1")
    assert "task subject changed since creation" in world.completed("vr", "[impl:backend] T1 x")[0]


def test_a_renamed_impl_is_refused(world: World) -> None:
    wt = world.worktree("T1")
    world.created("i1", "[impl:backend] T1 Build")
    head = world.commit(wt)
    review(world, "i1", "[review:code] T1", head)
    assert "task subject changed since creation" in world.completed("i1", "[review:code] T1")[0]


def test_merge_needs_a_gate_run_at_the_merged_head(world: World) -> None:
    wt, _ = build(world)
    head2 = world.commit(wt, "late.txt")
    reviewed(world, "T1", head2)
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert world.completed("m", "[merge] T1") == [f"root T1 has no passing gate run for {head2}"]


def test_merge_refuses_a_failing_gate_run_at_the_merged_head(world: World) -> None:
    wt = world.worktree("T1")
    world.created("i1", "[impl:backend] T1 Build")
    head = world.commit(wt)
    world.completed("i1", "[impl:backend] T1 Build")
    world.created("vi1", "[verify:impl] T1")
    world.gate_log("T1", head, 0)
    verify(world, "vi1", "[verify:impl] T1", head, "fail", [settled(world, "T1-ver-F1", "defect", "confirmed")])
    assert world.completed("vi1", "[verify:impl] T1") == []
    reviewed(world, "T1", head)
    world.created("m", "[merge] T1")
    sh(world.repo, "merge", "-q", "--ff-only", world.run.branch("T1"))
    assert world.completed("m", "[merge] T1") == [f"root T1 has no passing gate run for {head}"]


def test_a_lock_broken_by_another_hook_releases_quietly(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    lock = world.run.dir / "register.lock"
    real_close = os.close

    def close_then_broken(fd: int) -> None:
        real_close(fd)
        lock.unlink()  # another hook judged it stale and broke it (Windows forbids this while it is open)

    monkeypatch.setattr(os, "close", close_then_broken)
    with tg.locked(world.run, wait_s=1):
        pass
    assert not lock.exists()


def test_a_lock_being_deleted_counts_as_held(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    real_open = os.open
    calls: list[str] = []

    def pending_once(path: str | os.PathLike[str], flags: int, mode: int = 0o777) -> int:
        calls.append(str(path))
        if len(calls) == 1:
            raise PermissionError(13, "delete pending")
        return real_open(path, flags, mode)

    monkeypatch.setattr(os, "open", pending_once)
    ran = False
    with tg.locked(world.run, wait_s=1):
        ran = True
    assert ran and len(calls) == 2


def test_a_lock_that_stays_denied_ends_at_the_deadline(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    def denied(path: str | os.PathLike[str], flags: int, mode: int = 0o777) -> int:
        raise PermissionError(13, "denied")

    monkeypatch.setattr(os, "open", denied)
    with pytest.raises(GateError, match="register lock held"):
        tg.locked(world.run, wait_s=0.1).__enter__()
