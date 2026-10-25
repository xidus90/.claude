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

    It 'enables the user-level plugins' -ForEach @(
        @{ Plugin = 'superpowers@claude-plugins-official' }
        @{ Plugin = 'code-review@claude-plugins-official' }
        @{ Plugin = 'security-guidance@claude-plugins-official' }
        @{ Plugin = 'agent-panel@claude-config' }
    ) {
        $script:Settings.enabledPlugins.$Plugin | Should -BeTrue
    }

    It 'lists agent-panel in the marketplace of this repo' {
        $market = Get-Content (Join-Path $script:RepoRoot '.claude-plugin/marketplace.json') -Raw | ConvertFrom-Json
        $market.name | Should -Be 'claude-config'
        ($market.plugins | Where-Object name -EQ 'agent-panel').source | Should -Be './plugins-src/agent-panel'
    }

    It 'routes the statusline through the wrapper, not cship directly' {
        # Calling cship straight leaves STARSHIP_CONFIG to the inherited
        # environment, which a long-running Claude Code does not have. The
        # wrapper sets it per render, so row 1 works regardless of how the
        # process was launched.
        $script:Settings.statusLine.type | Should -Be 'command'
        $script:Settings.statusLine.command | Should -Be 'claude-statusline.cmd'
    }

    It 'names the statusline command without a path' {
        # It must resolve via PATH: an absolute path would be account-specific,
        # and cmd and sh disagree about every other way of writing one.
        $script:Settings.statusLine.command | Should -Not -Match '[\\/]'
    }

    It 'hardcodes no account-specific path' {
        # The entire point of the repo is that a second PC gets the same
        # configuration. A path under one account's home directory silently
        # does nothing on any other account, and nothing would report it.
        # autoMode.environment is prose the auto-mode classifier reads, not a
        # path anything opens, so a trusted repo may be named there.
        $settings = Get-Content (Join-Path $script:RepoRoot 'settings.json') -Raw | ConvertFrom-Json
        if ($settings.autoMode) { $settings.autoMode.PSObject.Properties.Remove('environment') }
        $settings | ConvertTo-Json -Depth 20 | Should -Not -Match '(?i)C:\\\\Users\\\\'
    }

    It 'resolves the SessionStart hook relative to the running user' {
        $command = $script:Settings.hooks.SessionStart[0].hooks[0].command
        $command | Should -Match 'write-cc-version\.ps1'
        $command | Should -Match "GetFolderPath\('UserProfile'\)"
    }

    It 'does not resolve the hook path through $HOME' {
        # Claude Code invokes hooks through a shell that sets a POSIX-style
        # HOME (/c/Users/...), which PowerShell adopts for $HOME. The hook
        # then failed with "\c\Users\micro\.claude\... is not recognized".
        # The .NET profile folder is immune to whatever the shell exports.
        $script:Settings.hooks.SessionStart[0].hooks[0].command |
            Should -Not -Match '\$HOME'
    }
}
