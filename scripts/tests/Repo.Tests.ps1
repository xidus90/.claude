BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

Describe 'README' {
    BeforeAll {
        $script:Readme = Get-Content (Join-Path $script:RepoRoot 'README.md') -Raw
    }

    It 'explains the checkout that works into a non-empty folder' {
        # `git clone` refuses here, and that is the first wall a second PC hits.
        $script:Readme | Should -Match 'git checkout -f main'
    }
    It 'points at the install script' {
        $script:Readme | Should -Match 'install\.ps1'
    }
    It 'warns against git clean' {
        # `git clean -fdx` here would delete every session and credential.
        $script:Readme | Should -Match 'git clean'
    }
    It 'names the prerequisites the script does not install' {
        $script:Readme | Should -Match 'git'
        $script:Readme | Should -Match 'Claude Code'
    }
    It 'documents that the statusline link may be a hardlink and can go stale' {
        $script:Readme | Should -Match 'Hardlink'
    }
    It 'documents STARSHIP_CONFIG' {
        # Without it the first statusline row silently falls back to
        # starship's default prompt.
        $script:Readme | Should -Match 'STARSHIP_CONFIG'
    }
    It 'records that plugin state files are deliberately not versioned' {
        $script:Readme | Should -Match 'installed_plugins\.json'
    }
    It 'documents how to start an agent-team run' {
        # Without the starter line and the gate file nobody finds the way in.
        $script:Readme | Should -Match 'claude-team\.ps1'
        $script:Readme | Should -Match '\.claude/team-gate'
    }
}

Describe 'global CLAUDE.md' {
    It 'requires specs and plans to live in the project repo' {
        $claudeMd = Get-Content (Join-Path $script:RepoRoot 'CLAUDE.md') -Raw
        $claudeMd | Should -Match 'docs/superpowers/specs'
        $claudeMd | Should -Match 'docs/superpowers/plans'
    }
}

Describe 'statusline config layout' {
    It 'keeps starship top-level keys ahead of the first section' {
        # TOML binds a bare key to the section above it. Move `format` below
        # a [cship.*] header and the file either duplicates a key or hands
        # starship nothing — either way the first statusline row dies. The
        # README warns about this; this is the check that enforces it.
        $lines = Get-Content (Join-Path $script:RepoRoot 'statusline\cship.toml')
        $firstSection = ($lines | Select-String -Pattern '^\s*\[' | Select-Object -First 1).LineNumber
        foreach ($key in 'format', 'add_newline') {
            $hit = $lines | Select-String -Pattern "^\s*$key\s*=" | Select-Object -First 1
            if ($hit) {
                $hit.LineNumber | Should -BeLessThan $firstSection -Because "$key must precede the first [section]"
            }
        }
    }
}

Describe 'the statusline wrapper' {
    BeforeAll {
        $script:Wrapper = Join-Path $script:RepoRoot 'statusline\statusline.cmd'
    }

    It 'uses CRLF line endings' {
        # With LF, cmd mis-parses the batch file and prints a stream of
        # "Der Befehl M ..." errors above the statusline on every render.
        $text = [System.IO.File]::ReadAllText($script:Wrapper)
        $lf = ([regex]::Matches($text, "(?<!`r)`n")).Count
        $lf | Should -Be 0 -Because 'every LF must be preceded by CR'
    }

    It 'sets STARSHIP_CONFIG account-independently' {
        $text = [System.IO.File]::ReadAllText($script:Wrapper)
        $text | Should -Match 'STARSHIP_CONFIG'
        $text | Should -Match '%USERPROFILE%'
        $text | Should -Not -Match '(?i)C:\\Users\\'
    }
}

Describe 'the tracked set' {
    It 'has a test module for every script' {
        # The stand-in for the coverage threshold we cannot measure in
        # PowerShell: every script carries a test module.
        $scripts = Get-ChildItem (Join-Path $script:RepoRoot 'scripts') -Filter '*.ps1' -File
        $scripts | Should -Not -BeNullOrEmpty
        foreach ($s in $scripts) {
            $expected = Join-Path $script:RepoRoot "scripts\tests\$((Get-Culture).TextInfo.ToTitleCase($s.BaseName) -replace '-', '').Tests.ps1"
            Test-Path $expected | Should -BeTrue -Because "$($s.Name) needs $([System.IO.Path]::GetFileName($expected))"
        }
    }

    It 'tracks nothing but configuration' {
        Push-Location $script:RepoRoot
        try { $tracked = @(git ls-files) } finally { Pop-Location }

        $allowedFiles = @('.gitignore', '.gitattributes', 'README.md', 'CLAUDE.md',
                          'settings.json', 'keybindings.json')
        $allowedRoots = @('skills/', 'agents/', 'statusline/', 'scripts/', 'docs/')

        foreach ($file in $tracked) {
            $ok = ($allowedFiles -contains $file) -or
                  ($allowedRoots | Where-Object { $file.StartsWith($_) })
            $ok | Should -BeTrue -Because "$file is outside the allowlist"
        }
    }
}
