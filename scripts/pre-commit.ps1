# Git pre-commit hook: refuse commits that would put a secret into history.
# Dot-source with -DotSourceOnly to get Find-Secret without running the hook.
[CmdletBinding()]
param([switch]$DotSourceOnly)

$ErrorActionPreference = 'Stop'

# Git runs this through sh -> pwsh, where the console is a legacy OEM code page
# (ibm850 on this machine). pwsh would then mis-decode git's UTF-8 stdout, and a
# path such as "ueber.md" spelled with an umlaut no longer resolves for
# git show -- the file gets reported unreadable instead of scanned. Pin UTF-8
# before the first git call. Without BOM: $OutputEncoding also governs what we
# hand to native commands, and a BOM would corrupt that.
$script:Utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $script:Utf8NoBom
$OutputEncoding = $script:Utf8NoBom

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
        # Modern OpenAI keys carry project segments, hence - and _ as well.
        # The left boundary keeps "risk-management-..." from matching on the
        # "sk-" buried inside it; without it the hook nags on ordinary prose.
        'OpenAI API key'      = '(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-]{32,}'
        'GitHub token'        = 'gh[pousr]_[A-Za-z0-9]{20,}'
        'AWS access key id'   = 'AKIA[0-9A-Z]{16}'
        'Google API key'      = 'AIza[0-9A-Za-z_\-]{35}'
        'JSON web token'      = 'eyJ[A-Za-z0-9_\-]{20,}\.'
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

# Names the staged files. core.quotepath=false plus -z is what keeps a
# non-ASCII path readable: quoted, it comes back as "\303\274ber.md", which
# git show cannot resolve -- the file would then go unscanned in silence.
# R is in the filter because a pure rename also puts content into the commit.
function Get-StagedFile {
    [OutputType([string[]])]
    param()

    $raw = git -c core.quotepath=false diff --cached --name-only -z --diff-filter=ACMR
    if ([string]::IsNullOrEmpty($raw)) { return @() }

    $staged = @(($raw -join "`n") -split "`0" | Where-Object { $_ -ne '' })
    if ($staged.Count -eq 0) { return @() }

    # A submodule is staged as a gitlink (mode 160000) with no blob behind it,
    # so git show would fail and the fail-closed branch would block every
    # commit that adds one. Not scannable, and nothing here to scan.
    $gitlinks = @(
        git -c core.quotepath=false ls-files --stage -z -- $staged |
            ForEach-Object { $_ -split "`0" } |
            Where-Object { $_ -match '^160000\s' } |
            ForEach-Object { ($_ -split "`t", 2)[1] }
    )

    return @($staged | Where-Object { $gitlinks -notcontains $_ })
}

function Get-StagedSecretFinding {
    [OutputType([string[]])]
    param([Parameter(Mandatory)][AllowEmptyCollection()][string[]]$File)

    $findings = foreach ($f in $File) {
        $content = git show ":$f" 2>$null
        if ($LASTEXITCODE -ne 0) {
            # An unreadable blob is not a clean blob. Refusing beats scanning
            # nothing and reporting success.
            "$f : could not read staged content, refusing to treat it as clean"
        }
        else {
            Find-Secret -Content ($content -join "`n") -Path $f
        }
    }

    return @($findings)
}

function Invoke-PreCommitHook {
    $staged = @(Get-StagedFile)
    if ($staged.Count -eq 0) { return 0 }

    $findings = @(Get-StagedSecretFinding -File $staged)
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
