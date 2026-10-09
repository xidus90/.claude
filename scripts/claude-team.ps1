# Start, resume or clean up an agent-team run of a committed plan.
# Spec: docs/.superpowers/specs/2026-10-08-agent-team-design.md, section 7.
#
#   claude-team.ps1 <plan>              new run on the current (feature) branch
#   claude-team.ps1 -Resume <run>       next generation of a run whose lead died
#   claude-team.ps1 -Cleanup <run>      tidy away a run nobody will resume
#
# Dot-source with -DotSourceOnly to get the functions without running.
[CmdletBinding(DefaultParameterSetName = 'New')]
param(
    [Parameter(Position = 0)][string]$Plan,
    [string]$Resume,
    [string]$Cleanup,
    [switch]$DotSourceOnly
)

$ErrorActionPreference = 'Stop'

$script:MinimumGit = [version]'2.56.0'
$script:GatePath = (Join-Path $PSScriptRoot 'team-gate.py') -replace '\\', '/'
# Next to the scripts, not under ~/.claude: a run from a worktree of this repo
# then reads the rules of that worktree.
$script:VerdictRules = (Join-Path (Split-Path -Parent $PSScriptRoot) 'docs/agent-team/verdicts.md') -replace '\\', '/'

function Get-GitVersion {
    [OutputType([version])]
    param()
    $text = git --version
    if ($text -notmatch '(\d+)\.(\d+)\.(\d+)') { throw "cannot read the git version from: $text" }
    return [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])"
}

function Get-RepoRoot {
    [OutputType([string])]
    param()
    $root = git rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'claude-team must run inside a git repository' }
    return $root
}

function Test-TeamPrerequisite {
    <#
        Reasons that refuse the start; an empty list lets it go ahead. A
        resumed run only warns about a dirty tree: the dead lead may have
        left it so, and the new lead reads it.
    #>
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][string]$Repo,
        [AllowEmptyString()][string]$Plan,
        [switch]$New
    )
    $reasons = [System.Collections.Generic.List[string]]::new()
    $git = Get-GitVersion
    if ($git -lt $script:MinimumGit) {
        $reasons.Add("git $git is too old; the run needs git $($script:MinimumGit) for branch --delete-merged")
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Repo '.claude/team-gate') -PathType Leaf)) {
        $reasons.Add('.claude/team-gate is missing: it names the gate command the verifier runs')
    }
    $dirty = @(git -C $Repo status --porcelain)
    if ($New) {
        if ($dirty.Count -gt 0) { $reasons.Add('the working tree is not clean') }
        git -C $Repo ls-files --error-unmatch -- $Plan 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { $reasons.Add("the plan $Plan is not committed on the current branch") }
    } elseif ($dirty.Count -gt 0) {
        Write-Warning 'the working tree is not clean; the new lead will find it so'
    }
    return @($reasons)
}

function New-TeamRun {
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$Plan,
        [Parameter(Mandatory)][string]$Name
    )
    $runs = Join-Path $Repo '.team-runs'
    $run = Join-Path $runs $Name
    foreach ($sub in 'verdicts', 'evidence', 'worktrees') {
        New-Item -ItemType Directory -Path (Join-Path $run $sub) -Force | Out-Null
    }
    # git ignores the folder and this file with it; nothing outside is touched.
    $ignore = Join-Path $runs '.gitignore'
    if (-not (Test-Path -LiteralPath $ignore)) { [System.IO.File]::WriteAllText($ignore, "*`n") }
    $meta = [ordered]@{
        plan           = $Plan -replace '\\', '/'
        repo           = $Repo -replace '\\', '/'
        feature_branch = (git -C $Repo branch --show-current)
        claude_version = (Get-ClaudeVersion)
        git_version    = [string](Get-GitVersion)
        generation     = 1
    }
    Write-RunJson -Run $run -Meta $meta
    return $run
}

function Get-ClaudeVersion {
    [OutputType([string])]
    param()
    return (claude --version) -replace ' \(Claude Code\)', ''
}

function Read-RunJson {
    param([Parameter(Mandatory)][string]$Run)
    return Get-Content -LiteralPath (Join-Path $Run 'run.json') -Raw | ConvertFrom-Json -AsHashtable
}

function Write-RunJson {
    param([Parameter(Mandatory)][string]$Run, [Parameter(Mandatory)]$Meta)
    $json = $Meta | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText((Join-Path $Run 'run.json'), $json + "`n")
}

function Get-SettingsPath {
    [OutputType([string])]
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$Name)
    $home_ = [Environment]::GetFolderPath('UserProfile')
    return Join-Path $home_ ".claude/team-settings/$(Split-Path -Leaf $Repo)-$Name.json"
}

function New-TeamSettings {
    <#
        The run's own settings file. Outside the run folder, because the
        cleaner deletes that; the hooks and the team switch live only here,
        so no other session ever loads them.
    #>
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$Run,
        [Parameter(Mandatory)][string]$Name
    )
    $runSlash = $Run -replace '\\', '/'
    function hook([string]$event) {
        @{ type = 'command'; timeout = 30; command = "uv run --script `"$($script:GatePath)`" --run `"$runSlash`" $event" }
    }
    $deny = foreach ($tool in 'Bash', 'PowerShell') {
        foreach ($cmd in 'git push', 'gh pr merge', 'git commit --no-verify') { "$tool($($cmd):*)" }
    }
    $settings = [ordered]@{
        env         = [ordered]@{
            CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
            CLAUDE_CODE_ENABLE_TODO_TOOLS        = '1'
            TEAM_RUN_DIR                         = $runSlash
        }
        hooks       = [ordered]@{
            TaskCreated   = @(@{ hooks = @(hook 'task-created') })
            TaskCompleted = @(@{ hooks = @(hook 'task-completed') })
            PostToolUse   = @(@{ matcher = 'TaskUpdate'; hooks = @(hook 'post-task-update') })
            PreToolUse    = @(@{ matcher = 'Bash|PowerShell'; hooks = @(hook 'pre-tool-use') })
        }
        permissions = @{ deny = @($deny) }
    }
    $path = Get-SettingsPath -Repo $Repo -Name $Name
    New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
    [System.IO.File]::WriteAllText($path, ($settings | ConvertTo-Json -Depth 8) + "`n")
    return $path
}

function Get-LeadArgument {
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][string]$Run,
        [Parameter(Mandatory)][string]$Settings,
        [Parameter(Mandatory)]$Meta
    )
    $prompt = "Run the agent-team plan $($Meta.plan). Run folder: $($Run -replace '\\', '/'). " +
        "Generation: $($Meta.generation). Feature branch: $($Meta.feature_branch). " +
        "Verdict rules: $($script:VerdictRules). Follow your orchestrator instructions."
    return @('--agent', 'orchestrator', '--teammate-mode', 'in-process', '--add-dir', $Run, '--settings', $Settings, $prompt)
}

function Invoke-ClaudeProcess {
    # The one place that starts claude; tests replace it.
    param([string[]]$ArgumentList)
    & claude @ArgumentList
    return $LASTEXITCODE
}

function Invoke-WithoutEffortOverride {
    <#
        CLAUDE_CODE_EFFORT_LEVEL would override the effort of every role
        definition. Removed for the child only: the caller's environment is
        exactly as before once claude ends, even if it throws.
    #>
    param([Parameter(Mandatory)][string[]]$ArgumentList)
    $saved = [Environment]::GetEnvironmentVariable('CLAUDE_CODE_EFFORT_LEVEL', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('CLAUDE_CODE_EFFORT_LEVEL', $null, 'Process')
        return Invoke-ClaudeProcess -ArgumentList $ArgumentList
    } finally {
        [Environment]::SetEnvironmentVariable('CLAUDE_CODE_EFFORT_LEVEL', $saved, 'Process')
    }
}

function Get-CleanupLeftover {
    <# What a finished cleanup must not leave behind (spec section 8, step 4). #>
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$Name,
        [AllowEmptyCollection()][string[]]$Allowed = @()
    )
    $run = Join-Path $Repo ".team-runs/$Name"
    $prefix = ((Join-Path $run 'worktrees') -replace '\\', '/').ToLowerInvariant()
    $left = foreach ($line in @(git -C $Repo worktree list --porcelain)) {
        if ($line -like 'worktree *') {
            $path = $line.Substring(9)
            if ($path.ToLowerInvariant().StartsWith($prefix)) { "worktree $path" }
        }
    }
    $branches = @(git -C $Repo branch --list "team/$Name/*" --format='%(refname:short)')
    $left = @($left) + @($branches | Where-Object { $_ -and $Allowed -notcontains $_ } | ForEach-Object { "branch $_" })
    if (Test-Path -LiteralPath $run) { $left += "folder $run" }
    return @($left)
}

function Remove-ClosedSettings {
    param([Parameter(Mandatory)][string]$Settings, [Parameter(Mandatory)][string]$Run)
    if (-not (Test-Path -LiteralPath $Run) -and (Test-Path -LiteralPath $Settings)) {
        Remove-Item -LiteralPath $Settings
    }
}

function Invoke-ClaudeTeam {
    [OutputType([int])]
    param([string]$Plan, [string]$Resume, [string]$Cleanup)

    $repo = Get-RepoRoot
    $chosen = @($Plan, $Resume, $Cleanup | Where-Object { $_ }).Count
    if ($chosen -ne 1) {
        Write-Host 'usage: claude-team.ps1 <plan> | -Resume <run> | -Cleanup <run>' -ForegroundColor Red
        return 2
    }

    if ($Cleanup) {
        $run = Join-Path $repo ".team-runs/$Cleanup"
        $settings = Get-SettingsPath -Repo $repo -Name $Cleanup
        $meta = Read-RunJson -Run $run
        $keep = @(git -C $repo branch --no-merged $meta.feature_branch --list "team/$Cleanup/*" --format='%(refname:short)')
        $prompt = "Clean up the agent-team run $Cleanup in $($repo -replace '\\', '/'). Feature branch: $($meta.feature_branch). " +
            "Unmerged branches to keep and report: $(if ($keep) { $keep -join ', ' } else { 'none' })."
        Invoke-WithoutEffortOverride -ArgumentList @('-p', '--agent', 'cleaner', '--settings', $settings,
            '--permission-mode', 'auto', $prompt) | Out-Null
        $left = @(Get-CleanupLeftover -Repo $repo -Name $Cleanup -Allowed $keep)
        Remove-ClosedSettings -Settings $settings -Run $run
        if ($left.Count -gt 0) {
            $left | ForEach-Object { Write-Host "left behind: $_" -ForegroundColor Red }
            return 1
        }
        return 0
    }

    $reasons = @(Test-TeamPrerequisite -Repo $repo -Plan $Plan -New:([bool]$Plan))
    if ($reasons.Count -gt 0) {
        $reasons | ForEach-Object { Write-Host "claude-team: $_" -ForegroundColor Red }
        return 1
    }

    if ($Resume) {
        $name = $Resume
        $run = Join-Path $repo ".team-runs/$name"
        $meta = Read-RunJson -Run $run
        $meta.generation = [int]$meta.generation + 1
        Write-RunJson -Run $run -Meta $meta
    } else {
        $name = Get-Date -Format 'yyyyMMdd-HHmmss'
        $run = New-TeamRun -Repo $repo -Plan $Plan -Name $name
        $meta = Read-RunJson -Run $run
    }
    $settings = New-TeamSettings -Repo $repo -Run $run -Name $name
    $code = Invoke-WithoutEffortOverride -ArgumentList (Get-LeadArgument -Run $run -Settings $settings -Meta $meta)
    Remove-ClosedSettings -Settings $settings -Run $run
    return $code
}

if (-not $DotSourceOnly) {
    exit (Invoke-ClaudeTeam -Plan $Plan -Resume $Resume -Cleanup $Cleanup)
}
