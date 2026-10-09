BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $script:Config   = Join-Path $script:RepoRoot 'statusline\cship.toml'
    $script:Fixture  = Join-Path $PSScriptRoot 'fixtures\statusline-input.json'

    # cship hands starship the cwd from the payload, not the one the suite runs
    # in, so the expected folder name comes from the fixture rather than from
    # this file's location.
    $script:FixtureFolder = Split-Path -Leaf (
        (Get-Content $script:Fixture -Raw | ConvertFrom-Json).workspace.project_dir
    )

    # cship spawns starship as a subprocess and does not pass its own --config
    # along, so starship would fall back to its defaults and render line 1 as a
    # default prompt. One file serves both programs; the test pins the variable
    # so it does not depend on the shell it runs in.
    $env:STARSHIP_CONFIG = $script:Config

    # statusline/.cc-version is gitignored and written once per session by the
    # SessionStart hook, so it is missing on a fresh checkout. Supply it for the
    # duration of the run and remove it again if we were the ones to create it.
    $script:VersionFile  = Join-Path $script:RepoRoot 'statusline\.cc-version'
    $script:WroteVersion = -not (Test-Path $script:VersionFile)
    if ($script:WroteVersion) {
        Set-Content -Path $script:VersionFile -Value '2.1.220' -NoNewline -Encoding utf8
    }
    $script:Version = (Get-Content $script:VersionFile -Raw).Trim()

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

    function Get-LineCount {
        param([string]$Body)

        $file = Join-Path ([System.IO.Path]::GetTempPath()) "cship-guard-$([guid]::NewGuid()).toml"
        Set-Content -Path $file -Value $Body -Encoding utf8
        try {
            $out = Get-RenderedStatusline -ConfigPath $file
            return @($out -split "`r?`n" | Where-Object { $_.Trim() }).Count
        } finally {
            Remove-Item $file -ErrorAction SilentlyContinue
        }
    }

    # Renders the real config with its peak window replaced, returning the
    # non-empty lines.
    function Get-RenderedWithPeakWindow {
        param([int]$Start, [int]$End)

        $body = (Get-Content $script:Config -Raw).Replace(
            '[cship.peak_usage]', "[cship.peak_usage]`nstart_hour = $Start`nend_hour = $End")
        $file = Join-Path ([System.IO.Path]::GetTempPath()) "cship-peak-$([guid]::NewGuid()).toml"
        Set-Content -Path $file -Value $body -Encoding utf8
        try {
            $out = Get-RenderedStatusline -ConfigPath $file
            return @($out -split "`r?`n" | Where-Object { $_.Trim() })
        } finally {
            Remove-Item $file -ErrorAction SilentlyContinue
        }
    }

    $script:Rendered = Get-RenderedStatusline
    $script:Lines    = @($script:Rendered -split "`r?`n" | Where-Object { $_.Trim() })
}

AfterAll {
    if ($script:WroteVersion) {
        Remove-Item $script:VersionFile -ErrorAction SilentlyContinue
    }
}

Describe 'statusline rendering' {

    It 'produces exactly two non-empty lines' {
        # The old config produced one, silently. That is the bug this fixes.
        $script:Lines.Count | Should -Be 2
    }

    # The two guards below pin down what the assertion above actually measures:
    # the count has to come from line 1 rendering content, not from the split or
    # the ANSI stripping. $cship.agent is absent from the fixture and renders
    # nothing, $cship.cost renders "$0.42" — same shape of config, one bit of
    # difference, and the count follows it.
    It 'counts one line when line 1 renders nothing' {
        Get-LineCount '[cship]
lines = ["$cship.agent", "$cship.model"]' | Should -Be 1
    }

    It 'counts two lines when line 1 renders something' {
        Get-LineCount '[cship]
lines = ["$cship.cost", "$cship.model"]' | Should -Be 2
    }

    Context 'line 1' {
        It 'shows a clock time' {
            $script:Lines[0] | Should -Match '\d{2}:\d{2}'
        }
        It 'shows the project folder' {
            # Two earlier attempts hardcoded a folder name here and each picked
            # a different wrong one. The fixture is the only authority.
            $script:Lines[0] | Should -Match ([regex]::Escape($script:FixtureFolder))
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
        # cship decides peak from the system clock alone (Mon-Fri 07-17 US
        # Pacific, cship 1.8.0 src/modules/peak_usage.rs) and accepts no time
        # input, so against the real window this test passed or failed with the
        # hour. The window is the only knob: widening it to the whole day makes
        # the outcome depend on the Pacific weekday only, which the test computes
        # itself; narrowing it to nothing must always hide the slot.
        It 'shows the peak usage marker on a Pacific weekday when the window spans the day' {
            $pacificDay = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId(
                [DateTime]::UtcNow, 'Pacific Standard Time').DayOfWeek
            # ponytail: a render straddling Pacific midnight between Fri and Sat
            # can disagree with this day; rerun if it ever flakes at 09:00 Berlin.
            $isWeekday = $pacificDay -notin 'Saturday', 'Sunday'
            $line = (Get-RenderedWithPeakWindow -Start 0 -End 24)[1]
            ($line -match 'Peak') | Should -Be $isWeekday
        }
        It 'hides the peak usage marker when the window is empty' {
            $line = (Get-RenderedWithPeakWindow -Start 3 -End 3)[1]
            $line | Should -Not -Match 'Peak'
        }
        It 'shows the Claude Code version from the cached file' {
            $script:Lines[1] | Should -Match ([regex]::Escape("v$script:Version"))
        }
    }

    Context 'cost' {
        It 'renders in under 250 ms' {
            # A statusline redraws constantly, so the render has to stay cheap.
            # Measured spread over twelve runs on this machine: 168-199 ms with
            # a single 255 ms outlier, hence the median of five rather than a
            # single sample -- one scheduling hiccup must not fail the suite.
            # The budget still catches the regression this test exists for:
            # rendering line 1 as five separate `starship module` processes
            # measured 367-399 ms.
            $samples = 1..5 | ForEach-Object {
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                Get-RenderedStatusline | Out-Null
                $sw.Stop()
                $sw.ElapsedMilliseconds
            }
            $median = ($samples | Sort-Object)[2]
            $median | Should -BeLessThan 250
        }
    }
}
