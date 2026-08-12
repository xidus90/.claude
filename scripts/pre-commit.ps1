# Git pre-commit hook: refuse commits that would put a secret into history.
# Dot-source with -DotSourceOnly to get Find-Secret without running the hook.
[CmdletBinding()]
param([switch]$DotSourceOnly)

$ErrorActionPreference = 'Stop'

# Paths whose whole purpose is to contain secret-shaped strings: the hook's
# own test fixtures, and the plan that quotes them.
$script:SecretScanExclusions = @(
    'scripts/tests/PreCommit.Tests.ps1'
    'docs/superpowers/plans/2026-08-12-claude-config-repo.md'
)

function Find-Secret {
    [OutputType([string[]])]
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Content,
        [Parameter(Mandatory)][string]$Path
    )

    $normalised = $Path -replace '\\', '/'
    if ($script:SecretScanExclusions -contains $normalised) { return @() }

    $patterns = [ordered]@{
        'Anthropic API key'   = 'sk-ant-[A-Za-z0-9_\-]{8,}'
        'OpenAI API key'      = 'sk-[A-Za-z0-9]{32,}'
        'GitHub token'        = 'gh[pousr]_[A-Za-z0-9]{20,}'
        'AWS access key id'   = 'AKIA[0-9A-Z]{16}'
        'Slack token'         = 'xox[baprs]-[A-Za-z0-9\-]{10,}'
        'private key block'   = '-----BEGIN [A-Z ]*PRIVATE KEY-----'
        # A long hex or base64 run is only suspicious next to a key-ish name.
        # Bare 40-char hex is a git sha; bare hex colours are three or six.
        'assigned secret'     = '(?i)(api[_-]?key|secret|token|password|passwd|credential)\W{0,4}[:=]\W{0,4}["'']?[A-Za-z0-9+/_\-]{24,}'
    }

    $findings = foreach ($name in $patterns.Keys) {
        if ($Content -match $patterns[$name]) {
            "$Path : looks like a $name"
        }
    }

    return @($findings)
}

function Invoke-PreCommitHook {
    $staged = @(git diff --cached --name-only --diff-filter=ACM)
    if ($staged.Count -eq 0) { return 0 }

    $findings = foreach ($file in $staged) {
        $content = git show ":$file" 2>$null
        if ($null -ne $content) {
            Find-Secret -Content ($content -join "`n") -Path $file
        }
    }

    $findings = @($findings)
    if ($findings.Count -eq 0) { return 0 }

    Write-Host 'pre-commit: refusing to commit, possible secrets found:' -ForegroundColor Red
    $findings | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host ''
    Write-Host 'Move the value out of the tracked file, or add the path to'
    Write-Host '$SecretScanExclusions in scripts/pre-commit.ps1 with a reason.'
    return 1
}

if (-not $DotSourceOnly) {
    exit (Invoke-PreCommitHook)
}
