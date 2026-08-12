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

    It 'returns nothing when the key is absent entirely' {
        $settings = Join-Path $TestDrive 'nokey.json'
        '{ "model": "opus" }' | Set-Content $settings
        @(Get-EnabledPlugin -SettingsPath $settings) | Should -HaveCount 0
    }

    It 'reads the real settings.json of this repo' {
        $real = Join-Path $script:RepoRoot 'settings.json'
        Get-EnabledPlugin -SettingsPath $real | Should -Contain 'browser-use@browser-use'
    }
}

Describe 'Get-MarketplaceForPlugin' {
    It 'maps an official plugin to the official marketplace' {
        Get-MarketplaceForPlugin -Plugin 'superpowers@claude-plugins-official' |
            Should -Be 'anthropics/claude-plugins-official'
    }
    It 'maps browser-use to its own marketplace' {
        Get-MarketplaceForPlugin -Plugin 'browser-use@browser-use' |
            Should -Be 'https://github.com/browser-use/plugins.git'
    }
    It 'returns nothing for a marketplace it does not know' {
        # Better to install nothing than to guess a URL and register a
        # marketplace the user never asked for.
        Get-MarketplaceForPlugin -Plugin 'thing@some-other-market' | Should -BeNullOrEmpty
    }
}

Describe 'Install-ConfigLink' {
    # cship.toml lives in the repo and must appear at ~/.config/cship.toml.
    # A symlink is preferred; Windows refuses it without admin or developer
    # mode, so a hardlink is the fallback. A hardlink shares content but not
    # identity, so it silently desyncs when git checkout REPLACES the repo
    # file rather than editing it in place. Hence every check below compares
    # content, never mere existence.

    It 'creates a link when nothing is there' {
        $target = Join-Path $TestDrive 'source.txt'
        'hello' | Set-Content $target -NoNewline
        $link = Join-Path $TestDrive 'link.txt'
        Install-ConfigLink -Path $link -Target $target
        Get-Content $link -Raw | Should -Be 'hello'
    }

    It 'creates the parent directory when it is missing' {
        $target = Join-Path $TestDrive 'source-nested.txt'
        'hello' | Set-Content $target -NoNewline
        $link = Join-Path $TestDrive 'no\such\dir\link.txt'
        Install-ConfigLink -Path $link -Target $target
        Test-Path $link | Should -BeTrue
    }

    It 'is idempotent when an in-sync link already exists' {
        $target = Join-Path $TestDrive 'source2.txt'
        'hello' | Set-Content $target -NoNewline
        $link = Join-Path $TestDrive 'link2.txt'
        Install-ConfigLink -Path $link -Target $target
        { Install-ConfigLink -Path $link -Target $target } | Should -Not -Throw
        Get-Content $link -Raw | Should -Be 'hello'
    }

    It 'repairs a desynced hardlink instead of declaring victory' {
        # The exact failure seen during this project: git rewrote the repo
        # file, the hardlink kept pointing at the old content, and the
        # statusline went stale with no error anywhere.
        $target = Join-Path $TestDrive 'source3.txt'
        'old' | Set-Content $target -NoNewline
        $link = Join-Path $TestDrive 'link3.txt'
        Install-ConfigLink -Path $link -Target $target

        # Simulate `git checkout` replacing the file rather than editing it.
        Remove-Item $target
        'new' | Set-Content $target -NoNewline
        Get-Content $link -Raw | Should -Be 'old'   # desynced, as expected

        Install-ConfigLink -Path $link -Target $target
        Get-Content $link -Raw | Should -Be 'new'
    }

    It 'never destroys an unrelated file: it backs it up first' {
        # A desynced hardlink is indistinguishable from a hand-written file:
        # once git replaces the repo file, the old inode loses its second
        # reference and what remains is an ordinary file. So the installer
        # cannot tell the two apart and must not gamble either way. It keeps
        # a copy and then relinks, which loses nothing and leaves a working
        # statusline.
        $target = Join-Path $TestDrive 'source4.txt'
        'hello' | Set-Content $target -NoNewline
        $existing = Join-Path $TestDrive 'precious.txt'
        'precious' | Set-Content $existing -NoNewline

        Install-ConfigLink -Path $existing -Target $target

        Get-Content $existing -Raw | Should -Be 'hello'
        $backup = Get-ChildItem -Path $TestDrive -Filter 'precious.txt.bak*' |
            Select-Object -First 1
        $backup | Should -Not -BeNullOrEmpty
        Get-Content $backup.FullName -Raw | Should -Be 'precious'
    }

    It 'does not pile up backups when it is already in sync' {
        $target = Join-Path $TestDrive 'source7.txt'
        'hello' | Set-Content $target -NoNewline
        $link = Join-Path $TestDrive 'link7.txt'
        Install-ConfigLink -Path $link -Target $target
        Install-ConfigLink -Path $link -Target $target
        Install-ConfigLink -Path $link -Target $target
        @(Get-ChildItem -Path $TestDrive -Filter 'link7.txt.bak*') | Should -HaveCount 0
    }

    It 'throws when the target does not exist' {
        $link = Join-Path $TestDrive 'link5.txt'
        { Install-ConfigLink -Path $link -Target (Join-Path $TestDrive 'nope.txt') } |
            Should -Throw
    }

    It 'does nothing under -WhatIf' {
        $target = Join-Path $TestDrive 'source6.txt'
        'hello' | Set-Content $target -NoNewline
        $link = Join-Path $TestDrive 'link6.txt'
        Install-ConfigLink -Path $link -Target $target -WhatIf
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

    It 'is idempotent' {
        $hooksDir = Join-Path $TestDrive 'hooks-idem'
        New-Item -ItemType Directory -Path $hooksDir | Out-Null
        Install-GitHook -HooksDirectory $hooksDir
        $first = Get-Content (Join-Path $hooksDir 'pre-commit') -Raw
        Install-GitHook -HooksDirectory $hooksDir
        Get-Content (Join-Path $hooksDir 'pre-commit') -Raw | Should -Be $first
    }

    It 'overwrites a stale hook' {
        $hooksDir = Join-Path $TestDrive 'hooks-stale'
        New-Item -ItemType Directory -Path $hooksDir | Out-Null
        Set-Content (Join-Path $hooksDir 'pre-commit') -Value '#!/bin/sh
echo outdated' -NoNewline
        Install-GitHook -HooksDirectory $hooksDir
        Get-Content (Join-Path $hooksDir 'pre-commit') -Raw | Should -Match 'pre-commit\.ps1'
    }

    It 'writes LF line endings, because sh reads it' {
        # A CRLF shebang line makes sh fail with a bare "not found" that
        # names neither the hook nor the reason.
        $hooksDir = Join-Path $TestDrive 'hooks-eol'
        New-Item -ItemType Directory -Path $hooksDir | Out-Null
        Install-GitHook -HooksDirectory $hooksDir
        $bytes = [System.IO.File]::ReadAllBytes((Join-Path $hooksDir 'pre-commit'))
        ($bytes -contains 13) | Should -BeFalse
    }

    It 'does nothing under -WhatIf' {
        $hooksDir = Join-Path $TestDrive 'hooks2'
        New-Item -ItemType Directory -Path $hooksDir | Out-Null
        Install-GitHook -HooksDirectory $hooksDir -WhatIf
        Test-Path (Join-Path $hooksDir 'pre-commit') | Should -BeFalse
    }
}

Describe 'Set-UserEnvironmentVariable' {
    # STARSHIP_CONFIG is not a nicety: cship never passes its own config to
    # the starship subprocess, so without this variable line 1 of the
    # statusline degrades to starship's default prompt. A fresh checkout has
    # no way to know this, which is why the installer must set it.

    BeforeAll {
        $script:ProbeName = 'CLAUDE_CONFIG_REPO_TEST_VAR'
    }
    AfterEach {
        [Environment]::SetEnvironmentVariable($script:ProbeName, $null, 'User')
    }

    It 'sets a variable that was not there' {
        Set-UserEnvironmentVariable -Name $script:ProbeName -Value 'abc'
        [Environment]::GetEnvironmentVariable($script:ProbeName, 'User') | Should -Be 'abc'
    }

    It 'reports no change when the value already matches' {
        Set-UserEnvironmentVariable -Name $script:ProbeName -Value 'abc'
        Set-UserEnvironmentVariable -Name $script:ProbeName -Value 'abc' |
            Should -Be 'unchanged'
    }

    It 'overwrites a stale value' {
        # The repo path differs per machine, so a value carried over from
        # another PC is worse than none.
        Set-UserEnvironmentVariable -Name $script:ProbeName -Value 'old'
        Set-UserEnvironmentVariable -Name $script:ProbeName -Value 'new'
        [Environment]::GetEnvironmentVariable($script:ProbeName, 'User') | Should -Be 'new'
    }

    It 'also sets it in the current process, so the caller can verify' {
        Set-UserEnvironmentVariable -Name $script:ProbeName -Value 'abc'
        (Get-Item "env:$script:ProbeName").Value | Should -Be 'abc'
    }

    It 'does nothing under -WhatIf' {
        Set-UserEnvironmentVariable -Name $script:ProbeName -Value 'abc' -WhatIf
        [Environment]::GetEnvironmentVariable($script:ProbeName, 'User') | Should -BeNullOrEmpty
    }
}

Describe 'the installer as a whole' {
    It 'changes nothing under -WhatIf' {
        # The only end-to-end assertion that is safe to make: a dry run must
        # leave the machine exactly as it found it.
        $before = @{
            Starship = [Environment]::GetEnvironmentVariable('STARSHIP_CONFIG', 'User')
            Link     = Test-Path (Join-Path $HOME '.config\cship.toml')
        }
        { Invoke-Install -WhatIf } | Should -Not -Throw
        [Environment]::GetEnvironmentVariable('STARSHIP_CONFIG', 'User') |
            Should -Be $before.Starship
        (Test-Path (Join-Path $HOME '.config\cship.toml')) | Should -Be $before.Link
    }
}
