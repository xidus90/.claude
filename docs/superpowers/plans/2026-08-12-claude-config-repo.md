# Versionierte Claude-Code-Konfiguration — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `C:\Users\micro\.claude` wird ein Git-Repo, das die
Nutzerkonfiguration von Claude Code versioniert und auf einem frischen
Windows-PC per Skript reproduzierbar macht.

**Architecture:** Das Working-Tree *ist* der Konfigurationsordner; eine
Allowlist-`.gitignore` lässt nur Konfiguration durch und sperrt sämtliche
Laufzeitdaten aus. Ein `pre-commit`-Hook verhindert, dass Secrets in die
Historie geraten. Ein idempotentes `install.ps1` stellt Toolchain, Plugins und
den einen nötigen Symlink her.

**Tech Stack:** Git, PowerShell 7 (`pwsh` 7.6.4), Pester 5, cship 1.8.0,
starship, Claude Code CLI 2.1.220.

## Global Constraints

- Zielordner ist ausschließlich `C:\Users\micro\.claude`. Kein zweiter Pfad,
  keine Junction, keine Kopie.
- Windows-only. Keine Vorkehrungen für andere Plattformen.
- `.gitignore` arbeitet als Allowlist: erst `/*`, dann namentliche Ausnahmen.
  Eine neue versionierte Datei kostet eine `!`-Zeile.
- Niemals `pip`. Python-Werkzeuge kommen über `uv` beziehungsweise `uvx`.
- Prosa und Dokumentation auf Deutsch; Code, Bezeichner, Code-Kommentare,
  Log-Meldungen und Commit-Nachrichten auf Englisch.
- Commit-Nachrichten im Conventional-Commits-Stil, englisch, ohne
  Co-Authored-By-Zeile (dieses Repo hat keine solche Konvention).
- Alle Skripte sind idempotent: ein zweiter Lauf darf nichts kaputt machen und
  meldet übersprungene Schritte.
- Pester 5 ist Testframework. Das systemweit vorinstallierte Pester 3.4.0 ist
  inkompatibel — Task 1 installiert Pester 5 nach `CurrentUser`.
- Statusline-Schwellen bleiben unverändert: Kontextfenster 40/70,
  Nutzungslimits 60/80, Preis 2/5.
- Es wird nichts gelöscht, was Laufzeitdaten sind. `git clean` ist in diesem
  Repo verboten und wird in der README als solches benannt.

---

### Task 1: Repo-Grundlage und Allowlist-.gitignore

Legt das Repo an und beweist mit Tests, dass die Allowlist genau das
durchlässt, was sie soll — und vor allem, dass sie `.credentials.json`,
`history.jsonl` und die Sitzungsdaten aussperrt.

**Files:**
- Create: `C:\Users\micro\.claude\.gitignore`
- Create: `C:\Users\micro\.claude\scripts\tests\Gitignore.Tests.ps1`

**Interfaces:**
- Consumes: nichts.
- Produces: ein initialisiertes Git-Repo in `~/.claude` mit Branch `main`;
  die Testkonvention `scripts/tests/*.Tests.ps1`, die alle folgenden Tasks
  weiterverwenden.

- [ ] **Step 1: Pester 5 installieren**

Das mitgelieferte Pester 3.4.0 kennt weder `Should -Be` in der Pester-5-Form
noch `BeforeAll`. Ohne diesen Schritt schlagen alle folgenden Tests mit
Syntaxfehlern fehl.

```powershell
Install-Module Pester -MinimumVersion 5.5.0 -Scope CurrentUser -Force -SkipPublisherCheck
Import-Module Pester -MinimumVersion 5.5.0 -Force
Get-Module Pester | Select-Object Name, Version
```

Erwartet: Version 5.5.0 oder höher.

- [ ] **Step 2: Repo initialisieren**

Noch ohne Commit — die `.gitignore` gibt es ja noch nicht, und ein
`git add -A` vor ihr würde Zugangsdaten stagen.

```powershell
cd C:\Users\micro\.claude
git init -b main
git status --porcelain | Measure-Object -Line
```

Erwartet: sehr viele Zeilen (alles ungetrackt) — genau der Zustand, den die
`.gitignore` gleich einfängt.

- [ ] **Step 3: Den fehlschlagenden Test schreiben**

Der Test prüft beide Richtungen: Was ignoriert sein muss, und was sichtbar
bleiben muss. `git check-ignore -q` liefert Exit-Code 0, wenn ein Pfad
ignoriert wird.

```powershell
# scripts/tests/Gitignore.Tests.ps1
BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

    function Test-PathIgnored {
        param([string]$RelativePath)
        Push-Location $script:RepoRoot
        try {
            git check-ignore -q -- $RelativePath
            return $LASTEXITCODE -eq 0
        } finally {
            Pop-Location
        }
    }
}

Describe 'gitignore allowlist' {

    Context 'runtime data stays out of the repo' {
        $cases = @(
            @{ Path = '.credentials.json' }
            @{ Path = 'history.jsonl' }
            @{ Path = 'sessions/anything.json' }
            @{ Path = 'projects/some-project/session.jsonl' }
            @{ Path = 'shell-snapshots/snapshot.ps1' }
            @{ Path = 'worktrees/feature-x/file.txt' }
            @{ Path = 'cache/blob' }
            @{ Path = 'backups/settings.json' }
            @{ Path = 'debug/log.txt' }
            @{ Path = 'plugins/installed_plugins.json' }
            @{ Path = 'plugins/known_marketplaces.json' }
            @{ Path = 'plugins/cache/some-plugin/skill.md' }
            @{ Path = 'settings.local.json' }
            @{ Path = 'statusline/.cc-version' }
        )
        It 'ignores <Path>' -ForEach $cases {
            Test-PathIgnored $Path | Should -BeTrue
        }
    }

    Context 'configuration is tracked' {
        $cases = @(
            @{ Path = '.gitignore' }
            @{ Path = 'README.md' }
            @{ Path = 'CLAUDE.md' }
            @{ Path = 'settings.json' }
            @{ Path = 'keybindings.json' }
            @{ Path = 'skills/my-skill/SKILL.md' }
            @{ Path = 'agents/my-agent.md' }
            @{ Path = 'statusline/cship.toml' }
            @{ Path = 'scripts/install.ps1' }
            @{ Path = 'docs/superpowers/specs/spec.md' }
        )
        It 'does not ignore <Path>' -ForEach $cases {
            Test-PathIgnored $Path | Should -BeFalse
        }
    }

    Context 'an unknown new runtime folder is denied by default' {
        It 'ignores a directory nobody has heard of yet' {
            Test-PathIgnored 'some-future-runtime-dir/state.db' | Should -BeTrue
        }
    }
}
```

- [ ] **Step 4: Test laufen lassen, Fehlschlag bestätigen**

```powershell
cd C:\Users\micro\.claude
Invoke-Pester scripts\tests\Gitignore.Tests.ps1 -Output Detailed
```

Erwartet: Die Fälle in *runtime data stays out* schlagen fehl, weil ohne
`.gitignore` nichts ignoriert wird.

- [ ] **Step 5: Die .gitignore schreiben**

```gitignore
# Allowlist, not blocklist: this folder is mostly runtime state, and a new
# Claude Code release may add a directory we have never heard of. Denying
# everything first means a forgotten entry costs nothing, while a forgotten
# blocklist entry could commit credentials.
/*

!/.gitignore
!/README.md
!/CLAUDE.md
!/settings.json
!/keybindings.json
!/skills/
!/agents/
!/statusline/
!/scripts/
!/docs/

# Written per session by the SessionStart hook, not configuration.
/statusline/.cc-version
```

- [ ] **Step 6: Test laufen lassen, Erfolg bestätigen**

```powershell
Invoke-Pester scripts\tests\Gitignore.Tests.ps1 -Output Detailed
```

Erwartet: alle Tests grün.

- [ ] **Step 7: Prüfen, was tatsächlich gestaged würde**

Dieser Schritt ist der eigentliche Sicherheitsgurt. Vor dem ersten Commit
muss die Liste kurz und vollständig nachvollziehbar sein.

```powershell
git add -A
git status --porcelain
```

Erwartet: ausschließlich `.gitignore`, `scripts/tests/Gitignore.Tests.ps1`,
`CLAUDE.md`, `settings.json` und die Dateien unter `docs/`. Taucht
irgendetwas anderes auf — insbesondere `.credentials.json` — sofort
`git reset` und die `.gitignore` korrigieren, bevor es weitergeht.

- [ ] **Step 8: Erster Commit**

```powershell
git commit -m "chore: track user configuration with an allowlist gitignore"
```

---

### Task 2: pre-commit-Hook gegen Secrets

Die `.gitignore` schützt vor versehentlich mitgenommenen Dateien. Sie schützt
nicht davor, dass jemand einen API-Key *in* eine versionierte Datei schreibt.
Genau das ist heute schon einmal passiert (Obsidian-Key in `settings.json`).

**Files:**
- Create: `C:\Users\micro\.claude\scripts\pre-commit.ps1`
- Create: `C:\Users\micro\.claude\scripts\tests\PreCommit.Tests.ps1`

**Interfaces:**
- Consumes: das Repo aus Task 1.
- Produces: `Find-Secret -Content <string> -Path <string>` → gibt ein Array
  von Strings zurück (Beschreibungen der Funde), leer wenn sauber. Task 6
  verlinkt das Skript nach `.git/hooks/pre-commit`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Der Hook muss beides können: einen echten Key blockieren *und* harmlose Inhalte
durchlassen. Der zweite Teil ist der wichtigere Test — ein Hook, der bei jedem
Commit anschlägt, wird binnen einer Woche mit `--no-verify` umgangen und ist
dann wertlos.

```powershell
# scripts/tests/PreCommit.Tests.ps1
BeforeAll {
    . (Join-Path (Split-Path -Parent $PSScriptRoot) 'pre-commit.ps1') -DotSourceOnly
}

Describe 'Find-Secret' {

    Context 'catches real secrets' {
        It 'flags a 64-char hex API key' {
            # Synthetic value. Never put a real key in a fixture -- the plan
            # document is tracked, so a real one would leak here instead.
            $content = '"EXAMPLE_API_KEY": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"'
            Find-Secret -Content $content -Path 'settings.json' | Should -Not -BeNullOrEmpty
        }
        It 'flags an Anthropic key prefix' {
            Find-Secret -Content 'sk-ant-api03-AAAABBBBCCCCDDDD' -Path 'x.md' | Should -Not -BeNullOrEmpty
        }
        It 'flags a GitHub token prefix' {
            Find-Secret -Content 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB' -Path 'x.md' | Should -Not -BeNullOrEmpty
        }
        It 'flags an AWS access key id' {
            Find-Secret -Content 'AKIAIOSFODNN7EXAMPLE' -Path 'x.md' | Should -Not -BeNullOrEmpty
        }
        It 'flags a private key header' {
            Find-Secret -Content '-----BEGIN RSA PRIVATE KEY-----' -Path 'x.md' | Should -Not -BeNullOrEmpty
        }
        It 'flags a long base64 blob assigned to a key-ish name' {
            $content = 'token = "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNERUZHSElKS0xNTk9Q"'
            Find-Secret -Content $content -Path 'x.toml' | Should -Not -BeNullOrEmpty
        }
    }

    Context 'lets ordinary configuration through' {
        It 'passes a plain settings.json' {
            $content = '{ "model": "opus[1m]", "effortLevel": "low" }'
            Find-Secret -Content $content -Path 'settings.json' | Should -BeNullOrEmpty
        }
        It 'passes a git commit sha' {
            Find-Secret -Content '6efe32c9e2dd002d0c394e861e0529675d1ab32e' -Path 'x.md' | Should -BeNullOrEmpty
        }
        It 'passes a hex colour in the statusline config' {
            Find-Secret -Content 'style = "fg:#7dcfff"' -Path 'statusline/cship.toml' | Should -BeNullOrEmpty
        }
        It 'passes German prose' {
            Find-Secret -Content 'Die Konfiguration liegt im Repo.' -Path 'README.md' | Should -BeNullOrEmpty
        }
        It 'passes the test file itself, which is full of fake keys' {
            $content = 'sk-ant-api03-AAAABBBBCCCCDDDD'
            Find-Secret -Content $content -Path 'scripts/tests/PreCommit.Tests.ps1' | Should -BeNullOrEmpty
        }
    }
}
```

Der letzte Fall verdient eine Erklärung: Diese Testdatei enthält
absichtlich Attrappen von Secrets. Ohne Ausnahme für sich selbst könnte der
Hook nie committet werden.

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```powershell
Invoke-Pester scripts\tests\PreCommit.Tests.ps1 -Output Detailed
```

Erwartet: Abbruch beim Dot-Sourcing, `pre-commit.ps1` existiert nicht.

- [ ] **Step 3: Den Hook implementieren**

```powershell
# scripts/pre-commit.ps1
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
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

```powershell
Invoke-Pester scripts\tests\PreCommit.Tests.ps1 -Output Detailed
```

Erwartet: alle Tests grün. Schlägt „passes a git commit sha" fehl, ist das
`assigned secret`-Muster zu gierig — es darf nur bei vorangehendem
Schlüsselnamen greifen.

- [ ] **Step 5: Den Hook scharfschalten**

`.git/hooks/` ist nicht versionierbar, deshalb hier von Hand; Task 6
automatisiert es für neue PCs.

```powershell
Set-Content -Path C:\Users\micro\.claude\.git\hooks\pre-commit -Value @'
#!/bin/sh
exec pwsh -NoProfile -File "$(git rev-parse --show-toplevel)/scripts/pre-commit.ps1"
'@ -Encoding ascii
```

- [ ] **Step 6: Den Hook am lebenden Objekt prüfen**

```powershell
cd C:\Users\micro\.claude
Set-Content scripts\_leak.tmp.md 'api_key = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"'
git add scripts\_leak.tmp.md
git commit -m "test: this must not succeed"
```

Erwartet: Exit-Code ungleich 0, rote Meldung „looks like a assigned secret".
Danach aufräumen:

```powershell
git reset scripts\_leak.tmp.md
Remove-Item scripts\_leak.tmp.md
```

- [ ] **Step 7: Commit**

```powershell
git add scripts\pre-commit.ps1 scripts\tests\PreCommit.Tests.ps1
git commit -m "feat: block commits containing secrets"
```

---

### Task 3: settings.json bereinigen

Entfernt die MCP-Server aus der Nutzerkonfiguration und trägt die
Plugin-Absicht ein. Danach ist die Datei secret-frei — was der Hook aus Task 2
ab sofort auch erzwingt.

**Files:**
- Modify: `C:\Users\micro\.claude\settings.json`
- Create: `C:\Users\micro\.claude\scripts\tests\Settings.Tests.ps1`

**Interfaces:**
- Consumes: den Hook aus Task 2.
- Produces: `settings.json` ohne `mcpServers`, mit
  `enabledPlugins["browser-use@browser-use"] = true`. Task 6 liest
  `enabledPlugins`, um zu wissen, was zu installieren ist.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

```powershell
# scripts/tests/Settings.Tests.ps1
BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $script:Settings = Get-Content (Join-Path $script:RepoRoot 'settings.json') -Raw |
        ConvertFrom-Json
}

Describe 'settings.json' {

    It 'is valid JSON' {
        $script:Settings | Should -Not -BeNullOrEmpty
    }

    It 'declares no user-level MCP servers' {
        # MCP servers are where credentials creep in, and which servers a
        # project needs is the project's decision, not the user's.
        $script:Settings.PSObject.Properties.Name | Should -Not -Contain 'mcpServers'
    }

    It 'contains no obsidian remnants' {
        $raw = Get-Content (Join-Path $script:RepoRoot 'settings.json') -Raw
        $raw | Should -Not -Match 'obsidian'
    }

    It 'enables the four user-level plugins' -ForEach @(
        @{ Plugin = 'superpowers@claude-plugins-official' }
        @{ Plugin = 'code-review@claude-plugins-official' }
        @{ Plugin = 'security-guidance@claude-plugins-official' }
        @{ Plugin = 'browser-use@browser-use' }
    ) {
        $script:Settings.enabledPlugins.$Plugin | Should -BeTrue
    }

    It 'keeps cship as the statusline command' {
        $script:Settings.statusLine.type | Should -Be 'command'
        $script:Settings.statusLine.command | Should -Be 'cship'
    }
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```powershell
Invoke-Pester scripts\tests\Settings.Tests.ps1 -Output Detailed
```

Erwartet: „declares no user-level MCP servers", „contains no obsidian
remnants" und der `browser-use@browser-use`-Fall schlagen fehl.

- [ ] **Step 3: settings.json anpassen**

Zu entfernen ist der komplette `mcpServers`-Block (beide Server). Zu ergänzen
ist ein Eintrag in `enabledPlugins`. Ergebnis:

```json
{
  "permissions": {
    "defaultMode": "auto"
  },
  "model": "opus[1m]",
  "statusLine": {
    "type": "command",
    "command": "cship"
  },
  "enabledPlugins": {
    "superpowers@claude-plugins-official": true,
    "frontend-design@claude-plugins-official": false,
    "mcp-server-dev@claude-plugins-official": false,
    "code-review@claude-plugins-official": true,
    "security-guidance@claude-plugins-official": true,
    "browser-use@browser-use": true
  },
  "effortLevel": "low",
  "autoUpdatesChannel": "latest",
  "tui": "fullscreen",
  "autoDreamEnabled": true,
  "skipAutoPermissionPrompt": true
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

```powershell
Invoke-Pester scripts\tests\Settings.Tests.ps1 -Output Detailed
```

Erwartet: alle Tests grün.

- [ ] **Step 5: Commit**

```powershell
git add settings.json scripts\tests\Settings.Tests.ps1
git commit -m "refactor: drop user-level MCP servers, declare plugins instead"
```

---

### Task 4: Claude-Code-Version für die Statusline bereitstellen

Die Statusline soll die Claude-Code-Version zeigen. cship kennt sie nicht,
und `claude --version` bei jedem Render aufzurufen hieße, einen Node-Prozess
in eine Statusline zu setzen. Ein SessionStart-Hook schreibt sie einmal je
Sitzung in eine Datei.

**Files:**
- Create: `C:\Users\micro\.claude\scripts\write-cc-version.ps1`
- Create: `C:\Users\micro\.claude\scripts\tests\WriteCcVersion.Tests.ps1`
- Modify: `C:\Users\micro\.claude\settings.json`

**Interfaces:**
- Consumes: `settings.json` aus Task 3.
- Produces: die Datei `statusline/.cc-version` mit der Versionsnummer als
  einzelner Zeile ohne Zeilenumbruch am Ende. Task 5 liest sie im
  `custom.ccversion`-Modul.
- Produces: `Resolve-ClaudeVersion -HookInput <string>` → `[string]`.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Zwei Wege müssen abgedeckt sein: Version aus der Hook-JSON (billig) und, wenn
die sie nicht enthält, der Rückfall auf `claude --version` (teuer, aber
einmalig).

```powershell
# scripts/tests/WriteCcVersion.Tests.ps1
BeforeAll {
    $script:ScriptDir = Split-Path -Parent $PSScriptRoot
    . (Join-Path $script:ScriptDir 'write-cc-version.ps1') -DotSourceOnly
}

Describe 'Resolve-ClaudeVersion' {

    It 'prefers the version from the hook payload' {
        $json = '{"session_id":"x","hook_event_name":"SessionStart","version":"2.1.220"}'
        Resolve-ClaudeVersion -HookInput $json | Should -Be '2.1.220'
    }

    It 'falls back to the CLI when the payload has no version' {
        Mock Get-ClaudeCliVersion { '9.9.9' }
        $json = '{"session_id":"x","hook_event_name":"SessionStart"}'
        Resolve-ClaudeVersion -HookInput $json | Should -Be '9.9.9'
        Should -Invoke Get-ClaudeCliVersion -Times 1 -Exactly
    }

    It 'falls back to the CLI when the payload is not JSON at all' {
        Mock Get-ClaudeCliVersion { '9.9.9' }
        Resolve-ClaudeVersion -HookInput 'not json' | Should -Be '9.9.9'
    }

    It 'returns an empty string when nothing can be determined' {
        Mock Get-ClaudeCliVersion { '' }
        Resolve-ClaudeVersion -HookInput '{}' | Should -Be ''
    }
}

Describe 'Write-CcVersionFile' {

    It 'writes the version without a trailing newline' {
        $target = Join-Path $TestDrive '.cc-version'
        Write-CcVersionFile -Version '2.1.220' -Path $target
        [System.IO.File]::ReadAllText($target) | Should -Be '2.1.220'
    }

    It 'creates the parent directory if it is missing' {
        $target = Join-Path $TestDrive 'nested\dir\.cc-version'
        Write-CcVersionFile -Version '1.0.0' -Path $target
        Test-Path $target | Should -BeTrue
    }

    It 'writes nothing when the version is empty' {
        # An empty file would render as a stray separator in the statusline.
        $target = Join-Path $TestDrive 'empty\.cc-version'
        Write-CcVersionFile -Version '' -Path $target
        Test-Path $target | Should -BeFalse
    }
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```powershell
Invoke-Pester scripts\tests\WriteCcVersion.Tests.ps1 -Output Detailed
```

Erwartet: Abbruch, `write-cc-version.ps1` existiert nicht.

- [ ] **Step 3: Das Hook-Skript implementieren**

```powershell
# scripts/write-cc-version.ps1
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
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

```powershell
Invoke-Pester scripts\tests\WriteCcVersion.Tests.ps1 -Output Detailed
```

Erwartet: alle Tests grün.

- [ ] **Step 5: Den Hook in settings.json registrieren**

Ergänzt einen `hooks`-Block. Der Pfad muss absolut sein — Hooks laufen im
Arbeitsverzeichnis des Projekts, nicht in `~/.claude`.

```json
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "pwsh -NoProfile -File C:\\Users\\micro\\.claude\\scripts\\write-cc-version.ps1"
          }
        ]
      }
    ]
  }
```

- [ ] **Step 6: Von Hand gegenprüfen**

```powershell
'{"session_id":"x","hook_event_name":"SessionStart","version":"2.1.220"}' |
    pwsh -NoProfile -File C:\Users\micro\.claude\scripts\write-cc-version.ps1
Get-Content C:\Users\micro\.claude\statusline\.cc-version
```

Erwartet: `2.1.220`.

- [ ] **Step 7: Prüfen, dass die Datei ignoriert wird**

```powershell
git check-ignore -v statusline\.cc-version
```

Erwartet: eine Trefferzeile mit Verweis auf `/statusline/.cc-version`. Kommt
nichts, ist Task 1 unvollständig.

- [ ] **Step 8: Commit**

```powershell
git add settings.json scripts\write-cc-version.ps1 scripts\tests\WriteCcVersion.Tests.ps1
git commit -m "feat: cache the Claude Code version for the statusline"
```

---

### Task 5: Statusline neu bauen

Zwei Zeilen statt einer halben. Die erste Zeile ist heute leer, weil
`starship` fehlt — dieser Task setzt sie zusammen und beweist mit einem
Render-Test, dass sie tatsächlich etwas ausgibt.

**Files:**
- Create: `C:\Users\micro\.claude\statusline\cship.toml`
- Create: `C:\Users\micro\.claude\scripts\tests\Statusline.Tests.ps1`
- Create: `C:\Users\micro\.claude\scripts\tests\fixtures\statusline-input.json`

**Interfaces:**
- Consumes: `statusline/.cc-version` aus Task 4.
- Produces: `statusline/cship.toml`. Task 6 verlinkt sie nach
  `~/.config/cship.toml`.

- [ ] **Step 1: starship installieren**

Ohne dieses Binary rendert cship keine Starship-Module, und Zeile 1 bliebe
leer — genau der heutige Fehlerzustand.

```powershell
winget install --id Starship.Starship --accept-source-agreements --accept-package-agreements
starship --version
```

Schlägt winget fehl: `cargo install starship` als Ausweichweg.

- [ ] **Step 2: Die Test-Fixture anlegen**

```json
{
  "session_id": "11111111-2222-3333-4444-555555555555",
  "cwd": "C:/Users/micro/Documents/#GIT/space",
  "workspace": {
    "current_dir": "C:/Users/micro/Documents/#GIT/space",
    "project_dir": "C:/Users/micro/Documents/#GIT/space"
  },
  "model": { "id": "claude-opus-5", "display_name": "Opus 5" },
  "version": "2.1.220",
  "cost": {
    "total_cost_usd": 0.42,
    "total_lines_added": 47,
    "total_lines_removed": 12
  }
}
```

- [ ] **Step 3: Den fehlschlagenden Test schreiben**

Der Test rendert cship mit der Fixture und prüft den Inhalt beider Zeilen.
ANSI-Sequenzen werden vorher entfernt, sonst vergleicht man Farbcodes statt
Text.

```powershell
# scripts/tests/Statusline.Tests.ps1
BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $script:Config   = Join-Path $script:RepoRoot 'statusline\cship.toml'
    $script:Fixture  = Join-Path $PSScriptRoot 'fixtures\statusline-input.json'

    function Get-RenderedStatusline {
        Push-Location $script:RepoRoot
        try {
            $json = Get-Content $script:Fixture -Raw
            $out  = $json | & cship --config $script:Config 2>&1 | Out-String
            # Strip ANSI so assertions compare text, not colour codes.
            return ($out -replace "`e\[[0-9;]*m", '')
        } finally {
            Pop-Location
        }
    }

    $script:Rendered = Get-RenderedStatusline
    $script:Lines    = @($script:Rendered -split "`r?`n" | Where-Object { $_.Trim() })
}

Describe 'statusline rendering' {

    It 'produces exactly two non-empty lines' {
        # The old config produced one, silently. That is the bug this fixes.
        $script:Lines.Count | Should -Be 2
    }

    Context 'line 1' {
        It 'shows a clock time' {
            $script:Lines[0] | Should -Match '\d{2}:\d{2}'
        }
        It 'shows the project folder' {
            $script:Lines[0] | Should -Match 'space'
        }
        It 'shows the git branch' {
            $script:Lines[0] | Should -Match 'main'
        }
        It 'shows the added and removed line counts' {
            $script:Lines[0] | Should -Match '\+47'
            $script:Lines[0] | Should -Match '-12'
        }
    }

    Context 'line 2' {
        It 'shows the model' {
            $script:Lines[1] | Should -Match 'Opus 5'
        }
        It 'shows the session cost' {
            $script:Lines[1] | Should -Match '\$0\.42'
        }
        It 'shows a context bar percentage' {
            $script:Lines[1] | Should -Match '%'
        }
        It 'shows the Claude Code version from the cached file' {
            $script:Lines[1] | Should -Match 'v2\.1\.220'
        }
    }

    Context 'cost' {
        It 'renders in under 200 ms' {
            # A statusline redraws constantly; two subprocesses for the custom
            # modules are the budget, a third would be felt.
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            Get-RenderedStatusline | Out-Null
            $sw.Stop()
            $sw.ElapsedMilliseconds | Should -BeLessThan 200
        }
    }
}
```

- [ ] **Step 4: Test laufen lassen, Fehlschlag bestätigen**

```powershell
Invoke-Pester scripts\tests\Statusline.Tests.ps1 -Output Detailed
```

Erwartet: Fehlschlag, `statusline/cship.toml` existiert nicht.

- [ ] **Step 5: Die Konfiguration schreiben**

```toml
# cship — Claude Code statusline. Starship-compatible config: the [cship.*]
# sections are cship's own, everything else is handed to the starship binary.
# Without starship on PATH, line 1 renders empty and cship says nothing.
[cship]
lines = [
  "$time│ $directory│ $git_branch$git_state${custom.worktree}│ $cship.cost.total_lines_added $cship.cost.total_lines_removed",
  "$cship.model │ $cship.effort │ $cship.cost │ $cship.context_bar │ $cship.usage_limits │ $cship.peak_usage │ ${custom.ccversion}"
]

[time]
disabled    = false
time_format = "%H:%M"
format      = "[$time]($style) "
style       = "fg:#a9b1d6"

[directory]
truncation_length = 1
truncate_to_repo  = true
format            = "[$path]($style) "
style             = "bold fg:#7dcfff"

[git_branch]
format = "[$symbol$branch]($style) "
symbol = " "
style  = "fg:#9ece6a"

[git_state]
format = "[\\($state\\)]($style) "
style  = "bold fg:#e0af68"

# Starship has no worktree module. A worktree is exactly the case where
# --git-dir and --git-common-dir disagree; sh is used because spawning pwsh
# per render would cost more than the whole statusline.
[custom.worktree]
shell       = ["C:/Program Files/Git/bin/sh.exe", "-c"]
when        = 'test "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)"'
command     = 'basename "$PWD"'
format      = "[🌿 $output]($style) "
style       = "fg:#bb9af7"
description = "worktree marker"

# Written once per session by scripts/write-cc-version.ps1.
[custom.ccversion]
shell       = ["C:/Program Files/Git/bin/sh.exe", "-c"]
when        = 'test -f "$HOME/.claude/statusline/.cc-version"'
command     = 'cat "$HOME/.claude/statusline/.cc-version"'
format      = "[v$output]($style)"
style       = "fg:#565f89"
description = "Claude Code version"

[cship.model]
symbol = "🤖 "
style  = "bold cyan"

[cship.effort]
symbol = "⚡ "
style  = "fg:#bb9af7"

[cship.cost]
symbol             = "💰 "
style              = "fg:#a9b1d6"
warn_threshold     = 2.0
warn_style         = "fg:#e0af68"
critical_threshold = 5.0
critical_style     = "bold fg:#f7768e"
# Diff convention, not a threshold: added is green, removed is red.
total_lines_added_format   = "[+{value}](bold fg:#9ece6a)"
total_lines_removed_format = "[-{value}](bold fg:#f7768e)"

[cship.context_bar]
width              = 10
style              = "fg:#7dcfff"
warn_threshold     = 40.0
warn_style         = "fg:#e0af68"
critical_threshold = 70.0
critical_style     = "bold fg:#f7768e"

[cship.usage_limits]
five_hour_format   = "⌛ 5h {pct}% ({reset})"
seven_day_format   = "📅 7d {pct}% ({reset})"
separator          = " │ "
warn_threshold     = 60.0
warn_style         = "fg:#e0af68"
critical_threshold = 80.0
critical_style     = "bold fg:#f7768e"

[cship.peak_usage]
symbol = "📈 "
style  = "fg:#a9b1d6"
```

- [ ] **Step 6: Test laufen lassen und die unsicheren Stellen klären**

```powershell
Invoke-Pester scripts\tests\Statusline.Tests.ps1 -Output Detailed
```

Drei Dinge in der Konfiguration sind aus der cship-Dokumentation nicht
belegbar und müssen hier empirisch entschieden werden. Der Test sagt jeweils,
welcher Fall vorliegt:

1. **`total_lines_added_format` / `total_lines_removed_format`.** Falls cship
   diese Schlüssel nicht kennt, bleiben die Zahlen ungefärbt. Ausweg: die
   Farbe in der `lines`-Zeile setzen, also
   `[+$cship.cost.total_lines_added](bold fg:#9ece6a)`. Prüfen mit
   `cship explain --config statusline\cship.toml`; unbekannte Schlüssel
   tauchen dort nicht als Quelle auf.
2. **`[cship.effort]` und `[cship.peak_usage]`.** Beide sind in `explain` als
   Module gelistet, ein eigener Konfigurationsabschnitt ist aber nicht
   dokumentiert. Werden sie ignoriert, die Symbole entfernen und die Module
   nackt in der `lines`-Zeile lassen.
3. **Der sh-Pfad in den custom-Modulen.** Prüfen mit
   `Test-Path 'C:\Program Files\Git\bin\sh.exe'`. Liegt Git anderswo, den
   Pfad anpassen — und diese Anpassung in der README als PC-abhängig
   vermerken.

Bleibt der Zeitbudget-Test rot, ist der Worktree-Marker der teuerste Posten
(zwei `git rev-parse`-Aufrufe). Dann `custom.worktree` streichen und in der
README festhalten, dass Worktrees nur am Ordnernamen erkennbar sind.

- [ ] **Step 7: Alle Tests grün**

```powershell
Invoke-Pester scripts\tests\Statusline.Tests.ps1 -Output Detailed
```

Erwartet: alle Tests grün, insbesondere „produces exactly two non-empty
lines".

- [ ] **Step 8: Die aktive Konfiguration umstellen**

```powershell
Move-Item C:\Users\micro\.config\cship.toml C:\Users\micro\.config\cship.toml.bak
New-Item -ItemType SymbolicLink `
    -Path C:\Users\micro\.config\cship.toml `
    -Target C:\Users\micro\.claude\statusline\cship.toml
Get-Item C:\Users\micro\.config\cship.toml | Select-Object LinkType, Target
```

Schlägt das Anlegen mangels Rechten fehl, den Entwicklermodus einschalten
oder das Fenster als Administrator öffnen. Wenn beides ausscheidet, statt des
Symlinks kopieren — dann aber in der README vermerken, dass Änderungen
zurückkopiert werden müssen.

- [ ] **Step 9: Am echten Ort gegenprüfen**

```powershell
Get-Content scripts\tests\fixtures\statusline-input.json -Raw | cship
```

Erwartet: dieselben zwei Zeilen wie im Test, jetzt über die
Standard-Konfigurationsauflösung.

- [ ] **Step 10: Commit**

```powershell
git add statusline\cship.toml scripts\tests\Statusline.Tests.ps1 scripts\tests\fixtures\statusline-input.json
git commit -m "feat: render both statusline rows, including the missing first one"
```

---

### Task 6: Install-Skript

Stellt auf einem frischen PC alles her, was das Repo selbst nicht mitbringen
kann: Binaries, Plugins, Symlink, Git-Hook.

**Files:**
- Create: `C:\Users\micro\.claude\scripts\install.ps1`
- Create: `C:\Users\micro\.claude\scripts\tests\Install.Tests.ps1`

**Interfaces:**
- Consumes: `settings.json` aus Task 3, `statusline/cship.toml` aus Task 5,
  `scripts/pre-commit.ps1` aus Task 2.
- Produces: `Test-Prerequisite`, `Get-EnabledPlugin`, `Install-Symlink`,
  `Install-GitHook` — Signaturen unten im Code.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Die Installationsaufrufe selbst werden nicht getestet — sie verändern das
System. Getestet wird die Logik darum herum, und dass `-WhatIf` wirklich
nichts tut.

```powershell
# scripts/tests/Install.Tests.ps1
BeforeAll {
    $script:ScriptDir = Split-Path -Parent $PSScriptRoot
    $script:RepoRoot  = Split-Path -Parent $script:ScriptDir
    . (Join-Path $script:ScriptDir 'install.ps1') -DotSourceOnly
}

Describe 'Test-Prerequisite' {
    It 'reports a command that exists' {
        Test-Prerequisite -Name 'git' | Should -BeTrue
    }
    It 'reports a command that does not exist' {
        Test-Prerequisite -Name 'definitely-not-a-real-command-xyz' | Should -BeFalse
    }
}

Describe 'Get-EnabledPlugin' {
    It 'returns only the plugins set to true' {
        $settings = Join-Path $TestDrive 'settings.json'
        @'
{ "enabledPlugins": {
    "a@official": true,
    "b@official": false,
    "c@browser-use": true } }
'@ | Set-Content $settings
        $result = Get-EnabledPlugin -SettingsPath $settings
        $result | Should -HaveCount 2
        $result | Should -Contain 'a@official'
        $result | Should -Contain 'c@browser-use'
        $result | Should -Not -Contain 'b@official'
    }

    It 'returns nothing when there are no enabled plugins' {
        $settings = Join-Path $TestDrive 'empty.json'
        '{ "enabledPlugins": {} }' | Set-Content $settings
        @(Get-EnabledPlugin -SettingsPath $settings) | Should -HaveCount 0
    }

    It 'reads the real settings.json of this repo' {
        $real = Join-Path $script:RepoRoot 'settings.json'
        Get-EnabledPlugin -SettingsPath $real | Should -Contain 'browser-use@browser-use'
    }
}

Describe 'Install-Symlink' {
    It 'creates a link when the target does not exist' {
        $target = Join-Path $TestDrive 'source.txt'
        'hello' | Set-Content $target
        $link = Join-Path $TestDrive 'link.txt'
        Install-Symlink -Path $link -Target $target
        Get-Content $link | Should -Be 'hello'
    }

    It 'is idempotent when the correct link already exists' {
        $target = Join-Path $TestDrive 'source2.txt'
        'hello' | Set-Content $target
        $link = Join-Path $TestDrive 'link2.txt'
        Install-Symlink -Path $link -Target $target
        { Install-Symlink -Path $link -Target $target } | Should -Not -Throw
    }

    It 'refuses to clobber an existing real file' {
        # Silently deleting a config someone wrote by hand is unacceptable.
        $target = Join-Path $TestDrive 'source3.txt'
        'hello' | Set-Content $target
        $existing = Join-Path $TestDrive 'real.txt'
        'precious' | Set-Content $existing
        { Install-Symlink -Path $existing -Target $target } | Should -Throw
        Get-Content $existing | Should -Be 'precious'
    }

    It 'does nothing under -WhatIf' {
        $target = Join-Path $TestDrive 'source4.txt'
        'hello' | Set-Content $target
        $link = Join-Path $TestDrive 'link4.txt'
        Install-Symlink -Path $link -Target $target -WhatIf
        Test-Path $link | Should -BeFalse
    }
}

Describe 'Install-GitHook' {
    It 'writes a hook that calls the repo script' {
        $hooksDir = Join-Path $TestDrive 'hooks'
        New-Item -ItemType Directory -Path $hooksDir | Out-Null
        Install-GitHook -HooksDirectory $hooksDir
        $hook = Join-Path $hooksDir 'pre-commit'
        Test-Path $hook | Should -BeTrue
        Get-Content $hook -Raw | Should -Match 'pre-commit\.ps1'
    }

    It 'does nothing under -WhatIf' {
        $hooksDir = Join-Path $TestDrive 'hooks2'
        New-Item -ItemType Directory -Path $hooksDir | Out-Null
        Install-GitHook -HooksDirectory $hooksDir -WhatIf
        Test-Path (Join-Path $hooksDir 'pre-commit') | Should -BeFalse
    }
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```powershell
Invoke-Pester scripts\tests\Install.Tests.ps1 -Output Detailed
```

Erwartet: Abbruch, `install.ps1` existiert nicht.

- [ ] **Step 3: Das Skript implementieren**

```powershell
# scripts/install.ps1
# Bring a fresh Windows PC up to this repo's configuration: toolchain,
# plugins, the one symlink, the git hook. Idempotent — running it twice is
# a no-op that says so.
[CmdletBinding(SupportsShouldProcess)]
param([switch]$DotSourceOnly)

$ErrorActionPreference = 'Stop'

$script:RepoRoot = Split-Path -Parent $PSScriptRoot

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Skip { param([string]$Message) Write-Host "    skipped: $Message" -ForegroundColor DarkGray }
function Write-Done { param([string]$Message) Write-Host "    ok: $Message" -ForegroundColor Green }

function Test-Prerequisite {
    [OutputType([bool])]
    param([Parameter(Mandatory)][string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-EnabledPlugin {
    [OutputType([string[]])]
    param([Parameter(Mandatory)][string]$SettingsPath)

    $settings = Get-Content $SettingsPath -Raw | ConvertFrom-Json
    if (-not $settings.enabledPlugins) { return @() }

    return @(
        $settings.enabledPlugins.PSObject.Properties |
            Where-Object { $_.Value -eq $true } |
            ForEach-Object { $_.Name }
    )
}

function Install-Symlink {
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Target
    )

    if (Test-Path $Path) {
        $item = Get-Item $Path -Force
        if ($item.LinkType -eq 'SymbolicLink' -and $item.Target -contains $Target) {
            Write-Skip "$Path already links to the repo"
            return
        }
        # Never delete something a human may have written by hand.
        throw "$Path exists and is not a link to $Target. Move it aside first."
    }

    if ($PSCmdlet.ShouldProcess($Path, "symlink to $Target")) {
        $parent = Split-Path -Parent $Path
        if (-not (Test-Path $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        New-Item -ItemType SymbolicLink -Path $Path -Target $Target | Out-Null
        Write-Done "$Path -> $Target"
    }
}

function Install-GitHook {
    [CmdletBinding(SupportsShouldProcess)]
    param([Parameter(Mandatory)][string]$HooksDirectory)

    $hook = Join-Path $HooksDirectory 'pre-commit'
    # Git invokes hooks through sh even on Windows, hence the shebang shim.
    $body = "#!/bin/sh`nexec pwsh -NoProfile -File `"`$(git rev-parse --show-toplevel)/scripts/pre-commit.ps1`"`n"

    if ((Test-Path $hook) -and ((Get-Content $hook -Raw) -eq $body)) {
        Write-Skip 'pre-commit hook already installed'
        return
    }

    if ($PSCmdlet.ShouldProcess($hook, 'install pre-commit hook')) {
        [System.IO.File]::WriteAllText($hook, $body)
        Write-Done 'pre-commit hook installed'
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
    Install-Tool -Name 'uv' -Installer { Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression }

    Write-Step 'Installing cship'
    Install-Tool -Name 'cship' -Installer { Invoke-RestMethod https://cship.dev/install.ps1 | Invoke-Expression }

    Write-Step 'Installing starship'
    Install-Tool -Name 'starship' -Installer {
        winget install --id Starship.Starship --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -ne 0) {
            throw 'winget failed. Install starship manually, e.g. cargo install starship.'
        }
    }

    Write-Step 'Registering plugin marketplaces'
    foreach ($market in 'anthropics/claude-plugins-official', 'https://github.com/browser-use/plugins.git') {
        if ($PSCmdlet.ShouldProcess($market, 'add marketplace')) {
            # Already-registered is not an error worth aborting the run for.
            claude plugin marketplace add $market 2>&1 | Out-Null
            Write-Done $market
        }
    }

    Write-Step 'Installing user-level plugins'
    foreach ($plugin in Get-EnabledPlugin -SettingsPath (Join-Path $script:RepoRoot 'settings.json')) {
        if ($PSCmdlet.ShouldProcess($plugin, 'install plugin')) {
            claude plugin install $plugin --scope user 2>&1 | Out-Null
            Write-Done $plugin
        }
    }

    Write-Step 'Linking the statusline config'
    Install-Symlink -Path (Join-Path $HOME '.config\cship.toml') `
                    -Target (Join-Path $script:RepoRoot 'statusline\cship.toml')

    Write-Step 'Installing the git hook'
    Install-GitHook -HooksDirectory (Join-Path $script:RepoRoot '.git\hooks')

    Write-Step 'Summary'
    foreach ($tool in 'git', 'claude', 'uv', 'cship', 'starship') {
        $version = if (Test-Prerequisite -Name $tool) { (& $tool --version 2>&1 | Select-Object -First 1) } else { 'MISSING' }
        Write-Host ("    {0,-10} {1}" -f $tool, $version)
    }
}

if (-not $DotSourceOnly) {
    Invoke-Install
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

```powershell
Invoke-Pester scripts\tests\Install.Tests.ps1 -Output Detailed
```

Erwartet: alle Tests grün.

- [ ] **Step 5: Trockenlauf auf diesem PC**

```powershell
pwsh -NoProfile -File C:\Users\micro\.claude\scripts\install.ps1 -WhatIf
```

Erwartet: Meldungen zu jedem Schritt, `skipped` für die bereits vorhandenen
Werkzeuge, und **keine** Systemänderung.

- [ ] **Step 6: Echtlauf auf diesem PC**

Muss idempotent durchlaufen, weil hier alles schon steht.

```powershell
pwsh -NoProfile -File C:\Users\micro\.claude\scripts\install.ps1
```

Erwartet: durchweg `skipped` beziehungsweise `ok`, kein Fehler, und die
Versionstabelle am Ende ohne `MISSING`.

- [ ] **Step 7: Commit**

```powershell
git add scripts\install.ps1 scripts\tests\Install.Tests.ps1
git commit -m "feat: add an idempotent install script for a fresh machine"
```

---

### Task 7: README und globale Regel

Ohne die README ist das Repo auf einem zweiten PC nicht in Betrieb zu nehmen —
`git clone` scheitert dort ja am nicht-leeren Zielordner.

**Files:**
- Create: `C:\Users\micro\.claude\README.md`
- Modify: `C:\Users\micro\.claude\CLAUDE.md`
- Create: `C:\Users\micro\.claude\scripts\tests\Repo.Tests.ps1`

**Interfaces:**
- Consumes: alles aus den Tasks 1 bis 6.
- Produces: nichts, worauf Code aufbaut.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Getestet wird, was maschinell entscheidbar ist: dass die Dokumentation
existiert, die Inbetriebnahme beschreibt und die neue Regel enthält — und
dass die gesamte Testsuite grün ist.

```powershell
# scripts/tests/Repo.Tests.ps1
BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

Describe 'README' {
    BeforeAll {
        $script:Readme = Get-Content (Join-Path $script:RepoRoot 'README.md') -Raw
    }

    It 'explains the checkout that works into a non-empty folder' {
        $script:Readme | Should -Match 'git checkout -f main'
    }
    It 'points at the install script' {
        $script:Readme | Should -Match 'install\.ps1'
    }
    It 'warns against git clean' {
        # git clean -fdx in this folder would delete every session and credential.
        $script:Readme | Should -Match 'git clean'
    }
    It 'names the prerequisites the script does not install' {
        $script:Readme | Should -Match 'git'
        $script:Readme | Should -Match 'Claude Code'
    }
}

Describe 'global CLAUDE.md' {
    It 'requires specs and plans to live in the project repo' {
        $claudeMd = Get-Content (Join-Path $script:RepoRoot 'CLAUDE.md') -Raw
        $claudeMd | Should -Match 'docs/superpowers/specs'
        $claudeMd | Should -Match 'docs/superpowers/plans'
    }
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

```powershell
Invoke-Pester scripts\tests\Repo.Tests.ps1 -Output Detailed
```

Erwartet: Fehlschlag, `README.md` existiert nicht.

- [ ] **Step 3: Die README schreiben**

````markdown
# Claude-Code-Konfiguration

Dieses Repo *ist* `C:\Users\micro\.claude`. Es gibt keine Kopie und keinen
Sync-Schritt: Was Claude Code liest, ist was hier eingecheckt ist.

Versioniert wird nur die Nutzerebene — Einstellungen, Statusline, eigene
Skills und Agenten, Skripte, Dokumentation. Sitzungen, Verlauf, Zugangsdaten,
Caches und die Plugin-Zustandsdateien bleiben draußen.

Welche Plugins und MCP-Server ein *Projekt* nutzt, entscheidet das Projekt in
seiner eigenen `.claude/settings.json`. Hier steht ausschließlich, was auf
allen Rechnern gleich sein soll.

## Inbetriebnahme auf einem neuen PC

Voraussetzungen, die das Skript nicht installiert: **git**, **Claude Code**
und **PowerShell 7** (`pwsh`).

`git clone` funktioniert nicht — der Ordner existiert dort bereits und ist
nicht leer. Stattdessen:

```powershell
cd $HOME\.claude
git init -b main
git remote add origin <url>
git fetch
git checkout -f main
pwsh -NoProfile -File scripts\install.ps1
```

`checkout -f` überschreibt die Standarddateien, die ein frisch installiertes
Claude Code angelegt hat. Laufzeitdaten bleiben unberührt, weil sie nicht Teil
des Repos sind.

Danach Claude Code neu starten, damit Statusline und Plugins greifen.

## ⚠ Kein `git clean`

In diesem Repo ist `git clean` verboten. `git clean -fdx` würde alle
Sitzungen, den Verlauf und `.credentials.json` löschen — sie sind ungetrackt,
und genau das ist Absicht. Zum Verwerfen von Änderungen `git checkout --`
oder `git restore` verwenden.

## Was wo liegt

| Pfad | Inhalt |
|---|---|
| `settings.json` | Nutzereinstellungen, aktivierte Plugins, Hooks |
| `CLAUDE.md` | Globale Anweisungen für alle Projekte |
| `statusline/cship.toml` | Statusline; per Symlink als `~/.config/cship.toml` aktiv |
| `scripts/install.ps1` | Einrichtung eines neuen PCs, idempotent |
| `scripts/pre-commit.ps1` | Verhindert Commits mit Secrets |
| `scripts/write-cc-version.ps1` | SessionStart-Hook für die Versionsanzeige |
| `scripts/tests/` | Pester-5-Tests zu allem oben |
| `docs/superpowers/` | Specs und Implementierungspläne |

## Tests

```powershell
Invoke-Pester scripts\tests -Output Detailed
```

Pester 5 wird benötigt; das mit Windows gelieferte Pester 3.4.0 genügt nicht:

```powershell
Install-Module Pester -MinimumVersion 5.5.0 -Scope CurrentUser -Force -SkipPublisherCheck
```

Code-Coverage wird nicht gemessen — für PowerShell fehlt das Werkzeug im
Setup. Ersatzregel: Jedes Skript hat ein Testmodul.

## Bekannte PC-Abhängigkeiten

- Die `custom`-Module der Statusline rufen `sh.exe` unter
  `C:\Program Files\Git\bin\`. Liegt Git woanders, muss der Pfad in
  `statusline/cship.toml` angepasst werden.
- Der Symlink nach `~/.config/cship.toml` braucht entweder den
  Windows-Entwicklermodus oder eine Administrator-Sitzung.
````

- [ ] **Step 4: Die Regel in die globale CLAUDE.md aufnehmen**

Im Abschnitt *Pläne* nach dem bestehenden Aufzählungspunkt einfügen:

```markdown
- **Specs und Pläne liegen im Projekt-Repo.** Eine Superpowers-Spec gehört
  nach `docs/superpowers/specs/`, ein Implementierungsplan nach
  `docs/superpowers/plans/` — immer im Repo des Projekts, um das es geht.
  Nie in einem zentralen Ablageort, nie im Scratchpad. Ein Plan, der nicht
  neben dem Code liegt, den er beschreibt, wird nicht wiedergefunden.
```

- [ ] **Step 5: Test laufen lassen, Erfolg bestätigen**

```powershell
Invoke-Pester scripts\tests\Repo.Tests.ps1 -Output Detailed
```

Erwartet: alle Tests grün.

- [ ] **Step 6: Die gesamte Suite laufen lassen**

```powershell
cd C:\Users\micro\.claude
Invoke-Pester scripts\tests -Output Detailed
```

Erwartet: alle Tests aller sieben Tasks grün, keine übersprungenen.

- [ ] **Step 7: Ein letztes Mal prüfen, was das Repo enthält**

```powershell
git ls-files
```

Erwartet: ausschließlich `.gitignore`, `README.md`, `CLAUDE.md`,
`settings.json`, `statusline/cship.toml`, die Dateien unter `scripts/` und
unter `docs/`. Kein `.credentials.json`, keine `history.jsonl`, nichts aus
`plugins/`, `sessions/` oder `projects/`.

- [ ] **Step 8: Commit**

```powershell
git add README.md CLAUDE.md scripts\tests\Repo.Tests.ps1
git commit -m "docs: document bootstrap and require specs to live with their project"
```

- [ ] **Step 9: Remote anlegen und pushen**

Das Remote ist noch nicht festgelegt. Vor diesem Schritt beim Nutzer
nachfragen: privates GitHub-Repo, und unter welchem Namen. Erst dann:

```powershell
git remote add origin <url>
git push -u origin main
```

Das Repo **muss privat** sein. Es enthält zwar keine Secrets, aber die
vollständige Arbeitsumgebung samt Projektnamen.

---

## Selbstprüfung gegen die Spec

| Spec-Abschnitt | Task |
|---|---|
| Repo ist der Konfigurationsordner, keine Junction | 1 |
| Allowlist-`.gitignore` | 1 |
| Plugins: Absicht statt Zustand versionieren | 3, 6 |
| Secrets: Obsidian raus, `mcpServers` weg | 3 |
| `pre-commit`-Hook gegen Secrets | 2 |
| Statusline Zeile 1 und 2, Feldherkunft | 5 |
| Diff-Farben grün/rot | 5 |
| Schwellen 40/70 und 60/80, Preis 2/5 | 5 |
| Worktree-Erkennung | 5 |
| Claude-Code-Version ohne Subprozess | 4, 5 |
| `cship.toml` im Repo plus Symlink | 5, 6 |
| Install-Skript, neun Schritte | 6 |
| Akzeptanztest „beide Zeilen gefüllt" | 5 |
| Erstinbetriebnahme auf neuem PC | 7 |
| Tests, dokumentierte Coverage-Lücke | 1, 7 |
| Regel in der globalen CLAUDE.md | 7 |

Offen und bewusst so: Das Git-Remote steht noch nicht fest und wird in Task 7,
Schritt 9 erfragt.
