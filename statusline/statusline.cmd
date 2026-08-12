@echo off
REM Claude Code statusline entry point.
REM
REM cship overrides the config path for the starship subprocess it spawns, so
REM starship never performs its own ~/.config/starship.toml lookup. Without
REM STARSHIP_CONFIG the first row renders starship stock prompt instead of
REM this repo layout, and the version field disappears with it.
REM
REM install.ps1 also sets the variable user-wide, but a running process never
REM re-reads the user environment, and Claude Code inherits the environment of
REM whatever launched it. Setting it here removes that dependency entirely.
REM
REM %USERPROFILE% keeps this account-independent, and cmd expands it, so the
REM caller needs no shell quoting. CRLF line endings are required: with LF,
REM cmd mis-parses the file and spews "Der Befehl M ..." on every render.
set "STARSHIP_CONFIG=%USERPROFILE%\.claude\statusline\cship.toml"
cship %*
