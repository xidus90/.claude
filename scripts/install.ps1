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
    'antigravity-for-claude-code' = 'yuting0624/antigravity-for-claude-code'
    'ponytail'                = 'DietrichGebert/ponytail'
    'claude-kit'              = 'https://github.com/johnnyvizz/claude-kit.git'
    # This repo is its own marketplace for the plugins under plugins-src/.
    'claude-config'           = $script:RepoRoot
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

function Get-ShimDirectory {
    <#
        Where cship itself lives. That directory is demonstrably on PATH for
        every process that can run cship, which is exactly the property the
        starship shim needs.
    #>
    [OutputType([string])]
    param()

    $cship = Get-Command 'cship' -ErrorAction SilentlyContinue
    if ($cship) { return (Split-Path -Parent $cship.Source) }
    return (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.local\bin')
}

function Find-Starship {
    <#
        PATH is exactly what cannot be trusted here, so fall back to the
        directory winget installs into. "Not on PATH" and "not installed"
        are different problems with different answers.
    #>
    [OutputType([string])]
    param()

    $onPath = (Get-Command 'starship' -ErrorAction SilentlyContinue)?.Source
    if ($onPath) { return $onPath }

    $packages = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Microsoft\WinGet\Packages'
    return (Get-ChildItem -Path $packages -Filter 'starship.exe' -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName)
}

function Install-StarshipShim {
    <#
        winget drops starship into a package directory it appends to the USER
        PATH. A process that is already running never sees that — and Claude
        Code inherits the PATH of whatever shell launched it, which may be
        days old. The statusline then loses every starship module without a
        word of explanation.

        Placing starship next to cship sidesteps the whole question.
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param()

    $real = Find-Starship
    if (-not $real) {
        Write-Warn 'starship not found; the first statusline row will stay empty'
        return
    }

    $shim = Join-Path (Get-ShimDirectory) 'starship.exe'
    if ($shim -eq $real) {
        Write-Skip 'starship already sits next to cship'
        return
    }
    if ((Test-Path -LiteralPath $shim) -and
        ((Get-FileHashOrNull -Path $shim) -eq (Get-FileHashOrNull -Path $real))) {
        Write-Skip 'starship shim already current'
        return
    }

    if ($PSCmdlet.ShouldProcess($shim, "link to $real")) {
        if (Test-Path -LiteralPath $shim) { Remove-Item -LiteralPath $shim -Force }
        try {
            New-Item -ItemType HardLink -Path $shim -Target $real -ErrorAction Stop | Out-Null
        } catch {
            # Different volume, most likely. A copy costs disk but works.
            Copy-Item -LiteralPath $real -Destination $shim -Force
        }
        Write-Done "$shim -> $real"
    }
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
    # A failed starship install must not abort the run: the link, the
    # environment variable and the git hook still below are all useful
    # without it, and a half-configured machine is worse than a warned one.
    try {
        if (Find-Starship) {
            # Present but possibly unreachable — that is the shim's job, not
            # winget's, and re-running winget here only produces noise.
            Write-Skip 'starship already installed'
        }
        else {
            Install-Tool -Name 'starship' -Installer {
                winget install --id Starship.Starship --accept-source-agreements --accept-package-agreements
                if ($LASTEXITCODE -ne 0) { throw "winget exited $LASTEXITCODE" }
            }
        }
    } catch {
        Write-Warn "starship could not be installed ($($_.Exception.Message))."
        Write-Warn 'Install it manually, e.g. cargo install starship — without it the first statusline row stays empty.'
    }

    $plugins = @(Get-EnabledPlugin -SettingsPath (Join-Path $script:RepoRoot 'settings.json'))

    Write-Step 'Registering plugin marketplaces'
    $markets = @($plugins | ForEach-Object { Get-MarketplaceForPlugin -Plugin $_ } |
        Where-Object { $_ } | Select-Object -Unique)
    foreach ($market in $markets) {
        if ($PSCmdlet.ShouldProcess($market, 'add marketplace')) {
            # Already registered is not worth aborting the run for, but a
            # genuine failure must not be reported as success — this is the
            # one step whose outcome the closing summary cannot reveal.
            $output = claude plugin marketplace add $market 2>&1
            if ($LASTEXITCODE -eq 0) { Write-Done $market }
            else { Write-Warn "could not add $market : $output" }
        }
    }

    Write-Step 'Installing user-level plugins'
    foreach ($plugin in $plugins) {
        if (-not (Get-MarketplaceForPlugin -Plugin $plugin)) {
            Write-Warn "$plugin comes from a marketplace this script does not know — install it by hand"
            continue
        }
        if ($PSCmdlet.ShouldProcess($plugin, 'install plugin')) {
            $output = claude plugin install $plugin --scope user 2>&1
            if ($LASTEXITCODE -eq 0) { Write-Done $plugin }
            else { Write-Warn "could not install $plugin : $output" }
        }
    }

    Write-Step 'Making starship reachable from any process'
    Install-StarshipShim

    Write-Step 'Installing the statusline entry point'
    # settings.json names it without a path, so it has to be on PATH. Next to
    # cship is the one directory guaranteed to be, and a bare name is the only
    # form both cmd and sh resolve — Claude Code's choice of shell is not
    # something this repo can pin down.
    Install-ConfigLink -Path (Join-Path (Get-ShimDirectory) 'claude-statusline.cmd') `
                       -Target (Join-Path $script:RepoRoot 'statusline\statusline.cmd')

    $statuslineConfig = Join-Path $script:RepoRoot 'statusline\cship.toml'
    $configDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.config'

    Write-Step 'Linking the statusline config'
    Install-ConfigLink -Path (Join-Path $configDir 'cship.toml') -Target $statuslineConfig

    # Linking ~/.config/starship.toml as well does NOT remove the need for the
    # variable below, tempting as that sounds: cship overrides the config path
    # for the starship it spawns, so the default lookup never happens.
    # Measured — without the variable, row 1 renders starship's stock prompt
    # ("space on  main") instead of this file's layout.
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
