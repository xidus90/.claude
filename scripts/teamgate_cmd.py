"""PreToolUse command check of an agent-team run (spec section 6).

A parser, not a sandbox: it reads the command as Bash or PowerShell would
split it, unwraps the usual launchers and judges every simple command it
finds. What a script or the project's gate runs internally stays invisible.
"""

from __future__ import annotations

import base64
import itertools
import os
import re
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from teamgate_tasks import GateError, Run

BASH, PWSH = "bash", "powershell"


@dataclass
class Segment:
    words: list[str]
    piped: bool = False  # the previous segment's output flows into this one


@dataclass
class Parsed:
    segments: list[Segment] = field(default_factory=list)
    nested: list[tuple[str, str]] = field(default_factory=list)  # (dialect, command) from $(…) and `…`


_REDIRECT = re.compile(r"^[0-9]*(?:>>?|<|&>>?|>&)[0-9&-]*$")


def _closing(text: str, i: int) -> int:
    """Index of the ')' that closes the '(' at text[i]."""
    depth = 0
    quote = ""
    while i < len(text):
        c = text[i]
        if quote:
            if c == quote:
                quote = ""
        elif c in "'\"":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise GateError("unbalanced parenthesis")


def tokenize(text: str, dialect: str) -> Parsed:
    out = Parsed()
    words: list[str] = []
    word: list[str] = []
    in_word = False
    piped = False
    escape = "`" if dialect == PWSH else "\\"

    def end_word() -> None:
        nonlocal in_word
        if in_word:
            words.append("".join(word))
            word.clear()
            in_word = False

    def end_segment(next_piped: bool) -> None:
        nonlocal words, piped
        end_word()
        if words:
            out.segments.append(Segment(words, piped))
        words = []
        piped = next_piped

    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == escape and i + 1 < n:
            if text[i + 1] == "\n":
                i += 2
                continue
            word.append(text[i + 1])
            in_word = True
            i += 2
        elif c == "'":
            j = i + 1
            while True:
                j = text.find("'", j)
                if j < 0:
                    raise GateError("unterminated single quote")
                if dialect == PWSH and text[j + 1 : j + 2] == "'":
                    j += 2
                    continue
                break
            word.append(text[i + 1 : j].replace("''", "'") if dialect == PWSH else text[i + 1 : j])
            in_word = True
            i = j + 1
        elif c == '"':
            j = i + 1
            buf: list[str] = []
            while j < n and text[j] != '"':
                if text[j] == escape and j + 1 < n:
                    buf.append(text[j + 1])
                    j += 2
                    continue
                if text[j] == "$" and text[j + 1 : j + 2] == "(":
                    k = _closing(text, j + 1)
                    out.nested.append((dialect, text[j + 2 : k]))
                    buf.append(text[j : k + 1])
                    j = k + 1
                    continue
                if text[j] == "`" and dialect == BASH:
                    k = text.find("`", j + 1)
                    if k < 0:
                        raise GateError("unterminated backquote")
                    out.nested.append((dialect, text[j + 1 : k]))
                    j = k + 1
                    continue
                buf.append(text[j])
                j += 1
            if j >= n:
                raise GateError("unterminated double quote")
            word.append("".join(buf))
            in_word = True
            i = j + 1
        elif c == "$" and text[i + 1 : i + 2] == "(":
            k = _closing(text, i + 1)
            out.nested.append((dialect, text[i + 2 : k]))
            word.append(text[i : k + 1])
            in_word = True
            i = k + 1
        elif c == "`" and dialect == BASH:
            k = text.find("`", i + 1)
            if k < 0:
                raise GateError("unterminated backquote")
            out.nested.append((dialect, text[i + 1 : k]))
            i = k + 1
        elif c == "#" and not in_word:
            while i < n and text[i] != "\n":
                i += 1
        elif c in " \t\r":
            end_word()
            i += 1
        elif c in "\n;(){}":
            end_segment(False)
            i += 1
        elif c == "|":
            two = text[i : i + 2]
            end_segment(two != "||")
            i += 2 if two in ("||", "|&") else 1
        elif c == "&":
            two = text[i : i + 2]
            if two == "&&":
                end_segment(False)
                i += 2
            elif two == "&>":
                word.append(c)
                in_word = True
                i += 1
            elif dialect == PWSH and not in_word and not words:
                words.append("&")  # call operator
                i += 1
            elif in_word and word and word[-1] in "<>":
                word.append(c)
                i += 1
            else:
                end_segment(False)
                i += 1
        else:
            word.append(c)
            in_word = True
            i += 1
    end_segment(False)
    for seg in out.segments:
        seg.words = _drop_redirects(seg.words)
    out.segments = [s for s in out.segments if s.words]
    return out


def _drop_redirects(words: list[str]) -> list[str]:
    kept: list[str] = []
    skip = False
    for w in words:
        if skip:
            skip = False
            continue
        if _REDIRECT.match(w):
            skip = not w.endswith(("&1", "&2", "&-"))
            continue
        if re.match(r"^[0-9]*(?:>>?|<)\S", w):
            continue  # >file
        kept.append(w)
    return kept


def exe_name(word: str) -> str:
    base = re.split(r"[\\/]", word)[-1].lower()
    return re.sub(r"\.(exe|cmd|bat|com)$", "", base)


def _starts(word: str, full: str, minimum: int) -> bool:
    w = word.lower()
    return minimum <= len(w) <= len(full) and full.startswith(w)


# --- unwrapping launchers --------------------------------------------------


def unwrap(words: list[str], dialect: str) -> tuple[list[str], list[tuple[str, str]]]:
    """Strip launchers; return the inner command and commands to re-parse."""
    nested: list[tuple[str, str]] = []
    while words:
        first = words[0]
        exe = exe_name(first)
        if dialect == PWSH and first in ("&", "."):
            words = words[1:]
        elif dialect == BASH and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", first):
            words = words[1:]
        elif exe in ("env", "nohup", "exec", "command", "builtin", "time", "nice"):
            rest = words[1:]
            while rest and (rest[0].startswith("-") or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", rest[0])):
                rest = rest[2:] if rest[0] in ("-u", "--unset", "-C", "--chdir", "-n") else rest[1:]
            words = rest
        elif exe == "cmd":
            for idx, w in enumerate(words[1:], start=1):
                if w.lower() in ("/c", "/k", "/r"):
                    nested.append((BASH, " ".join(words[idx + 1 :])))
                    break
            return [], nested
        elif exe in ("bash", "sh", "zsh", "dash", "ksh"):
            for idx, w in enumerate(words[1:], start=1):
                if re.match(r"^-[A-Za-z]*c[A-Za-z]*$", w) and idx + 1 < len(words):
                    nested.append((BASH, words[idx + 1]))
                    return [], nested
            return words, nested
        elif exe in ("pwsh", "powershell"):
            for idx, w in enumerate(words[1:], start=1):
                lw = w.lower()
                if (lw == "-c" or _starts(lw, "-command", 3)) and idx + 1 < len(words):
                    nested.append((PWSH, " ".join(words[idx + 1 :])))
                    return [], nested
                if (lw in ("-e", "-ec") or _starts(lw, "-encodedcommand", 4)) and idx + 1 < len(words):
                    try:
                        decoded = base64.b64decode(words[idx + 1], validate=True).decode("utf-16-le")
                    except ValueError as exc:
                        raise GateError(f"cannot decode -EncodedCommand: {exc}") from None
                    nested.append((PWSH, decoded))
                    return [], nested
            return words, nested
        elif exe in ("invoke-expression", "iex"):
            args = [w for w in words[1:] if not _starts(w, "-command", 2)]
            nested.append((PWSH, " ".join(args)))
            return [], nested
        elif exe in ("start-process", "saps", "start"):
            file_path: str | None = None
            arg_list: list[str] = []
            rest = words[1:]
            k = 0
            while k < len(rest):
                lw = rest[k].lower()
                if _starts(lw, "-filepath", 2) and k + 1 < len(rest):
                    file_path = rest[k + 1]
                    k += 2
                elif (_starts(lw, "-argumentlist", 2) or lw == "-args") and k + 1 < len(rest):
                    arg_list = [a for part in rest[k + 1 :] for a in part.split(",") if a]
                    break
                elif lw.startswith("-"):
                    k += 2 if k + 1 < len(rest) and not rest[k + 1].startswith("-") else 1
                elif file_path is None:
                    file_path = rest[k]
                    k += 1
                else:
                    arg_list = [a for part in rest[k:] for a in part.split(",") if a]
                    break
            if file_path is None:
                return [], nested
            words = [file_path, *arg_list]
            nested.append((dialect, " ".join(_quote(w) for w in words)))
            return [], nested
        else:
            return words, nested
    return words, nested


def _quote(word: str) -> str:
    return "'" + word.replace("'", "''") + "'" if re.search(r"\s", word) else word


# --- paths -----------------------------------------------------------------

_VAR = re.compile(r"\$\{?(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}?|%([A-Za-z_][A-Za-z0-9_]*)%", re.IGNORECASE)


def resolve(word: str, cwd: Path, run: Run) -> Path | None:
    """The real path a command word names, or None when it cannot be known."""

    def var(m: re.Match[str]) -> str:
        name = m.group(1) or m.group(2)
        if name.upper() == "TEAM_RUN_DIR":
            return str(run.dir)
        if name.upper() in ("HOME", "USERPROFILE"):
            return str(Path.home())
        value = next((v for k, v in os.environ.items() if k.upper() == name.upper()), None)
        if value is None:
            raise KeyError(name)
        return value

    try:
        text = _VAR.sub(var, word)
    except KeyError:
        return None
    if "$" in text or "`" in text or "%" in text:
        return None
    if text == "~" or text.startswith(("~/", "~\\")):
        text = str(Path.home()) + text[1:]
    m = re.match(r"^/([a-zA-Z])(/.*)?$", text)
    if m:
        text = f"{m.group(1).upper()}:{m.group(2) or '/'}"
    glob = re.search(r"[*?\[]", text)
    if glob:
        cut = max(text.rfind("/", 0, glob.start()), text.rfind("\\", 0, glob.start()))
        text = text[: cut + 1] if cut >= 0 else "."
    path = Path(text)
    if not path.is_absolute():
        path = cwd / path
    return Path(os.path.realpath(path))


def within(child: Path, parent: Path) -> bool:
    c, p = os.path.normcase(str(child)), os.path.normcase(str(parent))
    try:
        return os.path.commonpath([c, p]) == p
    except ValueError:  # different drives
        return False


# --- the rules -------------------------------------------------------------


@dataclass
class Context:
    run: Run
    cwd: Path
    feature: str | None

    def worktrees(self, repo: Path) -> list[Path]:
        out = subprocess.run(
            ["git", "-C", str(repo), "worktree", "list", "--porcelain"],
            capture_output=True, text=True, encoding="utf-8", check=False,
        ).stdout
        return [Path(os.path.realpath(line[9:])) for line in out.splitlines() if line.startswith("worktree ")]


def _shorts(args: list[str], value: str = "", stuck: str = "", value_longs: frozenset[str] = frozenset()) -> str:
    """Letters of bundled short options as git reads them.

    A letter in `value` takes the rest of its word, or the next word, as its
    value (`-m msg`, `-mmsg`); a letter in `stuck` takes only the rest of its
    word (`-uno`). Values are skipped, so `-m -n` is a message, not -n.
    """
    letters = ""
    skip = False
    for a in args:
        if skip:
            skip = False
            continue
        if a == "--":
            break
        if a in value_longs:
            skip = True
        elif re.match(r"^-[A-Za-z]", a):
            for idx, ch in enumerate(a[1:], start=1):
                letters += ch
                if ch in value or ch in stuck:
                    skip = ch in value and idx == len(a) - 1
                    break
    return letters


def _longs(args: list[str], known: list[str]) -> set[str]:
    """Long options as git reads them: exact, or every option an abbreviation may mean."""
    found: set[str] = set()
    for a in args:
        if a == "--":
            break
        if a.startswith("--") and len(a) > 2:
            name = a.split("=", 1)[0]
            if name in known:
                found.add(name)
            else:
                found.update(k for k in known if k.startswith(name))
    return found


_GIT_GLOBAL_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--exec-path", "--super-prefix"}

_COMMIT_VALUE_LONGS = frozenset({
    "--message", "--file", "--author", "--date", "--reuse-message", "--reedit-message",
    "--fixup", "--squash", "--template", "--trailer", "--cleanup", "--pathspec-from-file",
})


def _positionals(args: list[str], value_shorts: str = "", value_longs: set[str] | None = None) -> list[str]:
    out: list[str] = []
    skip = False
    dashdash = False
    for a in args:
        if skip:
            skip = False
            continue
        if dashdash or not a.startswith("-") or a == "-":
            out.append(a)
        elif a == "--":
            dashdash = True
        elif value_longs and a in value_longs:
            skip = True
        elif re.match(r"^-[A-Za-z]+$", a) and a[-1] in value_shorts:
            skip = True
    return out


def check_git(args: list[str], ctx: Context, cwd: Path) -> str | None:
    i = 0
    while i < len(args) and args[i].startswith("-"):
        a = args[i]
        name, _, inline = a.partition("=")
        value = inline if inline else (args[i + 1] if name in _GIT_GLOBAL_WITH_VALUE and i + 1 < len(args) else "")
        if name in ("-c", "--config-env") and value.split("=", 1)[0].lower() == "core.hookspath":
            return "git -c core.hooksPath bypasses the hooks"
        if name == "-C" and value:
            target = resolve(value, cwd, ctx.run)
            if target is None:
                return f"cannot resolve git -C {value}"
            cwd = target
        i += 1 if inline or name not in _GIT_GLOBAL_WITH_VALUE else 2
    if i >= len(args):
        return None
    sub, rest = args[i].lower(), args[i + 1 :]

    if sub == "push":
        return "git push is the human's"
    if sub in ("commit-tree", "update-ref"):
        return f"git {sub} bypasses the commit gate"
    if sub == "config" and any(a.lower() == "core.hookspath" for a in rest) and not {"--get", "--get-all", "get", "-l", "--list"} & set(rest):
        return "git config core.hooksPath bypasses the hooks"
    if sub == "commit":
        if "n" in _shorts(rest, value="mFcCt", stuck="uS", value_longs=_COMMIT_VALUE_LONGS):
            return "git commit -n skips the commit gate"
        skip = False
        for a in rest:
            if skip:
                skip = False
                continue
            if a == "--":
                break
            skip = a in _COMMIT_VALUE_LONGS
            # Every abbreviation git could read as --no-verify (--no-v is ambiguous, still refused).
            if _starts(a.split("=", 1)[0], "--no-verify", 6):
                return "git commit --no-verify skips the commit gate"
        return None
    if sub == "branch":
        return _check_branch(rest, ctx)
    if sub == "reset":
        if any(_starts(a, "--hard", 3) for a in rest):
            return _check_reset(cwd, ctx)
        return None
    if sub == "worktree" and rest and rest[0] == "remove":
        opts = rest[1:]
        if "f" in _shorts(opts) or "--force" in _longs(opts, ["--force"]):
            return "git worktree remove --force can drop unsaved work"
        root = Path(os.path.realpath(ctx.run.dir / "worktrees"))
        for p in _positionals(opts):
            target = resolve(p, cwd, ctx.run)
            if target is None or not within(target, root) or target == root:
                return f"git worktree remove outside {root}: {p}"
        return None
    if sub == "clean":
        letters = _shorts(rest)
        forces = letters.count("f") + sum(1 for a in rest if _starts(a, "--force", 4))
        if set(letters) & {"x", "X", "d"} or forces >= 2:
            return "git clean -x/-X/-d/-ff deletes untracked state"
        return None
    return None


_BRANCH_LONGS = [
    "--delete", "--delete-merged", "--force", "--move", "--copy", "--dry-run", "--list",
    "--merged", "--no-merged", "--contains", "--no-contains", "--points-at", "--set-upstream-to",
    "--unset-upstream", "--track", "--no-track", "--create-reflog", "--edit-description",
    "--show-current", "--sort", "--format", "--color", "--no-color", "--column", "--no-column",
    "--verbose", "--quiet", "--abbrev", "--no-abbrev", "--all", "--remotes", "--ignore-case", "--omit-empty",
]


def _check_branch(args: list[str], ctx: Context) -> str | None:
    letters = _shorts(args, value="u")
    longs = _longs(args, _BRANCH_LONGS)
    delete = "d" in letters or "--delete" in longs
    force = "f" in letters or "--force" in longs
    if "D" in letters or (delete and force):
        return "git branch -D deletes unmerged work"
    prefix = f"team/{ctx.run.name}/"
    positional = _positionals(args, value_shorts="u", value_longs={"--sort", "--format", "--contains", "--no-contains", "--points-at", "--merged", "--no-merged", "--set-upstream-to"})
    if "--delete-merged" in longs:
        patterns = positional[1:]
        if not patterns or not all(p.startswith(prefix) for p in patterns):
            return f"git branch --delete-merged must name only {prefix}* branches"
    if delete and (not positional or not all(p.startswith(prefix) for p in positional)):
        return f"git branch -d may only delete {prefix}* branches"
    moving = "M" in letters or "C" in letters or ({"--move", "--copy"} & longs and force)
    if (force or moving) and not delete:
        target = positional[-1] if moving and positional else (positional[0] if positional else "")
        target = target.removeprefix("refs/heads/")
        if ctx.feature is None or target == ctx.feature:
            return "git branch --force must not move the feature branch"
    return None


def _check_reset(tree: Path, ctx: Context) -> str | None:
    ref = subprocess.run(
        ["git", "-C", str(tree), "symbolic-ref", "-q", "HEAD"],
        capture_output=True, text=True, encoding="utf-8", check=False,
    )
    if ctx.feature is None:
        return "git reset --hard needs a known feature branch (run.json unreadable)"
    if ref.returncode == 0 and ref.stdout.strip() == f"refs/heads/{ctx.feature}":
        return "git reset --hard on the feature branch"
    return None


def check_gh(args: list[str]) -> str | None:
    lowered = [a.lower() for a in args]
    if lowered[:2] == ["pr", "merge"]:
        return "gh pr merge is the human's"
    if lowered[:1] == ["api"] and any("/merge" in a for a in lowered[1:]):
        return "gh api …/merge is the human's"
    return None


_REMOVE_PS = {"remove-item", "ri", "del", "erase", "rd", "rmdir", "rm"}
_LIST_PS = {"get-childitem", "gci", "ls", "dir"}


def _ps_recurse(args: list[str]) -> bool:
    return any(_starts(a.split(":", 1)[0], "-recurse", 2) for a in args)


def _ps_targets(args: list[str]) -> list[str]:
    out: list[str] = []
    k = 0
    while k < len(args):
        lw = args[k].lower()
        if (_starts(lw, "-path", 2) or _starts(lw, "-literalpath", 2) or lw == "-lp") and k + 1 < len(args):
            out += [p for p in args[k + 1].split(",") if p]
            k += 2
        elif lw.startswith("-"):
            k += 1
        else:
            out += [p for p in args[k].split(",") if p]
            k += 1
    return out


def recursive_delete_targets(exe: str, args: list[str], dialect: str) -> list[str] | None:
    """Paths a recursive delete would remove; None if the command deletes nothing recursively."""
    if exe in ("rd", "rmdir") and any(re.match(r"^/[sq](/[sq])?$", a, re.IGNORECASE) and "s" in a.lower() for a in args):
        return [a for a in args if not a.startswith("/")] or ["."]
    if exe == "rm" and dialect == BASH:
        if re.search(r"[rR]", _shorts(args)) or any(_starts(a, "--recursive", 3) for a in args):
            return _positionals(args) or ["."]
        return None
    if exe in _REMOVE_PS and dialect == PWSH and _ps_recurse(args):
        return _ps_targets(args) or ["."]
    if exe == "find" and "-delete" in args:
        starts = list(itertools.takewhile(lambda a: not a.startswith(("-", "(", "!")), args))
        return starts or ["."]
    return None


_DIRECTORY_DELETE = re.compile(
    r"\[(?:System\.)?IO\.Directory\]::Delete\(\s*(?P<path>'[^']*'|\"[^\"]*\"|[^,)]+?)\s*,\s*\$true\s*\)",
    re.IGNORECASE,
)


def check_delete(targets: list[str], ctx: Context, cwd: Path) -> str | None:
    run_dir = Path(os.path.realpath(ctx.run.dir))
    worktrees = [w for w in ctx.worktrees(ctx.run.repo) if within(w, run_dir / "worktrees")]
    for t in targets:
        path = resolve(t, cwd, ctx.run)
        if path is None:
            return f"recursive delete of a path that cannot be resolved: {t}"
        if not within(path, run_dir):
            return f"recursive delete outside the run folder: {t}"
        for w in worktrees:
            if within(w, path) or within(path, w):
                return f"recursive delete of a worktree git still lists: {w}"
    return None


def check_command(command: str, dialect: str, ctx: Context, depth: int = 0) -> str | None:
    if depth > 8:
        return "command nests launchers too deeply to check"
    for m in _DIRECTORY_DELETE.finditer(command):
        reason = check_delete([m.group("path").strip("'\"")], ctx, ctx.cwd)
        if reason:
            return reason
    parsed = tokenize(command, dialect)
    for sub_dialect, sub in parsed.nested:
        reason = check_command(sub, sub_dialect, ctx, depth + 1)
        if reason:
            return reason
    cwd = ctx.cwd
    previous: tuple[str, list[str], Path] | None = None
    for seg in parsed.segments:
        words, nested = unwrap(seg.words, dialect)
        for sub_dialect, sub in nested:
            reason = check_command(sub, sub_dialect, Context(ctx.run, cwd, ctx.feature), depth + 1)
            if reason:
                return reason
        if not words:
            previous = None
            continue
        exe, args = exe_name(words[0]), words[1:]
        if exe in ("cd", "set-location", "sl", "chdir", "pushd", "push-location"):
            target = resolve(_positionals(args)[0], cwd, ctx.run) if _positionals(args) else Path.home()
            if target is None:
                return f"cannot follow cd {args}"
            cwd = target
        reason = None
        if exe == "git":
            reason = check_git(args, ctx, cwd)
        elif exe == "gh":
            reason = check_gh(args)
        else:
            targets = recursive_delete_targets(exe, args, dialect)
            target_cwd = cwd
            if targets is None and seg.piped and previous and dialect == PWSH and exe in _REMOVE_PS:
                # Get-ChildItem -Recurse <dir> | Remove-Item deletes the tree of <dir>.
                p_exe, p_args, p_cwd = previous
                if p_exe in _LIST_PS and _ps_recurse(p_args):
                    targets, target_cwd = _ps_targets(p_args) or ["."], p_cwd
            if targets is not None:
                reason = check_delete(targets, ctx, target_cwd)
        if reason:
            return reason
        previous = (exe, args, cwd)
    return None


def on_pre_tool_use(run: Run, payload: Mapping[str, object]) -> list[str]:
    tool = payload.get("tool_name")
    tool_input = payload.get("tool_input")
    if tool not in ("Bash", "PowerShell") or not isinstance(tool_input, dict):
        return []
    command = tool_input.get("command")
    if not isinstance(command, str):
        return []
    cwd_value = payload.get("cwd")
    cwd = Path(cwd_value) if isinstance(cwd_value, str) and cwd_value else run.repo
    try:
        feature: str | None = run.feature
    except (OSError, ValueError, GateError):
        feature = None  # run folder gone or broken: rules that need the branch fail closed
    reason = check_command(command, BASH if tool == "Bash" else PWSH, Context(run, cwd, feature))
    return [reason] if reason else []
