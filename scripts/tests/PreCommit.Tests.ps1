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
