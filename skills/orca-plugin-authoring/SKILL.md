---
name: orca-plugin-authoring
description: >-
  Build, debug, test, and publish Teamerge plugins end to end: app, terminal, and icon themes,
  syntaxes, language packs, custom editors, HTML or TSX components sidebar panels, palette
  commands and shortcuts, and Node worker commands that react to workspace and agent events.
  Use when the user asks to make, change, fix, or ship a Teamerge plugin, to add a panel,
  command, theme, editor, or language to Teamerge, or works in a folder with an orca-plugin.json.
  Use `orca-cli` only to list, enable, or disable plugins that are already installed.
---

# Teamerge Plugin Authoring

This discovery stub loads the version-matched guide from the Teamerge executable used for this session.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `ORCA_CLI_COMMAND` environment variable is set, use its value. Teamerge exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `ORCA_DEV_REPO_ROOT`, use `orca-dev`.
- Otherwise, on Linux outside a Teamerge-managed terminal, use `orca-ide`. Never run bare
  `orca` there — outside Teamerge's terminals it normally resolves to the
  GNOME Teamerge screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `orca`.

Below, `ORCA` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `ORCA` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Teamerge build.

## Load the version-matched guide before running Teamerge commands

```text
ORCA skills get orca-plugin-authoring
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Teamerge is not running, start it with `ORCA open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `ORCA open` or restart Teamerge. If
`skills get` is unknown, explain that updating Teamerge restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
