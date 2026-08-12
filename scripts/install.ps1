# Bring a fresh Windows PC up to this repo's configuration: toolchain,
# plugins, the statusline config link, the environment variable starship
# needs, and the git hook. Idempotent — running it twice is a no-op that
# says so.
[CmdletBinding(SupportsShouldProcess)]
param([switch]$DotSourceOnly)

$ErrorActionPreference = 'Stop'

$script:RepoRoot = Split-Path -Parent $PSScriptRoot

# Which marketplace each plugin comes from. browser-use is not in the
# official catalogue; its vendor runs its own, and without registering it
# `claude plugin install browser-use@browser-use` fails.
$script:Marketplaces = @{
    'claude-plugins-official' = 'anthropics/claude-plugins-official'
    'browser-use'             = 'https://github.com/browser-use/plugins.git'
}

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Skip { param([string]$Message) Write-Host "    skipped: $Message" -ForegroundColor DarkGray }
function Write-Done { param([string]$Message) Write-Host "    ok: $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "    warning: $Message" -ForegroundColor Yellow }

function Test-Prerequisite {
    [OutputType([bool])]
    param([Parameter(Mandatory)][string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-EnabledPlugin {
    [OutputType([string[]])]
    param([Parameter(Mandatory)][string]$SettingsPath)

    $settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json
    if (-not $settings.PSObject.Properties.Name.Contains('enabledPlugins')) { return @() }

    return @(
        $settings.enabledPlugins.PSObject.Properties |
            Where-Object { $_.Value -eq $true } |
            ForEach-Object { $_.Name }
    )
}

function Get-MarketplaceForPlugin {
    [OutputType([string])]
    param([Parameter(Mandatory)][string]$Plugin)

    $market = ($Plugin -split '@', 2)[1]
    if ($market -and $script:Marketplaces.ContainsKey($market)) {
        return $script:Marketplaces[$market]
    }
    # Guessing a URL would register a marketplace the user never chose.
    return $null
}

function Get-FileHashOrNull {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

function Install-ConfigLink {
    <#
        Make $Path show the contents of $Target.

        A symlink is preferred, but Windows refuses to create one without
        administrator rights or developer mode, so a hardlink is the
        fallback. A hardlink shares content but not identity: when git
        REPLACES the repo file instead of editing it, the old inode loses
        its second reference and the link silently goes stale — a statusline
        showing yesterday's config with no error anywhere. That is why this
        compares content hashes rather than asking whether the path exists.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Target
    )

    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) {
        throw "Link target does not exist: $Target"
    }

    $targetHash = Get-FileHashOrNull -Path $Target
    $pathHash   = Get-FileHashOrNull -Path $Path

    if ($pathHash -eq $targetHash) {
        Write-Skip "$Path already carries the repo's contents"
        return
    }

    if (-not $PSCmdlet.ShouldProcess($Path, "link to $Target")) { return }

    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    if ($null -ne $pathHash) {
        # Never destroy: the file may be a stale link or something the user
        # wrote by hand, and from here the two are indistinguishable.
        $backup = "$Path.bak-$((Get-FileHashOrNull -Path $Path).Substring(0, 8))"
        Move-Item -LiteralPath $Path -Destination $backup -Force
        Write-Warn "kept the previous $([System.IO.Path]::GetFileName($Path)) as $([System.IO.Path]::GetFileName($backup))"
    }

    try {
        New-Item -ItemType SymbolicLink -Path $Path -Target $Target -ErrorAction Stop | Out-Null
        Write-Done "$Path -> $Target (symlink)"
    } catch {
        New-Item -ItemType HardLink -Path $Path -Target $Target -ErrorAction Stop | Out-Null
        Write-Done "$Path -> $Target (hardlink; symlinks need developer mode)"
        Write-Warn 'a hardlink goes stale when git replaces the repo file — re-run this script after a checkout'
    }
}

function Install-GitHook {
    [CmdletBinding(SupportsShouldProcess)]
    param([Parameter(Mandatory)][string]$HooksDirectory)

    $hook = Join-Path $HooksDirectory 'pre-commit'
    # Git runs hooks through sh even on Windows, hence the shim. LF only: a
    # CRLF shebang makes sh fail with a bare "not found" naming nothing.
    $body = "#!/bin/sh`nexec pwsh -NoProfile -File `"`$(git rev-parse --show-toplevel)/scripts/pre-commit.ps1`"`n"

    if ((Test-Path -LiteralPath $hook) -and
        ([System.IO.File]::ReadAllText($hook) -eq $body)) {
        Write-Skip 'pre-commit hook already installed'
        return
    }

    if ($PSCmdlet.ShouldProcess($hook, 'install pre-commit hook')) {
        [System.IO.File]::WriteAllText($hook, $body)
        Write-Done 'pre-commit hook installed'
    }
}

function Set-UserEnvironmentVariable {
    <#
        cship does not pass its own config to the starship subprocess, so
        without STARSHIP_CONFIG the first statusline row degrades to
        starship's default prompt. The repo path differs per machine, so a
        value carried over from another PC is worse than none.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Value
    )

    if ([Environment]::GetEnvironmentVariable($Name, 'User') -eq $Value) {
        Write-Skip "$Name already set"
        return 'unchanged'
    }

    if (-not $PSCmdlet.ShouldProcess($Name, "set to $Value")) { return 'skipped' }

    [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
    # Also in this process, so the caller can verify without a new shell.
    Set-Item -Path "env:$Name" -Value $Value
    Write-Done "$Name = $Value"
    return 'set'
}

function Install-Tool {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][scriptblock]$Installer
    )

    if (Test-Prerequisite -Name $Name) {
        Write-Skip "$Name already on PATH"
        return
    }
    if ($PSCmdlet.ShouldProcess($Name, 'install')) {
        & $Installer
        Write-Done "$Name installed"
    }
}

function Invoke-Install {
    [CmdletBinding(SupportsShouldProcess)]
    param()

    Write-Step 'Checking prerequisites'
    foreach ($required in 'git', 'claude') {
        if (-not (Test-Prerequisite -Name $required)) {
            throw "$required is required but not on PATH. Install it, then run this script again."
        }
        Write-Done "$required found"
    }

    Write-Step 'Installing uv'
    Install-Tool -Name 'uv' -Installer {
        Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
    }

    Write-Step 'Installing cship'
    Install-Tool -Name 'cship' -Installer {
        Invoke-RestMethod https://cship.dev/install.ps1 | Invoke-Expression
    }

    Write-Step 'Installing starship'
    Install-Tool -Name 'starship' -Installer {
        winget install --id Starship.Starship --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) {
            throw 'winget failed. Install starship manually, e.g. cargo install starship.'
        }
    }

    $plugins = @(Get-EnabledPlugin -SettingsPath (Join-Path $script:RepoRoot 'settings.json'))

    Write-Step 'Registering plugin marketplaces'
    $markets = @($plugins | ForEach-Object { Get-MarketplaceForPlugin -Plugin $_ } |
        Where-Object { $_ } | Select-Object -Unique)
    foreach ($market in $markets) {
        if ($PSCmdlet.ShouldProcess($market, 'add marketplace')) {
            # Already registered is not worth aborting the run for.
            claude plugin marketplace add $market 2>&1 | Out-Null
            Write-Done $market
        }
    }

    Write-Step 'Installing user-level plugins'
    foreach ($plugin in $plugins) {
        if (-not (Get-MarketplaceForPlugin -Plugin $plugin)) {
            Write-Warn "$plugin comes from a marketplace this script does not know — install it by hand"
            continue
        }
        if ($PSCmdlet.ShouldProcess($plugin, 'install plugin')) {
            claude plugin install $plugin --scope user 2>&1 | Out-Null
            Write-Done $plugin
        }
    }

    $statuslineConfig = Join-Path $script:RepoRoot 'statusline\cship.toml'

    Write-Step 'Linking the statusline config'
    Install-ConfigLink -Path (Join-Path $HOME '.config\cship.toml') -Target $statuslineConfig

    Write-Step 'Pointing starship at the same file'
    Set-UserEnvironmentVariable -Name 'STARSHIP_CONFIG' -Value $statuslineConfig | Out-Null

    Write-Step 'Installing the git hook'
    Install-GitHook -HooksDirectory (Join-Path $script:RepoRoot '.git\hooks')

    Write-Step 'Summary'
    foreach ($tool in 'git', 'claude', 'uv', 'cship', 'starship') {
        $version = if (Test-Prerequisite -Name $tool) {
            (& $tool --version 2>&1 | Select-Object -First 1)
        } else { 'MISSING' }
        Write-Host ("    {0,-10} {1}" -f $tool, $version)
    }
    Write-Host '    Restart Claude Code so the statusline and plugins take effect.'
}

if (-not $DotSourceOnly) {
    Invoke-Install
}
