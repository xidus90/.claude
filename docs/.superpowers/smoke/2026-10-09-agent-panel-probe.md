# Agent-Panel: Messprotokoll der Mod-API

Datum: 2026-10-09. Claude Code `2.1.295` (Befehl: `claude --version`). Node `v24.14.1`.

## Probelauf

Wegwerf-Mod `agent-panel-probe` im Scratchpad (`turn.complete` des Leads schreibt
`agent-panel-probe.json`). Ein Lauf in leerem cwd `probe-run/`:

```
claude -p --model haiku --plugin-dir <scratch>/probe "Use the Agent tool exactly once: subagent_type general-purpose, model haiku, prompt 'Reply only with: ok'. Then reply only with: done."
```

Ausgabe: `done`. `agent-panel-probe.json` (gekürzt):

```json
{
  "sessionId": "6435d071-05d0-40a3-a2d0-a097a1e6f98d",
  "usage": { "startedAt": 1791555411683, "context": { "tokens": 54527, "window": 1000000, "percent": 5 },
             "rateLimits": [ ... ], "cost": { "usd": 0.016806704999999998 } },
  "agents": [],
  "nodeVersion": "v24.14.1",
  "nodeStartMs": 102,
  "bigStdoutLength": 3000000
}
```

`agents` ist leer: Beim `turn.complete` des Leads ist der Subagent schon beendet und
erscheint nicht mehr in `$.agent.list()`. Die Felder stammen deshalb aus der
Typdeklaration; die Laufzeitprüfung folgt im zweiten Lauf unten.

## Kosten-Umfang

```
node cli/summarize.ts --session 6435d071-05d0-40a3-a2d0-a097a1e6f98d --cwd <probe-run> --home "$HOME" --cache <scratch>/probe-cache.json
```

- Lead `costUsd` = 0,011595
- Agent `a9e47251455aa4595` `costUsd` = 0,005133
- alle = 0,016728
- gemeldet `usage.cost.usd` = 0,016807

Gemeldet liegt bei `alle` (Abweichung +0,47 %, unter 10 %), weit weg von `lead` (+45 %).
Die Agentendatei heißt `<lead>/subagents/agent-a9e47251455aa4595.jsonl`; dass `summarize`
dieselbe ID meldet, ist kein Beleg (es leitet sie aus diesem Dateinamen ab).

## Zweiter Lauf: `$.agent.list()` im Subagenten-Turn

Probe erweitert: im `turn.complete` mit gesetztem `e.agentId` schreibt sie
`{ eAgentId: e.agentId, agents: await $.agent.list() }` nach `agent-panel-probe-sub.json`.
Derselbe `claude -p`-Befehl einmal in leerem cwd `probe-run2/`; Ausgabe `done`,
Session `4d986488-cb9c-446b-bd87-4b4eb6cc933e`.

```json
{ "eAgentId": "aab33e3516578ed0f",
  "agents": [ { "id": "aab33e3516578ed0f", "description": "Antwort mit ok", "type": "general-purpose", "status": "completed" } ] }
```

Datei: `<lead>/subagents/agent-aab33e3516578ed0f.jsonl` (dazu `.meta.json`, `.prefix.json`).
`agents[0].id` = `e.agentId` = Dateistamm. `teammateId`, `parentId`, `spawnedBy` fehlen.
Der Status ist im eigenen `turn.complete` schon `completed`.

## Typen (`.claude-plugin/types/claude-code/index.d.ts`)

- `AgentInfo = { id: string; teammateId?: string; description: string; type: string; status: AgentStatus; parentId?: string; spawnedBy?: string }`,
  `AgentStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'`
- `SessionUsage = { startedAt: number; context: SessionContextUsage; rateLimits: SessionRateLimit[]; cost?: SessionCost }`, `SessionCost = { usd: number }`
- `process.run: (argv: readonly string[], init?: ProcessRunInit) => Promise<ProcessRunResult>`;
  `init` = `{ cwd, env, stdin, timeoutMs }` (Vorgabe 30 s, höchstens 10 min); stdout/stderr
  je bis 4194304 Bytes, `isStdoutTruncated`/`isStderrTruncated` melden Kürzung.
- `$.plugin.root: string` (Wert). Nicht verwechseln mit `$.session.root: () => Promise<string>`.

## Laufzeit von `summarize`

Größtes Lead-Transkript: `D--GitHub-tesserack/2ad92106-48c4-4029-9b4d-fa5c7fad4fed.jsonl`, 28 730 840 Bytes; laut `summarize`-Ausgabe (`agents.length`, `unreadableLines`) 9 Agenten, 0 unlesbare Zeilen.

```
time node cli/summarize.ts --session 2ad92106-48c4-4029-9b4d-fa5c7fad4fed --cwd D:/GitHub/tesserack --home "$HOME" --cache <scratch>/big-cache3.json > /dev/null
```

Drei kalte Läufe, je mit frischem Cache: 0,181 s (Ausgabe in `head -c 300`), 0,213 s (Ausgabe
in eine Datei), 0,186 s (`> /dev/null`). Warm: 0,099 s (`head`), 0,086 s (`> /dev/null`).
Gewertet: kalt 0,213 s (der langsamste), warm 0,086 s.

## Ergebnisse

Ergebnis: REPORTED_COST_INCLUDES_AGENTS = true (gemeldet 0,016807 vs. alle 0,016728, +0,47 %; lead 0,011595)
Ergebnis: `$.session.usage().cost` ist ein Objekt `{ usd: number }`, optional (`cost?: SessionCost`)
Ergebnis: AgentInfo hat `id, teammateId?, description, type, status, parentId?, spawnedBy?` (zur Laufzeit gefüllt: id, description, type, status); `id` = `e.agentId` = Stamm von `agent-<id>.jsonl`, gemessen im Subagenten-Turn (`aab33e3516578ed0f` dreimal gleich). Beim `turn.complete` des Leads ist die Liste leer
Ergebnis: `$.plugin.root` ist ein Wert (`root: string`)
Ergebnis: nodeStartMs = 102, 3-MB-Ausgabe kommt mit Länge 3000000 vollständig an (Grenze 4194304 Bytes)
Ergebnis: summarize kalt 0,213 s, warm 0,086 s auf 28,7 MB; TICK_MS = 2000
