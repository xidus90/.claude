BeforeAll {
    $script:ScriptDir = Split-Path -Parent $PSScriptRoot
    . (Join-Path $script:ScriptDir 'claude-team.ps1') -DotSourceOnly

    function New-TestRepo {
        param([string]$Name = 'proj')
        $repo = Join-Path $TestDrive "$Name-$([guid]::NewGuid().ToString('N').Substring(0, 6))"
        New-Item -ItemType Directory -Path $repo | Out-Null
        git -C $repo init -q -b main
        git -C $repo config user.email t@example.org
        git -C $repo config user.name T
        New-Item -ItemType Directory -Path (Join-Path $repo '.claude') | Out-Null
        Set-Content -LiteralPath (Join-Path $repo '.claude/team-gate') -Value 'pwsh -File gate.ps1'
        New-Item -ItemType Directory -Path (Join-Path $repo 'docs') | Out-Null
        Set-Content -LiteralPath (Join-Path $repo 'docs/plan.md') -Value '# Plan'
        git -C $repo add -A
        git -C $repo commit -q -m init
        git -C $repo switch -q -c feat/x
        return ($repo -replace '\\', '/')
    }
}

Describe 'Get-GitVersion' {
    It 'reads a Windows build string' {
        Mock git { 'git version 2.54.0.vfs.0.4' }
        Get-GitVersion | Should -Be ([version]'2.54.0')
    }
    It 'throws on a string without a version' {
        Mock git { 'nothing here' }
        { Get-GitVersion } | Should -Throw '*cannot read the git version*'
    }
}

Describe 'Test-TeamPrerequisite' {
    BeforeEach {
        $script:Repo = New-TestRepo
        Mock Get-GitVersion { [version]'2.56.0' }
        Mock Resolve-ClaudeExecutable { 'C:/fake/claude.exe' }
    }

    It 'refuses a machine without claude.exe' {
        Mock Resolve-ClaudeExecutable { $null }
        Test-TeamPrerequisite -Repo $Repo -Plan 'docs/plan.md' -New | Should -Match 'claude.exe not found'
    }
    It 'lets a clean repo with a committed plan through' {
        @(Test-TeamPrerequisite -Repo $Repo -Plan 'docs/plan.md' -New) | Should -HaveCount 0
    }
    It 'refuses git older than 2.56' {
        Mock Get-GitVersion { [version]'2.54.0' }
        Test-TeamPrerequisite -Repo $Repo -Plan 'docs/plan.md' -New | Should -Match 'git 2.54.0 is too old'
    }
    It 'refuses a repo without .claude/team-gate' {
        git -C $Repo rm -q .claude/team-gate
        git -C $Repo commit -q -m 'drop gate'
        Test-TeamPrerequisite -Repo $Repo -Plan 'docs/plan.md' -New | Should -Match 'team-gate is missing'
    }
    It 'refuses a dirty tree for a new run' {
        Set-Content -LiteralPath "$Repo/loose.txt" -Value x
        Test-TeamPrerequisite -Repo $Repo -Plan 'docs/plan.md' -New | Should -Match 'not clean'
    }
    It 'refuses a plan that is not committed' {
        Test-TeamPrerequisite -Repo $Repo -Plan 'docs/other.md' -New | Should -Match 'is not committed'
    }
    It 'only warns about a dirty tree on resume' {
        Set-Content -LiteralPath "$Repo/loose.txt" -Value x
        @(Test-TeamPrerequisite -Repo $Repo -WarningVariable warned -WarningAction SilentlyContinue) | Should -HaveCount 0
        $warned | Should -Match 'not clean'
    }
}

Describe 'New-TeamRun' {
    BeforeEach {
        $script:Repo = New-TestRepo
        Mock Get-GitVersion { [version]'2.56.0' }
        Mock Get-ClaudeVersion { '2.1.293' }
    }

    It 'builds the run folder and leaves git status empty' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name '20261008-120000'
        foreach ($sub in 'verdicts', 'evidence', 'worktrees') { Join-Path $run $sub | Should -Exist }
        Get-Content -LiteralPath "$Repo/.team-runs/.gitignore" -Raw | Should -Be "*`n"
        @(git -C $Repo status --porcelain) | Should -HaveCount 0
    }
    It 'writes run.json with generation 1 and the feature branch' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1'
        $meta = Read-RunJson -Run $run
        $meta.generation | Should -Be 1
        $meta.feature_branch | Should -Be 'feat/x'
        $meta.plan | Should -Be 'docs/plan.md'
        $meta.claude_version | Should -Be '2.1.293'
        $meta.git_version | Should -Be '2.56.0'
    }
    It 'keeps an existing .gitignore' {
        New-Item -ItemType Directory -Path "$Repo/.team-runs" | Out-Null
        [System.IO.File]::WriteAllText("$Repo/.team-runs/.gitignore", "*`n# mine`n")
        New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1' | Out-Null
        Get-Content -LiteralPath "$Repo/.team-runs/.gitignore" -Raw | Should -Match '# mine'
    }
}

Describe 'New-TeamSettings' {
    BeforeAll {
        $script:Repo = New-TestRepo
        Mock Get-SettingsPath { Join-Path $TestDrive 'settings/proj-r1.json' }
        $script:Path = New-TeamSettings -Repo $Repo -Run "$Repo/.team-runs/r1" -Name 'r1'
        $script:Settings = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -AsHashtable
    }

    It 'switches teams and the task tools on and names the run folder' {
        $Settings.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS | Should -Be '1'
        $Settings.env.CLAUDE_CODE_ENABLE_TODO_TOOLS | Should -Be '1'
        $Settings.env.TEAM_RUN_DIR | Should -Be "$Repo/.team-runs/r1"
        $Settings.env.PYTHONDONTWRITEBYTECODE | Should -Be '1'
    }
    It 'wires every hook to team-gate with the run and a 30 s timeout' {
        $expect = @{ TaskCreated = 'task-created'; TaskCompleted = 'task-completed'; PostToolUse = 'post-task-update'; PreToolUse = 'pre-tool-use' }
        foreach ($event in $expect.Keys) {
            $hook = $Settings.hooks[$event][0].hooks[0]
            $hook.timeout | Should -Be 30
            $hook.command | Should -Match '^uv run --script ".*/team-gate\.py" --run ".*/\.team-runs/r1" '
            $hook.command | Should -Match "$($expect[$event])$"
        }
        $Settings.hooks.PostToolUse[0].matcher | Should -Be 'TaskUpdate'
        $Settings.hooks.PreToolUse[0].matcher | Should -Be 'Bash|PowerShell'
        $Settings.hooks.TaskCreated[0].ContainsKey('matcher') | Should -BeFalse
        $ask = $Settings.hooks.PostToolUse[1]
        $ask.matcher | Should -Be 'AskUserQuestion'
        $ask.hooks[0].timeout | Should -Be 30
        $ask.hooks[0].command | Should -Match '^uv run --script ".*/team-gate\.py" --run ".*/\.team-runs/r1" post-ask-user$'
    }
    It 'denies push, merge and --no-verify for Bash and PowerShell' {
        $Settings.permissions.deny | Should -HaveCount 6
        $Settings.permissions.deny | Should -Contain 'Bash(git push:*)'
        $Settings.permissions.deny | Should -Contain 'PowerShell(gh pr merge:*)'
        $Settings.permissions.deny | Should -Contain 'PowerShell(git commit --no-verify:*)'
    }
}

Describe 'Get-SettingsPath' {
    It 'lies under ~/.claude/team-settings and names repo and run' {
        $path = Get-SettingsPath -Repo 'C:/x/proj' -Name 'r1'
        $path | Should -BeLike "$([Environment]::GetFolderPath('UserProfile'))*team-settings*proj-r1.json"
    }
}

Describe 'Get-LeadArgument' {
    It 'starts the orchestrator in-process with the run folder, settings and session id' {
        $argv = Get-LeadArgument -Run 'C:/r' -Settings 'C:/s.json' -SessionId 'abc' -Meta @{ plan = 'p.md'; generation = 2; feature_branch = 'feat/x' }
        $argv[0..9] -join ' ' | Should -Be '--agent orchestrator --teammate-mode in-process --add-dir C:/r --settings C:/s.json --session-id abc'
        $argv[10] | Should -Match 'p\.md.*Run folder: C:/r.*Generation: 2.*Feature branch: feat/x.*Verdict rules: .*/docs/agent-team/verdicts\.md'
        $argv | Should -Not -Contain '--model'
    }
}

Describe 'Resolve-ClaudeExecutable' {
    BeforeEach { $script:SavedPath = $env:PATH }
    AfterEach { $env:PATH = $script:SavedPath }

    It 'finds the exe behind an npm shim' {
        $npm = Join-Path $TestDrive "npm-$([guid]::NewGuid().ToString('N').Substring(0, 6))"
        $bin = Join-Path $npm 'node_modules/@anthropic-ai/claude-code/bin'
        New-Item -ItemType Directory -Path $bin | Out-Null
        Set-Content -LiteralPath (Join-Path $npm 'claude.cmd') -Value '@echo off'
        Set-Content -LiteralPath (Join-Path $bin 'claude.exe') -Value ''
        $env:PATH = $npm
        Resolve-ClaudeExecutable | Should -Be (Join-Path $npm 'node_modules/@anthropic-ai/claude-code/bin/claude.exe')
    }
    It 'returns nothing when there is no claude' {
        $empty = Join-Path $TestDrive "empty-$([guid]::NewGuid().ToString('N').Substring(0, 6))"
        New-Item -ItemType Directory -Path $empty | Out-Null
        $env:PATH = $empty
        Resolve-ClaudeExecutable | Should -BeNullOrEmpty
    }
}

Describe 'Invoke-ClaudeProcess' {
    BeforeAll { $script:Pwsh = (Get-Command pwsh -CommandType Application | Select-Object -First 1).Source }

    It 'returns the exit code as one int even when the child prints' {
        $code = Invoke-ClaudeProcess -FilePath $Pwsh -ArgumentList @('-NoProfile', '-Command', 'Write-Output hi; exit 3')
        @($code) | Should -HaveCount 1
        $code | Should -BeOfType [int]
        $code | Should -Be 3
    }
    It 'passes an argument with spaces, quotes and umlauts intact' {
        $echo = Join-Path $TestDrive 'echo.ps1'
        $out = Join-Path $TestDrive 'echo.txt'
        Set-Content -LiteralPath $echo -Value 'Set-Content -LiteralPath $args[0] -Value $args[1] -Encoding utf8 -NoNewline'
        Invoke-ClaudeProcess -FilePath $Pwsh -ArgumentList @('-NoProfile', '-File', $echo, $out, 'a b "c" Prüf') | Should -Be 0
        Get-Content -LiteralPath $out -Raw -Encoding utf8 | Should -BeExactly 'a b "c" Prüf'
    }
}

Describe 'Invoke-WithoutEffortOverride' {
    It 'hides CLAUDE_CODE_EFFORT_LEVEL from claude and restores it' {
        $env:CLAUDE_CODE_EFFORT_LEVEL = 'max'
        try {
            Mock Invoke-ClaudeProcess { $script:Seen = $env:CLAUDE_CODE_EFFORT_LEVEL; 0 }
            Invoke-WithoutEffortOverride -ArgumentList @('x') | Should -Be 0
            $script:Seen | Should -BeNullOrEmpty
            $env:CLAUDE_CODE_EFFORT_LEVEL | Should -Be 'max'
        } finally { Remove-Item env:CLAUDE_CODE_EFFORT_LEVEL -ErrorAction SilentlyContinue }
    }
    It 'restores it when claude throws' {
        $env:CLAUDE_CODE_EFFORT_LEVEL = 'low'
        try {
            Mock Invoke-ClaudeProcess { throw 'boom' }
            { Invoke-WithoutEffortOverride -ArgumentList @('x') } | Should -Throw 'boom'
            $env:CLAUDE_CODE_EFFORT_LEVEL | Should -Be 'low'
        } finally { Remove-Item env:CLAUDE_CODE_EFFORT_LEVEL -ErrorAction SilentlyContinue }
    }
}

Describe 'Invoke-ClaudeTeam' {
    BeforeEach {
        $script:Repo = New-TestRepo
        Mock Get-GitVersion { [version]'2.56.0' }
        Mock Get-ClaudeVersion { '2.1.293' }
        Mock Get-SettingsPath { Join-Path $TestDrive "settings/$Name.json" }
        Mock Resolve-ClaudeExecutable { 'C:/fake/claude.exe' }
        Mock Invoke-ClaudeProcess { $script:Argv = $ArgumentList; 0 }
        Push-Location $Repo
    }
    AfterEach { Pop-Location }

    It 'refuses no or two modes' {
        Invoke-ClaudeTeam | Should -Be 2
        Invoke-ClaudeTeam -Plan 'docs/plan.md' -Resume 'r' | Should -Be 2
    }
    It 'starts a new run and keeps the settings while the run folder lives' {
        Invoke-ClaudeTeam -Plan 'docs/plan.md' | Should -Be 0
        $run = @(Get-ChildItem "$Repo/.team-runs" -Directory)[0]
        $Argv | Should -Contain '--agent'
        $Argv | Should -Contain $run.FullName
        Get-ChildItem (Join-Path $TestDrive 'settings') -Filter "$($run.Name).json" | Should -HaveCount 1
    }
    It 'stops before claude when a prerequisite fails' {
        Mock Get-GitVersion { [version]'2.54.0' }
        Invoke-ClaudeTeam -Plan 'docs/plan.md' | Should -Be 1
        Should -Invoke Invoke-ClaudeProcess -Times 0
        Test-Path "$Repo/.team-runs" | Should -BeFalse
    }
    It 'resumes with the next generation' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1'
        Invoke-ClaudeTeam -Resume 'r1' | Should -Be 0
        (Read-RunJson -Run $run).generation | Should -Be 2
        $Argv[-1] | Should -Match 'Generation: 2'
    }
    It 'gives the lead a fresh session id and records it in run.json' {
        Invoke-ClaudeTeam -Plan 'docs/plan.md' | Should -Be 0
        $run = @(Get-ChildItem "$Repo/.team-runs" -Directory)[0]
        $sessions = @((Read-RunJson -Run $run.FullName).sessions)
        $sessions | Should -HaveCount 1
        $sessions[0] | Should -Match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        $Argv[[array]::IndexOf($Argv, '--session-id') + 1] | Should -Be $sessions[0]
    }
    It 'appends the session of each resumed generation' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1'
        Invoke-ClaudeTeam -Resume 'r1' | Should -Be 0
        Invoke-ClaudeTeam -Resume 'r1' | Should -Be 0
        $sessions = @((Read-RunJson -Run $run).sessions)
        $sessions | Should -HaveCount 2
        $sessions[0] | Should -Not -Be $sessions[1]
        $Argv[[array]::IndexOf($Argv, '--session-id') + 1] | Should -Be $sessions[1]
    }
    It 'deletes the settings once the lead has cleaned the run away' {
        Remove-Item (Join-Path $TestDrive 'settings') -Recurse -Force -ErrorAction SilentlyContinue
        Mock Invoke-ClaudeProcess { Remove-Item -Recurse -Force "$Repo/.team-runs"; 0 }
        Invoke-ClaudeTeam -Plan 'docs/plan.md' | Should -Be 0
        @(Get-ChildItem (Join-Path $TestDrive 'settings') -ErrorAction SilentlyContinue | Where-Object Name -Like '2*') | Should -HaveCount 0
    }
    It 'cleans up through the cleaner and exits 0 when nothing is left' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1'
        Mock Invoke-ClaudeProcess { $script:Argv = $ArgumentList; Remove-Item -Recurse -Force $run; 0 }
        Invoke-ClaudeTeam -Cleanup 'r1' | Should -Be 0
        $Argv[0..2] -join ' ' | Should -Be '-p --agent cleaner'
        $Argv | Should -Contain 'auto'
        $Argv[-1] | Should -Match 'Unmerged branches to keep and report: none'
    }
    It 'exits 1 and names what the cleaner left' {
        $run = New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1'
        git -C $Repo worktree add -q --track -b team/r1/T1 "$run/worktrees/T1" feat/x
        git -C "$run/worktrees/T1" commit -q --allow-empty -m wip
        Invoke-ClaudeTeam -Cleanup 'r1' | Should -Be 1
        $left = @(Get-CleanupLeftover -Repo $Repo -Name 'r1' -Allowed @('team/r1/T1'))
        $left | Should -HaveCount 2
        $left[0] | Should -BeLike 'worktree *worktrees/T1'
        $left[1] | Should -BeLike 'folder *r1'
    }
    It 'refuses to clean up a run that does not exist' {
        Invoke-ClaudeTeam -Cleanup 'nope' | Should -Be 1
        Should -Invoke Invoke-ClaudeProcess -Times 0
    }
    It 'refuses to clean up with git older than 2.56' {
        New-TeamRun -Repo $Repo -Plan 'docs/plan.md' -Name 'r1' | Out-Null
        Mock Get-GitVersion { [version]'2.54.0' }
        Invoke-ClaudeTeam -Cleanup 'r1' | Should -Be 1
        Should -Invoke Invoke-ClaudeProcess -Times 0
    }
    It 'stores the plan relative to the repo when started from a subfolder' {
        Push-Location "$Repo/docs"
        try { Invoke-ClaudeTeam -Plan 'plan.md' | Should -Be 0 } finally { Pop-Location }
        $run = @(Get-ChildItem "$Repo/.team-runs" -Directory)[0]
        (Read-RunJson -Run $run.FullName).plan | Should -Be 'docs/plan.md'
    }
    It 'leaves the caller environment as it was' {
        $before = (Get-ChildItem env: | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join "`n"
        Invoke-ClaudeTeam -Plan 'docs/plan.md' | Out-Null
        (Get-ChildItem env: | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join "`n" | Should -Be $before
    }
}
