# Rauchtests 0–12 (2026-10-08)

Task 1 des Plans `docs/.superpowers/plans/2026-10-08-agent-team.md`.

- Claude Code 2.1.293, git 2.54.0.vfs.0.4, loomux 1.1.0
- Probe-Ordner `D:/GitHub/classic-game-bench/.team-runs/probe`, Probe-Settings
  mit Hooks und Deny-Regeln per `--settings`, zwei Probe-Definitionen in
  `~/.claude/agents/` (`team-probe-lead`, opus/medium; `team-probe-mate`,
  haiku/high)
- Lauf 1: Sitzung `9d20a266…`, Lauf 2: Sitzung `d1461387…`, beide mit
  `claude --agent team-probe-lead --teammate-mode in-process --settings … --add-dir …`
- **Abweichung:** Beide Läufe starteten im Worktree `~/.claude/.worktrees/agent-team`
  (Feld `cwd` der Transkripte), nicht in `classic-game-bench`; der
  loomux-Wächter des Projekts war also nicht geladen. Rauchtest 2 und der
  Wächteranteil sind deshalb zusätzlich direkt gegen den Wächter geprobt
  (unten). PowerShell-Teil von Rauchtest 7: Der Teammate (haiku) hat die
  PowerShell-Hälften seiner Schritte 5 und 6 übersprungen; nachgeholt mit
  einer Headless-Probe (unten).

## Ergebnisse

| # | Ergebnis | Beleg | Folge |
|---|---|---|---|
| 0 | bestanden | Lead meldet TaskCreate/TaskGet/TaskList/TaskUpdate; `hooks.jsonl` hat `task-created` für `[probe] lead task` (Lead) und `[probe] made by mate` (`agent_id aprobe-mate-…`). `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` im `env` der Settings reicht. | keine |
| 1 | bestanden | Teammate rief `Skill superpowers:verification-before-completion`, zitierte `# Verification Before Completion` | keine |
| 2 | bestanden | Live: drei Dateien ohne Rückfrage geschrieben, Rechtemodus `auto` (Transkript, Meta `permissionMode: auto`; Mensch: keine Rückfrage). Wächter: loomux 1.1.0 von `classic-game-bench` lässt Write auf `worktrees/w1/a.txt`, `verdicts/v.json`, `evidence/e.txt`, `.team-runs/.gitignore` für Lead- und Teammate-Nutzlast durch (Exit 0); Gegenprobe `C:/Users/micro/elsewhere.txt` Exit 2 „outside every writable tree“. Das Wächterurteil stammt aus synthetischen Nutzlasten mit `cwd` = Projekt und ohne `permission_mode`; die Kombination aus Auto-Modus und Wächter in einer Live-Sitzung ist nicht gemessen. | keine |
| 3 | bestanden | Nutzlasten des Teammates tragen `agent_id` (`aprobe-mate-…`) und `agent_type` = Name des Teammates (`probe-mate`, nicht der Definition); der Lead hat `agent_type: team-probe-lead` und kein `agent_id`. | nichts zu bauen (Spec 11 bleibt: keine Write-Begrenzung je Rolle in diesem Plan) |
| 4 | bestanden | `hooks.jsonl` hat Einträge von Lead und Teammate (Hooks aus `--settings`); `echo $TEAM_RUN_DIR` (Bash) und `echo $env:TEAM_RUN_DIR` (PowerShell) zeigen beim Teammate den Probe-Pfad | keine |
| 5 | bestanden | AskUserQuestion erschien unter `--agent` (Antwort „yes“); Statuszeile `medium`; Nutzlast des Leads `effort: {"level": "medium"}` | keine |
| 6 | bestanden | Haiku-Teammate mit `effort: high` startete fehlerfrei; seine Nutzlasten tragen `effort: {"level": "high"}`. Die Wirkung des Efforts selbst ist nicht messbar. | keine |
| 7 | bestanden, mit Lücke | Bash beim Teammate: Hook verweigert („probe: refused by the PreToolUse hook“), Deny-Regel verweigert („Permission to use Bash … has been denied“). PowerShell beim Teammate: nur das **Feuern** des Hooks belegt (Matcher `Bash\|PowerShell`, Eintrag für `echo $env:TEAM_RUN_DIR` mit `agent_id`). Exit 2 und Deny-Regel für PowerShell nur in einer **Hauptsitzung** geprobt (`claude -p --settings … --allowedTools PowerShell`, Sitzung `044154e4…`, beide verweigert). Die Verweigerung beim Teammate für PowerShell ist aus der Bash-Hälfte geschlossen, nicht gemessen. | Task 6 holt es nach (Ende-zu-Ende-Lauf) |
| 8 | bestanden | Teammate entstand aus `~/.claude/agents/team-probe-mate.md` (Meta `customAgentType: team-probe-mate`, `model: haiku`, `taskKind: in_process_teammate`). Werkzeuge: die der Definition plus TaskCreate/TaskGet/TaskList/TaskUpdate/SendMessage, die er nicht in `tools:` hat — genau wie Spec Abschnitt 2 Punkt 12 vorhersagt; die Definition begrenzt diese fünf nicht. Ob sie Werkzeuge außerhalb der Liste (etwa Edit) fernhält, wurde nicht geprobt. | keine; die Rollentabellen in Task 4 listen die Team-Werkzeuge ohnehin nicht als Grenze |
| 9 | bestanden | Teammate setzte Task 2 per TaskUpdate auf `pending` mit `WAITING: smoke test 9` und beendete den Zug; `hooks.jsonl` enthält **kein** `task-completed`; sein Transkript hat genau eine Nachricht des Leads, keine Wiederholung | `WAIT_MARKER` bleibt aus |
| 10 | bestanden | IDs sind Dezimalzahlen als Text (`"1"`, `"2"`, …); der zweite Lead zählte wieder ab `"1"` | keine (`g<gen>` im Dateinamen trägt das) |
| 11 | bestanden | `post-task-update` mit `tool_input: {"taskId": "4", "status": "deleted"}` | Schlüssel wie im Plan, nichts zu ändern |
| 12 | bestanden | Agent-Aufruf ohne `name` lief als Hintergrund-Subagent (Meta `requestShape: background`, kein `teamName`) und lieferte `PONG` per Benachrichtigung | keine; Hinweis: die Ergebnisse unbenannter Helfer kommen asynchron |

Kein Rauchtest fiel durch; kein Rückfall aus Task 1 Step 9 ist anzuwenden.

**Offen, und wer es schließt:**

- Eine echte `TaskCompleted`-Nutzlast fehlt (siehe unten). Task 2 baut auf
  den Feldern der Doku (`task_id`, `task_subject`, `task_description`), die
  in der gemessenen `TaskCreated`-Nutzlast genau so heißen. Task 6 sieht die
  echte Nutzlast; weicht sie ab, ist das ein Befund für `teamgate_tasks.py`.
- PowerShell-Verweigerung beim Teammate (Rauchtest 7): Task 6.

## Weitere Beobachtungen

- Der Wächter von `classic-game-bench` lässt auch alle Befehle des Laufs
  durch: `git worktree add --track -b team/…`, `git worktree add --detach`,
  `git -C <worktree> rebase`, `git merge --ff-only`, `git worktree remove`,
  `git branch --dry-run --delete-merged …`, `rm -r .team-runs/<lauf>`,
  `rm .team-runs/.gitignore`, `rmdir .team-runs`, `uv run --script …
  team-gate.py … supersede`, `Remove-Item -Recurse <lauf>` (alle Exit 0).
- Alle Nutzlasten tragen `cwd` = Arbeitsverzeichnis der Sitzung, auch die
  des Teammates. Der Teammate hatte aber nie ein eigenes Verzeichnis; ob
  `cwd` einem `cd` des Teammates folgt, sagt dieser Lauf nicht. Folgerung,
  nicht gemessen: Die Befehlsprüfung löst relative Pfade gegen `cwd` auf und
  kennt ein anderes Verzeichnis nur über ein `cd` im selben Befehl.
- Die Nutzlasten tragen zusätzlich `team_name` (`session-<id>`) und
  `prompt_id`; `team-gate.py` braucht keines davon.
- Ein `task-completed` wurde in diesem Lauf nicht beobachtet (Absicht von
  Rauchtest 9). Seine Felder (`task_id`, `task_subject`,
  `task_description`, `teammate_name`) stammen aus der Doku; Task 6 sieht
  sie im echten Lauf.

## Wörtliche Nutzlasten

Gekürzt sind nur die Felder `transcript_path`, `scratchpad_dir` und
`prompt_id` (als `…` markiert oder weggelassen, wo genannt); alles andere
steht wie in `hooks.jsonl`.

`TaskCreated` (Teammate):

```json
{"session_id": "9d20a266-7d15-487e-a31e-681430c2a8cd", "transcript_path": "C:\\Users\\micro\\.claude\\projects\\C--Users-micro--claude--worktrees-agent-team\\9d20a266-7d15-487e-a31e-681430c2a8cd.jsonl", "cwd": "C:\\Users\\micro\\.claude\\.worktrees\\agent-team", "scratchpad_dir": "…", "prompt_id": "5076a495-6ac6-448e-9541-069a5a340679", "agent_id": "aprobe-mate-d35fe2cf3823817a", "agent_type": "probe-mate", "hook_event_name": "TaskCreated", "task_id": "3", "task_subject": "[probe] made by mate", "task_description": "Probe task created by the mate during smoke test run.", "teammate_name": "probe-mate", "team_name": "session-9d20a266"}
```

`PostToolUse` auf `TaskUpdate`, Löschen (Lead):

```json
{"session_id": "9d20a266-7d15-487e-a31e-681430c2a8cd", "cwd": "C:\\Users\\micro\\.claude\\.worktrees\\agent-team", "permission_mode": "auto", "agent_type": "team-probe-lead", "effort": {"level": "medium"}, "hook_event_name": "PostToolUse", "tool_name": "TaskUpdate", "tool_input": {"taskId": "4", "status": "deleted"}, "tool_response": {"success": true, "taskId": "4", "updatedFields": ["deleted"], "statusChange": {"from": "pending", "to": "deleted"}}, "tool_use_id": "toolu_01Uj33TGSeTv82LDhwEVPobb", "duration_ms": 11}
```

`PreToolUse` auf `Bash` (Teammate):

```json
{"session_id": "9d20a266-7d15-487e-a31e-681430c2a8cd", "cwd": "C:\\Users\\micro\\.claude\\.worktrees\\agent-team", "permission_mode": "auto", "agent_id": "aprobe-mate-d35fe2cf3823817a", "agent_type": "probe-mate", "effort": {"level": "high"}, "hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": "echo \"$TEAM_RUN_DIR\"", "description": "Print TEAM_RUN_DIR in Bash"}, "tool_use_id": "toolu_01UUYGWWdKt69RXZcW8vLs9s"}
```
