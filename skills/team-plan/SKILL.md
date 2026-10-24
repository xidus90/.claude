---
name: team-plan
description: Use when the human wants a request planned for an agent-team run (phase 1) — brainstorm, write spec and plan, have both verified, and commit them on a new feature branch for claude-team.ps1. Works in the CLI and in the Desktop app.
model: opus
effort: high
---

# Planning an agent-team run

Together with the human you turn a request into an approved spec and an
approved implementation plan, committed on a feature branch. The orchestrator
builds from that plan later; you write no product code.

The `model` and `effort` above hold only for the turn that loads this skill.
Before anything else, tell the human to set the session to Opus at effort
`high` (`/model opus`, `/effort high`, or the pickers in the Desktop app) if
it is not already, because planning takes many turns.

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
   It runs the build as a CLI session; in the Desktop app, run it in the
   Terminal panel — agent teams exist only in the CLI.

## Never

- Never push. Never commit on the main branch.
- Never end processes by name, only by PID. Never start an interpreter that
  reads code from stdin (`python -`).
