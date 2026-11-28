---
name: orca-emulator
description: >-
  iOS Simulator control from inside Teamerge, with the live device view in Teamerge's
  emulator pane. Use when driving a booted Apple Simulator on macOS: taps,
  gestures, typing, hardware buttons, rotation, and the accessibility tree, or
  when an iOS change needs simulator evidence. For an Android device or emulator
  use the Android emulator skill; build and install the app with xcodebuild or
  simctl first.
license: Apache-2.0
---

# Teamerge Emulator

This discovery stub loads the version-matched guide from the Teamerge executable used for this session.

Prefer Teamerge over raw `serve-sim` or direct `simctl` for simulator control inside Teamerge; it
handles device scoping, helper lifecycle, and worktree context.

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
ORCA skills get orca-emulator
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Teamerge is not running, start it with `ORCA open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `ORCA open` or restart Teamerge. If
`skills get` is unknown, explain that updating Teamerge restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
