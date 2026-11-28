---
name: orchestration
description: >-
  Run work in separate Teamerge worker agents and get their results back. Use when
  the user asks for Teamerge workers or supervision (monitor, task DAGs, ask/reply,
  decision gates), or when the work needs something your own subagents cannot
  give: a different agent (such as Codex from Claude) or its own Teamerge workspace.
  "Have Codex (or Claude) review this and report back" means a Teamerge worker of
  that agent, even when you have your own model subagents.
  Also use when you are a dispatched worker (a prompt with Task and Dispatch
  IDs: ask, worker_done). Otherwise prefer your own subagents,
  including for long or parallel work. Use `orca-cli` to hand work off with
  nothing expected back ("hand off", "handover", "give this to another agent",
  "another worktree"), and for terminal control, shell commands, worktree
  management, and reading or waiting on terminals.
---

# Teamerge Orchestration

This discovery stub loads the version-matched guide from the Teamerge executable used for this session.

Never substitute a non-Teamerge subagent tool when the user asked for Teamerge orchestration.

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
ORCA skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop and dispatched-worker
obligations. For a conditional action gate such as remote placement, uncertain release
recovery, or expanded DAG work, load only the reference that gate names with
`ORCA skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`ORCA skills get orchestration --full` and read the named bundled reference before acting.

Use the selected executable's `--help` for commands or flags the guide does not cover. If a
command reports that Teamerge is not running, start it with `ORCA open --json` and retry. If it
fails with `runtime_access_denied`, your sandbox blocked the connection: re-run it with
escalated permissions, and do not run `ORCA open` or restart Teamerge. If `skills get` is unknown,
explain that updating Teamerge restores the guide; use `--help` for read-only discovery and do not
guess unsupported commands.
