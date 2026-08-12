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

    Context 'catches further key shapes' {
        It 'flags a Google API key' {
            Find-Secret -Content 'AIzaSyA1234567890abcdefghijklmnopqrstuvw' -Path 'x.md' | Should -Not -BeNullOrEmpty
        }
        It 'flags a JWT' {
            $content = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc'
            Find-Secret -Content $content -Path 'x.md' | Should -Not -BeNullOrEmpty
        }
        It 'flags a modern OpenAI key containing dashes and underscores' {
            $content = 'sk-proj-AAAABBBBCCCCDDDD_EEEEFFFFGGGGHHHH-IIIIJJJJ'
            Find-Secret -Content $content -Path 'x.md' | Should -Not -BeNullOrEmpty
        }
    }
}

Describe 'Get-StagedFile' {

    BeforeEach {
        # A throwaway repo: the enumeration can only be tested against a real
        # index, and the config repo's own index must not be disturbed.
        $script:repo = Join-Path $TestDrive ([guid]::NewGuid().ToString('n'))
        New-Item -ItemType Directory -Path $script:repo | Out-Null
        Push-Location $script:repo
        git init --quiet 2>&1 | Out-Null
        git config user.email 'test@example.invalid'
        git config user.name 'Test'
    }

    AfterEach {
        Pop-Location
    }

    It 'enumerates a staged file whose name is not ASCII, under a name git show accepts' {
        Set-Content -Path (Join-Path $script:repo 'uber.md') -Value 'placeholder'
        $umlaut = Join-Path $script:repo ([char]0x00FC + 'ber.md')
        Set-Content -Path $umlaut -Value 'api_key = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"' -Encoding utf8
        Remove-Item (Join-Path $script:repo 'uber.md')
        git add -A 2>&1 | Out-Null

        $staged = @(Get-StagedFile)
        $expected = [char]0x00FC + 'ber.md'
        $staged | Should -Contain $expected

        # The name must round-trip: a path git cannot resolve reads as unscanned.
        git show ":$expected" 2>$null | Out-String | Should -Match 'api_key'
    }

    It 'includes a renamed file' {
        Set-Content -Path (Join-Path $script:repo 'old.md') -Value 'some tracked prose that is long enough to detect as a rename'
        git add old.md 2>&1 | Out-Null
        git commit -m 'seed' --no-verify --quiet 2>&1 | Out-Null
        git mv old.md new.md 2>&1 | Out-Null

        @(Get-StagedFile) | Should -Contain 'new.md'
    }
}

Describe 'Get-StagedSecretFinding' {

    It 'reports a finding when a staged blob cannot be read' {
        $findings = @(Get-StagedSecretFinding -File @('does/not/exist/in/index.md'))
        $findings | Should -Not -BeNullOrEmpty
        $findings -join "`n" | Should -Match 'could not read staged content'
    }
}
