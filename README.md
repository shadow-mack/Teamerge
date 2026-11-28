<h1 align="center">
  <img src="brand/app-icon.svg" alt="" width="96" /><br />
  Teamerge
</h1>

<p align="center"><strong>Parallel coding agents, together — across every teammate’s machine.</strong></p>

<p align="center">
  Every task in its own git worktree. Every teammate’s agents in one window.<br />
  <a href="https://github.com/shadow-mack/Teamerge/releases/latest">Download for macOS</a> ·
  <a href="docs/install.md">Install guide</a> ·
  <a href="#build-from-source">Build from source</a>
</p>

---

## What it is

Teamerge is a desktop app for teams that run coding agents in parallel. Claude Code, Codex and the
other agents each work in their own git worktree, so attempts never overwrite each other, and every
teammate’s agents show up in one Team hub, live, from their own laptops.

When several people each run several agents in the same repository, the hard part is not starting the
agents. It is knowing who is changing what, handing work between people, and landing it all without a
pile of conflicts. Teamerge is built for that part.

## What it does

|                                        |                                                                                                                                                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Live teamwork between machines**     | Teammates’ agents appear in your Team hub while they run on _their_ laptops. Watch a shared pane live; typing into it sends keystroke requests the owner approves. Owners can mute viewers, and every remote keystroke is logged.              |
| **No account, end‑to‑end encryption**  | Identity is a key pair on your machine, and the roster is `.teamerge/team.json` in the repo, so anyone who can push is on the team. Traffic goes through a relay the team hosts (`teamerge relay`), which only ever sees sealed envelopes.     |
| **Handing work between people**        | **Hand Off** a task with a drafted brief; your teammate presses **Take** and their agent continues on the same branch. **Request Review**: reviewers comment on lines from their machine, and the comments are typed straight into your agent. |
| **Warnings before tasks collide**      | Each workspace shows the files it shares with other tasks, yours or a teammate’s, and turns red when a merge would conflict. Agents can **claim** files, and a pre‑edit hook warns an agent before it edits a file another task is changing.   |
| **Child tasks that are real branches** | A child task branches from its parent and merges back into it, with **Update from Parent** and **Merge All Ready**.                                                                                                                            |
| **Landing queue**                      | **Ready to Land** / **Land All** merges finished tasks one after another, skips (with a reason) any that would conflict or are uncommitted, and lets you **Undo** a local landing.                                                             |
| **Races**                              | Give one task to 2–4 agents at once, compare their runs file by file, **Keep This One**, and the other attempts are removed.                                                                                                                   |
| **Stage and discard by hunk**          | Stage, unstage or discard individual hunks, with **Undo**.                                                                                                                                                                                     |
| **Agent‑to‑agent messages**            | `teamerge send <teammate or task> "…"` and `teamerge inbox`, end‑to‑end encrypted across machines.                                                                                                                                             |
| **Shared notes**                       | Markdown notes the whole team edits, mirrored to `.teamerge/notes` in the repository.                                                                                                                                                          |

## Install

Download the latest `.dmg` from [Releases](https://github.com/shadow-mack/Teamerge/releases/latest) and drag
Teamerge to Applications. The build is not notarized yet, so the first launch needs one extra step; the
[install guide](docs/install.md) walks through it.

## Quick start

1. **Add a repository**: a git checkout you already have.
2. **Create a team**: open **Team** in the sidebar and choose **Create Team**, or **Host on This Mac** to run
   the relay on your network.
3. **Commit and push `.teamerge/team.json`.**
4. **Teammates join**: they open the same repository, choose **Join Team**, and push the roster.
5. **Start tasks**: each one gets its own worktree and agent. Hand off, review, race and land from the Team hub.

## The `teamerge` CLI

Agents and people use the same commands. The app puts `teamerge` on every agent’s `PATH`.

```
teamerge context            # tasks here and on teammates' machines, claims, overlaps with yours
teamerge why <file>         # who is changing or has claimed a file, and the commits behind it
teamerge risk [file…]       # exit code 3 when merging your task would conflict
teamerge claim <file…> --note "why"   |   teamerge release [file…]   |   teamerge claims
teamerge install-hooks      # Claude Code PreToolUse hook: warn before editing a contested file
teamerge send <to> <msg>    |   teamerge inbox
teamerge relay --port 7787  # run the team's end-to-end encrypted relay
teamerge whoami | team
```

## Build from source

Requires Node 24 and pnpm 12 (pinned in `package.json`).

```bash
pnpm install
pnpm dev
```

To build the macOS app and disk image locally, see [docs/packaging.md](docs/packaging.md).

## Code map

- `src/main/teamerge/core/`: git engine (hunks, child branches, landing queue, races, collisions, claims),
  identity and encryption, relay server and client. No Electron imports; shared with the CLI.
- `src/main/teamerge/teamerge-service.ts`, `pane-share.ts`, `pty-tap.ts`: presence, live panes, inbox.
- `src/main/ipc/teamerge/`, `src/preload/api/teamerge-*.ts`: `window.api.teamerge`.
- `src/renderer/src/components/teamerge/`: the Team hub and in-app integrations.
- `src/main/teamerge/cli/teamerge-cli.ts`: the `teamerge` CLI.

Tests: `pnpm exec vitest run --config config/vitest.config.ts src/main/teamerge` (real git repos and a real relay).

## Credits and license

Teamerge is a fork of [Orca](https://github.com/stablyai/orca) (MIT), and builds its team layer on Orca’s
worktree-per-task agent workflow. Orca’s original README is at
[docs/readme/README.orca.md](docs/readme/README.orca.md).

MIT, like Orca.
