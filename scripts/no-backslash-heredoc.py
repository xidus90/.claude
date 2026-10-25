"""PreToolUse hook: refuse a Bash heredoc or inline script that carries a backslash.

The Bash tool rewrites escapes before the shell sees them: `\\n` arrives as `\n`,
`"\r\n"` as a real line break, also inside <<'EOF'. Scripts and replacement texts
then change silently (AGENT_LEARNINGS, "Im Bash-Werkzeug kommt jeder Backslash
halbiert an"). Exit 2 with the reason on stderr refuses the call; exit 0 lets it
through.
"""

import json
import re
import sys

# Start of a heredoc: <<EOF, <<-EOF, <<'EOF', <<"EOF"
HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")

# An inline program: python -c '...', node -e "...", etc.
INLINE = re.compile(
    r"\b(?:python3?|py|node|perl|ruby)(?:\.exe)?\b[^\n;|&]*?\s-[ce]\s+(['\"])(.*?)(?<!\\)\1",
    re.DOTALL,
)

REASON = (
    "backslash in a heredoc or inline script: the Bash tool halves or expands "
    "escapes before the shell runs it. Write the script or text with the Write "
    "tool into the scratchpad and run that file instead"
)


def heredoc_bodies(command: str):
    lines = command.split("\n")
    i = 0
    while i < len(lines):
        m = HEREDOC.search(lines[i])
        if not m:
            i += 1
            continue
        end = m.group(2)
        body = []
        i += 1
        while i < len(lines) and lines[i].strip() != end:
            body.append(lines[i])
            i += 1
        yield "\n".join(body)
        i += 1


def offending(command: str) -> bool:
    if any("\\" in body for body in heredoc_bodies(command)):
        return True
    return any("\\" in m.group(2) for m in INLINE.finditer(command))


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0
    if payload.get("tool_name") != "Bash":
        return 0
    command = payload.get("tool_input", {}).get("command", "")
    if isinstance(command, str) and offending(command):
        print(REASON, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
