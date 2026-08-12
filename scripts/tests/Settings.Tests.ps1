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

    It 'hardcodes no account-specific path' {
        # The entire point of the repo is that a second PC gets the same
        # configuration. A path under one account's home directory silently
        # does nothing on any other account, and nothing would report it.
        $raw = Get-Content (Join-Path $script:RepoRoot 'settings.json') -Raw
        $raw | Should -Not -Match '(?i)C:\\\\Users\\\\'
    }

    It 'resolves the SessionStart hook relative to the running user' {
        $command = $script:Settings.hooks.SessionStart[0].hooks[0].command
        $command | Should -Match '\$HOME'
        $command | Should -Match 'write-cc-version\.ps1'
    }
}
