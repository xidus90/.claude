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

Describe 'tracked content' {

    BeforeAll {
        Push-Location $script:RepoRoot
        try {
            $script:TrackedFiles = @(git ls-files)
        } finally {
            Pop-Location
        }
    }

    # The first attempt at this repo committed a live Obsidian API key: the
    # staging check looked at paths only, so contents need their own guard.
    # The needles are assembled at runtime on purpose -- spelling them out
    # would make this very file a match and the assertion unsatisfiable.
    It 'has no leaked API key anywhere in history' {
        $needle = 'OBSIDIAN' + '_API_KEY'
        Push-Location $script:RepoRoot
        try {
            $history = git log --all -p | Out-String
        } finally {
            Pop-Location
        }
        $history.Contains($needle) | Should -BeFalse
    }

    # The leaked key was a 64-char hex string. Rather than keep a copy of it
    # here to search for, reject the shape: settings.json has no legitimate
    # reason to carry a secret-length hex run.
    It 'has no long hex secret in the committed settings' {
        Push-Location $script:RepoRoot
        try {
            $settings = git show 'HEAD:settings.json' | Out-String
        } finally {
            Pop-Location
        }
        $settings | Should -Not -Match '[0-9a-f]{32,}'
    }

    It 'tracks nothing outside the permitted set' {
        $permittedFiles = @('.gitignore', 'README.md', 'CLAUDE.md', 'settings.json', 'keybindings.json')
        $permittedRoots = @('skills', 'agents', 'statusline', 'scripts', 'docs')

        $offenders = @($script:TrackedFiles | Where-Object {
                $path = $_
                -not (
                    $permittedFiles -contains $path -or
                    ($permittedRoots | Where-Object { $path.StartsWith("$_/") })
                )
            })

        $offenders -join ', ' | Should -BeExactly ''
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
            @{ Path = '.gitattributes' }
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
