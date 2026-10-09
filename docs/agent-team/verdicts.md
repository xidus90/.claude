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
