"""PreToolUse hook: refuse a git commit whose output is thrown away.

A commit runs the pre-commit gate; when the gate fails and its output went to
the null device, nobody can tell which check failed. Exit 2 with the reason on
stderr refuses the call; exit 0 lets it through.
"""

import json
import re
import sys

# One shell segment (up to the next ; | or line end) that holds `git … commit`
# and sends stdout, stderr or both to the null device.
DISCARDED = re.compile(
    r"\bgit\b[^;&|\n]*\bcommit\b[^;|\n]*?(?:&>|\d?>>?)\s*(?:/dev/null|\$null|NUL)\b",
    re.IGNORECASE,
)

REASON = (
    "git commit output must not be discarded: a commit runs the pre-commit "
    "gate; redirect to a scratchpad file instead and read it"
)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        return 0
    command = payload.get("tool_input", {}).get("command", "")
    if isinstance(command, str) and DISCARDED.search(command):
        print(REASON, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
