BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $script:Config   = Join-Path $script:RepoRoot 'statusline\cship.toml'
    $script:Fixture  = Join-Path $PSScriptRoot 'fixtures\statusline-input.json'

    # cship spawns starship as a subprocess and does not pass its own --config
    # along, so starship would fall back to its defaults and render line 1
    # empty. The machine sets this in the user environment; the test pins it so
    # it does not depend on the shell it runs in.
    $env:STARSHIP_CONFIG = Join-Path $script:RepoRoot 'statusline\starship.toml'

    function Get-RenderedStatusline {
        param([string]$ConfigPath = $script:Config)

        Push-Location $script:RepoRoot
        try {
            $json = Get-Content $script:Fixture -Raw
            $out  = $json | & cship --config $ConfigPath 2>&1 | Out-String
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

    It 'counts one line when the starship half of line 1 is missing' {
        # Guards the assertion above: without this, a two-line count could come
        # from line splitting rather than from line 1 actually rendering.
        $bare = Join-Path ([System.IO.Path]::GetTempPath()) 'cship-no-starship.toml'
        @'
[cship]
lines = ["$cship.peak_usage", "$cship.model"]
'@ | Set-Content -Path $bare -Encoding utf8
        try {
            $out   = Get-RenderedStatusline -ConfigPath $bare
            $lines = @($out -split "`r?`n" | Where-Object { $_.Trim() })
            $lines.Count | Should -Be 1
            $lines[0] | Should -Match 'Opus 5'
        } finally {
            Remove-Item $bare -ErrorAction SilentlyContinue
        }
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
