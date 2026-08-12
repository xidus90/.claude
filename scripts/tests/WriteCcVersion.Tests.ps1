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
        Should -Invoke Get-ClaudeCliVersion -Times 1 -Exactly
    }

    It 'returns an empty string when nothing can be determined' {
        Mock Get-ClaudeCliVersion { '' }
        Resolve-ClaudeVersion -HookInput '{}' | Should -Be ''
        Should -Invoke Get-ClaudeCliVersion -Times 1 -Exactly
    }
}

Describe 'Resolve-ClaudeVersion shape guard' {

    It 'ignores a payload version that is an object' {
        Mock Get-ClaudeCliVersion { '9.9.9' }
        Resolve-ClaudeVersion -HookInput '{"version":{"a":1}}' | Should -Be '9.9.9'
        Should -Invoke Get-ClaudeCliVersion -Times 1 -Exactly
    }

    It 'ignores a payload version that is a number' {
        Mock Get-ClaudeCliVersion { '9.9.9' }
        Resolve-ClaudeVersion -HookInput '{"version":21}' | Should -Be '9.9.9'
        Should -Invoke Get-ClaudeCliVersion -Times 1 -Exactly
    }

    It 'ignores a payload version that is not version-shaped' {
        Mock Get-ClaudeCliVersion { '9.9.9' }
        Resolve-ClaudeVersion -HookInput '{"version":"latest"}' | Should -Be '9.9.9'
        Should -Invoke Get-ClaudeCliVersion -Times 1 -Exactly
    }
}

Describe 'the hook script as a process' {

    BeforeAll {
        $script:HookScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'write-cc-version.ps1'

        function Invoke-Hook {
            # Runs the hook with a throwaway HOME so a broken target cannot
            # touch the real cache file.
            param([string]$FakeHome, [string]$Payload)

            $dir = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid())
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            $in = Join-Path $dir 'in.json'
            $errFile = Join-Path $dir 'err.txt'
            $outFile = Join-Path $dir 'out.txt'
            [System.IO.File]::WriteAllText($in, $Payload)

            $saved = $env:USERPROFILE
            try {
                $env:USERPROFILE = $FakeHome
                $p = Start-Process pwsh `
                    -ArgumentList '-NoProfile', '-File', $script:HookScript `
                    -RedirectStandardInput $in -RedirectStandardError $errFile `
                    -RedirectStandardOutput $outFile -NoNewWindow -PassThru -Wait
            } finally {
                $env:USERPROFILE = $saved
            }

            $result = [pscustomobject]@{
                ExitCode = $p.ExitCode
                StdErr   = [System.IO.File]::ReadAllText($errFile)
            }
            Remove-Item $dir -Recurse -Force
            return $result
        }
    }

    It 'stays silent and exits 0 when the target file is locked' {
        $fakeHome = Join-Path $TestDrive 'locked'
        $target = Join-Path $fakeHome '.claude\statusline\.cc-version'
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        [System.IO.File]::WriteAllText($target, 'old')

        $stream = [System.IO.File]::Open(
            $target, 'Open', 'ReadWrite', [System.IO.FileShare]::None)
        try {
            $r = Invoke-Hook -FakeHome $fakeHome -Payload '{"version":"2.1.220"}'
        } finally {
            $stream.Dispose()
        }

        $r.ExitCode | Should -Be 0
        $r.StdErr | Should -BeNullOrEmpty
    }

    It 'stays silent and exits 0 when the parent path is a file' {
        $fakeHome = Join-Path $TestDrive 'parentfile'
        New-Item -ItemType Directory -Path (Join-Path $fakeHome '.claude') -Force | Out-Null
        [System.IO.File]::WriteAllText((Join-Path $fakeHome '.claude\statusline'), 'not a dir')

        $r = Invoke-Hook -FakeHome $fakeHome -Payload '{"version":"2.1.220"}'

        $r.ExitCode | Should -Be 0
        $r.StdErr | Should -BeNullOrEmpty
    }

    It 'writes the version and exits 0 on the happy path' {
        $fakeHome = Join-Path $TestDrive 'happy'
        New-Item -ItemType Directory -Path $fakeHome -Force | Out-Null

        $r = Invoke-Hook -FakeHome $fakeHome -Payload '{"version":"2.1.220"}'

        $r.ExitCode | Should -Be 0
        $r.StdErr | Should -BeNullOrEmpty
        [System.IO.File]::ReadAllText(
            (Join-Path $fakeHome '.claude\statusline\.cc-version')) | Should -Be '2.1.220'
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
