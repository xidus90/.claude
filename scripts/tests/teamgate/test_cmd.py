"""Battery for the command check: every form of the table in spec section 6,
each next to lines that must still go through, in Bash and PowerShell."""

from __future__ import annotations

import base64
import shutil
import subprocess
import sys
from pathlib import Path
from typing import NoReturn

import pytest
from conftest import FEATURE, RUN_NAME, World, sh

import teamgate_cmd as tc
from teamgate_tasks import GateError

TEAM = f"team/{RUN_NAME}"


def fill(line: str, w: World, wt: Path) -> str:
    return (
        line.replace("{run}", w.run.dir.as_posix())
        .replace("{repo}", w.repo.as_posix())
        .replace("{wt}", wt.as_posix())
        .replace("{team}", TEAM)
    )


def check(w: World, line: str, dialect: str, cwd: Path | None = None) -> str | None:
    ctx = tc.Context(w.run, cwd or w.repo, FEATURE)
    return tc.check_command(line, dialect, ctx)


@pytest.fixture
def wt(world: World) -> Path:
    return world.worktree("T1")


DENY_BASH = [
    # publish
    "git push",
    "git push origin feat/x",
    '"C:/Program Files/Git/cmd/git.exe" push',
    "/c/Program\\ Files/Git/cmd/git push",
    "git -C . push",
    "git --no-pager -c color.ui=never push",
    "echo hi; git push",
    "true && git push",
    "false || git push",
    "sleep 1 & git push",
    "git status\ngit push",
    "env FOO=1 git push",
    "env -u HOME git push",
    "FOO=1 BAR=2 git push",
    "nohup git push",
    'bash -c "git push"',
    "sh -lc 'git push'",
    "cmd /c git push",
    'cmd /C "git push"',
    'pwsh -Command "git push"',
    "echo $(git push)",
    'echo "$(git push)"',
    "echo `git push`",
    "( git push )",
    "{ git push; }",
    "gh pr merge 5",
    "gh api -X PUT repos/o/r/pulls/5/merge",
    # gates
    "git commit -n -m x",
    "git commit -anm x",
    "git commit -m x -n",
    "git commit --no-verify -m x",
    "git commit --no-verif -m x",
    "git commit --no-ve",
    "git -c core.hooksPath=/dev/null commit -m x",
    "git -c CORE.HOOKSPATH=x commit -m x",
    "git --config-env core.hooksPath=X commit -m x",
    "git config core.hooksPath x",
    "git commit-tree HEAD^{tree}",
    "git update-ref refs/heads/x HEAD",
    # branches with force
    "git branch -D x",
    "git branch -d -f {team}/T1",
    "git branch -df {team}/T1",
    "git branch --delete --force {team}/T1",
    "git branch --del --forc {team}/T1",
    "git branch -f feat/x HEAD",
    "git branch --force refs/heads/feat/x HEAD",
    "git branch -M other feat/x",
    "git branch --move --force other feat/x",
    # branches outside the run
    "git branch -d main",
    "git branch -d {team}/T1 main",
    "git branch -d",
    "git branch --delete-merged refs/heads/feat/x",
    "git branch --delete-merged refs/heads/feat/x 'team/*'",
    "git branch --delete-m refs/heads/feat/x main",
    # reset on the feature branch
    "git reset --hard",
    "git reset --hard HEAD~1",
    'git -C "{repo}" reset --har',
    # worktrees
    'git worktree remove --force "{wt}"',
    'git worktree remove -f "{wt}"',
    'git worktree remove "{repo}/elsewhere"',
    'git worktree remove "{run}/worktrees"',
    "git worktree remove $TEAMGATE_SURELY_UNSET/x",
    # clean
    "git clean -fdx",
    "git clean -x",
    "git clean -fX",
    "git clean -ff",
    "git clean -f -f",
    "git clean --force --force",
    "git clean -d -f",
    # recursive delete
    "rm -rf /c/Users/x",
    "rm -r src",
    "rm -fr src",
    "rm -R src",
    "rm --recursive src",
    'rm -r "{wt}"',
    'rm -r "$TEAM_RUN_DIR/worktrees/T1"',
    'rm -rf "$TEAM_RUN_DIR"',
    "rm -rf ${TEAM_RUN_DIR}/..",
    "rm -r $TEAMGATE_SURELY_UNSET/x",
    "rm -r ~/x",
    "rm -r *",
    "find . -delete",
    "find src -name x -delete",
    "cmd /c rd /s /q src",
    "cmd /c rmdir /q /s src",
    'cmd /c "rd /S src"',
    "cd /c/Windows && rm -rf temp",
    # parser corners
    "echo \"$(echo ')'; git push)\"",
    "echo $( (git push) )",
    "git \\\npush",
    'echo "`git push`"',
    "cmd /d /c git push",
    "bash -x -c 'git push'",
    "rm -r $HOME/x",
    "rm -r -- src",
    "git -C $TEAMGATE_SURELY_UNSET status",
    "cd $TEAMGATE_SURELY_UNSET && ls",
    # neighbours of the allowed forms: they must stay refused
    'cd "$TEAM_RUN_DIR" && bash -c "rm -r ../../src"',
    "git branch -d {team}/T1 ../main",
    'git worktree remove "$TEAM_RUN_DIR/worktrees/../../x"',
    'rm -rf "$TEAM_RUN_DIR/worktrees/T1/../T1"',
    # R1: words the check cannot resolve
    "$TEAMGATE_SURELY_UNSET push",
    "$'git' push",
    "/c/Program\\ Files/Git/cmd/gi? push",
    "g`echo i`t push",
    "git $TEAMGATE_SURELY_UNSET",
    'git "${args[@]}"',
    "git p*sh",
    "git branch -f fe* HEAD",
    "git -c $TEAMGATE_SURELY_UNSET commit -m x",
    "gh $TEAMGATE_SURELY_UNSET merge 5",
    # R2: launchers
    "timeout 5 git push",
    "timeout -s KILL 5 git push",
    "xargs -I X git push",
    "stdbuf -oL git push",
    "sudo -u x git push",
    "watch -n 1 'git push'",
    "eval 'git push'",
    "source x.sh",
    ". x.sh",
    "find src -exec rm -rf {} \\;",
    "find . -execdir git push \\;",
    # R3: commands from stdin
    "echo 'git push' | bash",
    "cat x | sh -s",
    "bash < x.sh",
    "echo x | pwsh -Command -",
    "echo x | pwsh -",
    "pwsh -cwa 'git push'",
    "pwsh -CommandWithArgs 'git push'",
    # R4: git
    "git send-pack origin x",
    "git http-push x",
    "git checkout -B feat/x",
    "git switch -C feat/x",
    "git switch --force-create=feat/x",
    "git -c alias.p=push p",
    "git --config-env alias.p=X p",
    "GIT_DIR=x git status",
    "env GIT_CONFIG_COUNT=1 git commit -m x",
    "export GIT_CONFIG_PARAMETERS=x; git commit -m x",
    "git merge --no-verify x",
    "git merge --no-ver x",
    "git am --no-verify x",
    # R5: variables assigned in the same command
    'TEAM_RUN_DIR=/c; rm -rf "$TEAM_RUN_DIR/evidence"',
    'export TEAM_RUN_DIR={repo}; git -C "$TEAM_RUN_DIR/worktrees/T1" reset --hard',
    # R6: gh
    "gh -R o/r pr merge 5",
    "gh pr --repo o/r merge 5",
    "gh --repo=o/r pr merge 5",
    "gh --hostname h pr merge 5",
    "gh api -X POST repos/o/r/issues",
    "gh api --method=DELETE repos/o/r/git/refs/heads/x",
    "gh api -XPATCH repos/o/r",
    "gh api repos/o/r/issues -f title=x",
    "gh api repos/o/r/issues -Ftitle=x",
    "gh api repos/o/r/issues --raw-field title=x",
    "gh api repos/o/r/issues --input body.json",
    "gh alias set m 'pr merge'",
    "gh alias import x.yml",
    "rm -r $(pwd)/x",
    # fix round 2
    "git {push,status}",
    "{git,x} push",
    "git p{u..u}sh",
    "echo a | xargs git status",
    'echo a | xargs -n 1 rm -r "$TEAM_RUN_DIR/evidence"',
    'pwsh -c "$x"',
    "for TEAM_RUN_DIR in /c; do rm -rf \"$TEAM_RUN_DIR/evidence\"; done",
    'read -r TEAM_RUN_DIR < f; rm -rf "$TEAM_RUN_DIR/evidence"',
    'local TEAM_RUN_DIR; rm -rf "$TEAM_RUN_DIR/evidence"',
    "for GIT_DIR in x; do git status; done",
    "git checkout -fB feat/x",
    "git switch -fC feat/x",
    "git pull --no-verify",
    "git pull --no-ver",
    "git commit $x",
    # fix round 3
    "while read -r GIT_DIR; do git status; done < f",
    'if read -r TEAM_RUN_DIR < f; then rm -rf "$TEAM_RUN_DIR/x"; fi',
    'for x in a; do local TEAM_RUN_DIR; rm -rf "$TEAM_RUN_DIR/evidence"; done',
    'mapfile TEAM_RUN_DIR < f; rm -rf "$TEAM_RUN_DIR/evidence"',
    "readarray -t GIT_DIR < f; git status",
    'printf -v TEAM_RUN_DIR %s /c; rm -rf "$TEAM_RUN_DIR/evidence"',
    "select GIT_DIR in x; do git status; done",
    "git pull -t $x",
    "git merge --squash $x",
    # fix round 4: decided on parsed words, in any order
    'git log | while read -r l; do echo "$l"; done',
    "f() { git status; }; read GIT_DIR < x; f",
    "read GIT_DIR < x; g''it status",
    "time read GIT_DIR < x; git status",
    "coproc read GIT_DIR; git status",
    "getopts ab GIT_DIR; git status",
    "read GIT_DIR < x; bash -c 'git status'",
]

ALLOW_BASH = [
    "git status",
    'echo "git push"',
    "git log --oneline -3",
    'git commit -m "handle -n in the parser"',
    "git commit -m -n",
    "git commit --message -n",
    "git commit -uno -m x",
    "git commit --no-edit --amend",
    "git commit -am x",
    "git -c user.name=x commit -m y",
    "git config --get core.hooksPath",
    "git branch -d {team}/T1",
    'git branch --delete-merged refs/heads/feat/x "{team}/*"',
    "git branch --dry-run --delete-merged refs/heads/feat/x '{team}/*'",
    "git branch -f other HEAD",
    "git branch --list '{team}/*'",
    "git branch -m old new",
    "git branch -u origin/x",
    'git worktree remove "{wt}"',
    'git worktree remove "$TEAM_RUN_DIR/worktrees/T1"',
    'git worktree add --detach "$TEAM_RUN_DIR/worktrees/scratch-B1" feat/x',  # the verifier's scratch copy
    'git worktree remove "$TEAM_RUN_DIR/worktrees/scratch-B1"',
    "git worktree list",
    "git clean -n",
    "git clean -f",
    'git -C "{wt}" reset --hard HEAD',
    'rm -r "$TEAM_RUN_DIR/evidence"',
    "rm -rf $TEAM_RUN_DIR/verdicts",
    "rm file.txt",
    "rm -f a b",
    'rm "{repo}/.team-runs/.gitignore"',
    'rmdir "{repo}/.team-runs"',
    "cd $TEAM_RUN_DIR && rm -rf evidence",
    "find . -name x",
    "gh pr view 5",
    "gh api repos/o/r/pulls/5",
    "ls -la # git push",
    "echo hi > out.txt 2>&1",
    "echo x &> log",
    # parser corners
    'echo "say \\"git push\\""',
    "echo x >out.txt",
    "cmd /?",
    "bash script.sh",
    "env",
    "git clean -n -- -x",
    "git branch --list -- --delete",
    "git branch -d --contains main {team}/T1",
    "git --version",
    "git commit -m x -- --no-verify",
    "git reset --soft HEAD~1",
    "echo $(git status)",
    "bash -c 'git status'",
    "cd && ls",
    # neighbours of the fix-round rules
    "[ -f x ] && echo y",
    "$HOME/bin/tool status",
    "git commit -m '$x *'",
    "timeout 5 git status",
    "xargs -n 1 echo",
    "nice -n 5 git status",
    "find . -exec cat {} \\;",
    "watch -n 1 'git status'",
    "echo x | bash script.sh",
    "git checkout -B other",
    "git switch -C other",
    "git merge x",
    "git log",
    'X=1; rm -rf "$TEAM_RUN_DIR/evidence"',
    "gh api repos/o/r/pulls",
    "gh api -X GET repos/o/r/pulls",
    "gh api --method get repos/o/r/pulls",
    "gh pr view 5 -R o/r",
    "gh alias list",
    "rm -rf ${TEAM_RUN_DIR}/evidence",
    "git checkout -- -Bfeat/x",
    "{ git status; }",
    "find . -exec echo {} \\;",
    "echo ${HOME}",
    "git rev-parse HEAD^{tree}",
    "git log @{u}..HEAD",
    "echo a | xargs -n 1 echo",
    "pwsh -c 'git status'",
    'git commit -m "fix $x"',
    "git checkout -fb other",
    "git pull",
    "for f in a b; do echo $f; done",
    'while read -r l; do echo "$l"; done < f',
    "x=$(git rev-parse HEAD)",
    'git commit -m "msg $x"',
    'for f in a b; do cat "$f"; done',
    "echo $(read GIT_DIR < x); git status",
    'git merge -m "fix $x" topic',
    "pwsh -CommandWithArgs 'git status'",
]


@pytest.mark.parametrize("line", DENY_BASH)
def test_bash_lines_that_are_refused(world: World, wt: Path, line: str) -> None:
    assert check(world, fill(line, world, wt), tc.BASH) is not None


@pytest.mark.parametrize("line", ALLOW_BASH)
def test_bash_lines_that_go_through(world: World, wt: Path, line: str) -> None:
    assert check(world, fill(line, world, wt), tc.BASH) is None


def _encoded(command: str) -> str:
    return base64.b64encode(command.encode("utf-16-le")).decode("ascii")


DENY_PWSH = [
    "git push",
    "& git push",
    '& "C:/Program Files/Git/cmd/git.exe" push',
    ". git push",
    'iex "git push"',
    "Invoke-Expression 'git push'",
    "Invoke-Expression -Command 'git push'",
    "Start-Process git -ArgumentList push",
    "Start-Process -FilePath git -ArgumentList 'push','origin'",
    'Start-Process -FilePath "C:/Program Files/Git/cmd/git.exe" -ArgumentList push',
    'powershell -c "git push"',
    f"pwsh -EncodedCommand {_encoded('git push')}",
    f"pwsh -enc {_encoded('git push')}",
    "$x = $(git push)",
    'Write-Host "$(git push)"',
    "if ($true) { git push }",
    "git status; git push",
    "git status && git push",
    "git commit -n -m x",
    "Remove-Item -Recurse src",
    "Remove-Item src -r",
    "ri src -Rec",
    "del src -recurse",
    "rm src -Recurse:$true",
    "rd src -Recurse",
    "Remove-Item -Path src,lib -Recurse",
    "Get-ChildItem src -Recurse | Remove-Item",
    "gci -r src | ri",
    "[IO.Directory]::Delete('C:/x', $true)",
    '[System.IO.Directory]::Delete("$env:TEAM_RUN_DIR/worktrees/T1", $true)',
    'Remove-Item "$env:TEAM_RUN_DIR" -Recurse -Force',
    "Remove-Item $env:TEAMGATE_SURELY_UNSET -Recurse",
    "Get-ChildItem | ForEach-Object { Remove-Item $_ -Recurse }",
    "Set-Location C:/Windows; Remove-Item -Recurse temp",
    "Start-Process -WindowStyle Hidden git -ArgumentList push",
    "Start-Process -NoNewWindow -FilePath git -ArgumentList push",
    "Start-Process git push",
    'Remove-Item -Recurse "$env:TEAM_RUN_DIR/../.."',
    # fix round
    "& $git push",
    "& (Get-Command git) push",
    ". (Get-Command git) push",
    "git @a",
    "git $sub",
    "Invoke-Command -ScriptBlock $sb",
    "Start-Job -FilePath x.ps1",
    "[scriptblock]::Create('git push').Invoke()",
    "'git push' | iex",
    "'git push' | Invoke-Expression",
    "pwsh -cwa 'git push'",
    "pwsh -File -",
    # fix round 2
    "iex $cmd",
    "Invoke-Expression $(Get-Content x)",
    "pwsh -Command $cmd",
    "Set-Item env:TEAM_RUN_DIR C:/; Remove-Item -Recurse \"$env:TEAM_RUN_DIR/evidence\"",
    "Set-Variable -Name GIT_DIR -Value x; git status",
    "[Environment]::SetEnvironmentVariable('GIT_DIR', 'x'); git status",
    "[Environment]::SetEnvironmentVariable($n, 'x'); Remove-Item -Recurse \"$env:TEAM_RUN_DIR/evidence\"",
    "sv $n x; git status",
    # fix round 5: every PowerShell setter is unparsed, also from a nested scope
    "Set-Item env:FOO x; git status",
    "sv name x; git status",
    "[Environment]::SetEnvironmentVariable('FOO', 'x'); git status",
    "[Environment]::SetEnvironmentVariable(('GIT' + '_DIR'), 'x'); git status",
    "New-Item -Path env: -Name GIT_DIR -Value x; git status",
    "Set-Content env:GIT_DIR x; git status",
    "Remove-Item env:GIT_DIR; git status",
    "$x = $(sv $n y); git status",
    "& { sv $n y }; git status",
    "${env:GIT_DIR}='x'; git status",
    "$env:GIT_CONFIG_GLOBAL = 'x'; git commit -m y",
    "$env:TEAM_RUN_DIR = 'C:/'; Remove-Item -Recurse \"$env:TEAM_RUN_DIR/evidence\"",
]

ALLOW_PWSH = [
    "git status",
    "Write-Host 'git push'",
    "Write-Host 'Remove-Item -Recurse x'",
    "Get-ChildItem -Recurse src | Select-Object Name",
    "Remove-Item file.txt",
    'Remove-Item "$env:TEAM_RUN_DIR/evidence" -Recurse',
    'rmdir "{repo}/.team-runs"',
    "[IO.Directory]::Delete('C:/x', $false)",
    "Start-Process notepad",
    "git commit -m 'it''s fine'",
    "& git status",
    "pwsh -File build.ps1",
    "Start-Process",
    '[IO.Directory]::Delete("$env:TEAM_RUN_DIR/evidence", $true)',
    "Get-ChildItem *.tmp | Remove-Item",
    # fix round
    "$x = 1",
    "if ($LASTEXITCODE) { exit 1 }",
    "& 'C:/Program Files/Git/cmd/git.exe' status",
    "pwsh -File build.ps1 -x",
    "pwsh build.ps1",
    "git commit -m \"user@host\"",
    "pwsh -cwa 'git status'",
    "git log @{u}..HEAD",
    "$x = $(git rev-parse HEAD)",
    "$env:FOO = 'x'; git status",
]


@pytest.mark.parametrize("line", DENY_PWSH)
def test_powershell_lines_that_are_refused(world: World, wt: Path, line: str) -> None:
    assert check(world, fill(line, world, wt), tc.PWSH) is not None


@pytest.mark.parametrize("line", ALLOW_PWSH)
def test_powershell_lines_that_go_through(world: World, wt: Path, line: str) -> None:
    assert check(world, fill(line, world, wt), tc.PWSH) is None


def test_reset_hard_is_free_in_the_own_worktree(world: World, wt: Path) -> None:
    assert check(world, "git reset --hard HEAD", tc.BASH, cwd=wt) is None


def test_reset_hard_is_free_on_a_detached_head(world: World) -> None:
    sh(world.repo, "switch", "-q", "--detach")
    assert check(world, "git reset --hard", tc.BASH) is None


def test_the_run_folder_may_go_once_its_worktrees_are_gone(world: World) -> None:
    assert check(world, 'rm -rf "$TEAM_RUN_DIR"', tc.BASH) is None
    assert check(world, 'Remove-Item -Recurse -Force "$env:TEAM_RUN_DIR"', tc.PWSH) is None


def test_without_a_known_feature_branch_force_and_reset_fail_closed(world: World, wt: Path) -> None:
    ctx = tc.Context(world.run, world.repo, None)
    assert tc.check_command("git branch -f other HEAD", tc.BASH, ctx) is not None
    assert tc.check_command("git reset --hard", tc.BASH, tc.Context(world.run, wt, None)) is not None
    assert tc.check_command("git checkout -B other", tc.BASH, ctx) is not None


def test_a_git_alias_is_refused(world: World) -> None:
    sh(world.repo, "config", "alias.pp", "push")
    assert check(world, "git pp", tc.BASH) == "git alias pp: cannot tell what it runs"
    assert check(world, "git status", tc.BASH) is None


def test_reset_hard_with_another_git_dir_fails_closed(world: World, wt: Path) -> None:
    assert check(world, "git --work-tree=. reset --hard", tc.BASH, cwd=wt) is not None
    assert check(world, "git --git-dir .git reset --hard", tc.BASH, cwd=wt) is not None


def test_a_hanging_alias_lookup_is_refused(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    def hang(*args: object, **kwargs: object) -> NoReturn:
        raise subprocess.TimeoutExpired("git", tc.ALIAS_TIMEOUT)

    monkeypatch.setattr(subprocess, "run", hang)
    assert check(world, "git status", tc.BASH) == "git alias lookup timed out"


def test_a_delete_target_resolves_an_environment_variable(world: World, monkeypatch: pytest.MonkeyPatch) -> None:
    # The value decides: the same line is allowed inside the run folder and refused outside it.
    monkeypatch.setenv("TEAMGATE_PROBE_DIR", str(world.run.dir))
    assert check(world, 'rm -r "$TEAMGATE_PROBE_DIR/evidence"', tc.BASH) is None
    monkeypatch.setenv("TEAMGATE_PROBE_DIR", str(world.repo))
    assert check(world, 'rm -r "$TEAMGATE_PROBE_DIR/evidence"', tc.BASH) is not None


def test_unknown_assignments_have_their_own_reason(world: World) -> None:
    assert check(world, "read -r x < f; git status", tc.BASH) == "cannot tell which variables this command sets"


def test_cd_into_the_repo_is_followed(world: World, wt: Path) -> None:
    assert check(world, fill('cd "{repo}" && git reset --hard', world, wt), tc.BASH, cwd=wt) is not None


@pytest.mark.parametrize("line", ["echo 'open", 'echo "open', "echo `open", "echo $(open", '"$(open"', 'echo "`open"'])
def test_a_line_that_does_not_parse_is_an_error(world: World, line: str) -> None:
    with pytest.raises(GateError):
        check(world, line, tc.BASH)


def test_a_broken_encoded_command_is_an_error(world: World) -> None:
    with pytest.raises(GateError, match="EncodedCommand"):
        check(world, "pwsh -e !!!", tc.PWSH)


def test_launchers_nested_too_deep_are_refused(world: World) -> None:
    deep = "git status"
    for _ in range(10):
        deep = "iex '" + deep.replace("'", "''") + "'"
    assert check(world, deep, tc.PWSH) == "command nests launchers too deeply to check"
    assert check(world, "bash -c 'bash -c \"bash -c true\"'", tc.BASH) is None


# --- hook entry ------------------------------------------------------------


def test_on_pre_tool_use_reads_the_payload(world: World) -> None:
    payload = {"tool_name": "Bash", "tool_input": {"command": "git push"}, "cwd": world.repo.as_posix()}
    assert tc.on_pre_tool_use(world.run, payload) == ["git push is the human's"]
    payload = {"tool_name": "PowerShell", "tool_input": {"command": "git status"}}
    assert tc.on_pre_tool_use(world.run, payload) == []


@pytest.mark.parametrize(
    "payload",
    [{"tool_name": "Read", "tool_input": {}}, {"tool_name": "Bash"}, {"tool_name": "Bash", "tool_input": {"command": 1}}],
)
def test_on_pre_tool_use_ignores_other_tools(world: World, payload: dict[str, object]) -> None:
    assert tc.on_pre_tool_use(world.run, payload) == []


def test_on_pre_tool_use_works_without_the_run_folder(world: World) -> None:
    shutil.rmtree(world.run.dir)
    payload = {"tool_name": "Bash", "tool_input": {"command": "git branch -f other HEAD"}, "cwd": str(world.repo)}
    assert tc.on_pre_tool_use(world.run, payload) == ["git branch --force must not move the feature branch"]


@pytest.mark.skipif(sys.platform != "win32", reason="junctions are a Windows feature")
def test_a_junction_is_judged_by_its_target(world: World, tmp_path: Path) -> None:
    inside, outside = tmp_path / "into-run", tmp_path / "into-repo"
    (world.repo / "src").mkdir()
    for link, target in ((inside, world.run.dir / "evidence"), (outside, world.repo / "src")):
        subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], check=True, capture_output=True)
    assert check(world, f'rm -r "{inside.as_posix()}/scratch"', tc.BASH) is None
    assert check(world, f'rm -r "{outside.as_posix()}"', tc.BASH) == f"recursive delete outside the run folder: {outside.as_posix()}"


def test_paths_on_two_drives_are_not_within_each_other() -> None:
    assert tc.within(Path("C:/a"), Path("D:/a")) is False


def test_nested_scan_too_deep_counts_as_guarded() -> None:
    assert tc._nested_scan([(tc.BASH, "true")], tc.BASH, 9) == (True, True)
