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
