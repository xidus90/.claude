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
        # Guard on shape, not truthiness: any object is truthy and would
        # stringify to something like "@{a=1}" straight into the statusline.
        if ($payload.version -is [string] -and $payload.version -match '^\d+\.\d+') {
            return [string]$payload.version
        }
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
    try {
        Write-CcVersionFile -Version $version -Path $target
    } catch {
        # A locked file or an occupied parent path must not greet the user with
        # a stack trace at every session start. The statusline just omits the
        # version, which is the right degradation for a cosmetic field.
    }
}
