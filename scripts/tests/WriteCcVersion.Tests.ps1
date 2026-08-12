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
