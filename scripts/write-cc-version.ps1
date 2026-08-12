# SessionStart hook: cache the Claude Code version for the statusline.
# cship does not expose it, and shelling out to `claude --version` on every
# statusline render would start a Node process several times a second.
[CmdletBinding()]
param([switch]$DotSourceOnly)

$ErrorActionPreference = 'Stop'

function Get-ClaudeCliVersion {
    [OutputType([string])]
    param()
    try {
        $raw = (& claude --version 2>$null) -join ' '
        if ($raw -match '(\d+\.\d+\.\d+)') { return $Matches[1] }
    } catch {
        # No claude on PATH is not worth failing a session start over.
    }
    return ''
}

function Resolve-ClaudeVersion {
    [OutputType([string])]
    param([Parameter(Mandatory)][AllowEmptyString()][string]$HookInput)

    try {
        $payload = $HookInput | ConvertFrom-Json -ErrorAction Stop
        if ($payload.version) { return [string]$payload.version }
    } catch {
        # Fall through to the CLI.
    }
    return (Get-ClaudeCliVersion)
}

function Write-CcVersionFile {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Version,
        [Parameter(Mandatory)][string]$Path
    )
    if ([string]::IsNullOrWhiteSpace($Version)) { return }

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Version)
}

if (-not $DotSourceOnly) {
    $stdin = [Console]::In.ReadToEnd()
    $version = Resolve-ClaudeVersion -HookInput $stdin
    $target = Join-Path $HOME '.claude\statusline\.cc-version'
    Write-CcVersionFile -Version $version -Path $target
}
