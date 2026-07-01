<h1 align="center">
  <img src="resources/teamerge-logo.svg" alt="" width="40" valign="middle" style="background:linear-gradient(135deg,#5e5ce6,#0071e3);border-radius:10px;padding:6px" /> Teamerge
</h1>

<p align="center"><strong>Parallel coding agents, together — across every teammate’s machine.</strong></p>

Teamerge is a fork of [Orca](https://github.com/stablyai/orca) (MIT) that adds a team layer on top of Orca’s
worktree-per-task agent workflow. Everything Orca does still works; Teamerge adds the pieces you need when
several people, each with their own agents, work in the same repository.

## What Teamerge adds

|                                        | Teamerge                                                                                                                                                                                                                                                                                                                         | Orca                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Live teamwork between machines**     | Teammates’ agents appear in your Team hub, running on _their_ laptops. Watch a shared pane live; typing into it sends keystroke requests the owner approves. Owners can mute viewers, and every remote keystroke is logged.                                                                                                      | Several devices connect to one Orca server (sharing a machine).               |
| **No account, end‑to‑end encryption**  | Identity is a key pair on your machine; the roster is `.teamerge/team.json` in the repo, so anyone who can push is on the team. Traffic goes through a relay the team hosts (`teamerge relay`), which only sees sealed envelopes (X25519 + XSalsa20‑Poly1305, Ed25519‑signed connections).                                       | Orca account and Orca’s cloud relay.                                          |
| **Handing work between people**        | **Hand Off** a task with a drafted brief; the teammate presses **Take** and their agent continues on the same branch. **Request Review**: reviewers comment on lines from their machine and comments are typed straight into your agent. **Shared Markdown notes**, mirrored to `.teamerge/notes`.                               | —                                                                             |
| **Warnings before tasks collide**      | A chip on each workspace shows files shared with other tasks (local or a teammate’s) and turns red when a three‑way merge would conflict. Agents can **claim** files, and a pre‑edit hook warns an agent before it edits a file another task is changing. `teamerge context / why / risk` let agents ask who is working on what. | —                                                                             |
| **Child tasks that are real branches** | A child task branches from its parent and merges back into it, with **Update from Parent** and **Merge All Ready**.                                                                                                                                                                                                              | Nesting is sidebar-only.                                                      |
| **Landing queue**                      | **Ready to Land** / **Land All** merges finished tasks one after another, skips (with a reason) any that would conflict or are uncommitted, and lets you **Undo** a local landing.                                                                                                                                               | —                                                                             |
| **Races**                              | Give one task to 2–4 agents at once, compare their runs file by file side by side, **Keep This One**, and the other attempts are removed.                                                                                                                                                                                        | —                                                                             |
| **Stage and discard by hunk**          | Stage, unstage, or discard individual hunks, with **Undo**.                                                                                                                                                                                                                                                                      | Whole files.                                                                  |
| **Agent‑to‑agent messages**            | `teamerge send <task                                                                                                                                                                                                                                                                                                             | teammate/task> "…"`and`teamerge inbox`, end‑to‑end encrypted across machines. | —   |

The UI follows Apple’s Human Interface Guidelines (see `.claude/skills/apple-design`): the platform system
font, semantic light and dark palettes that follow the system appearance, inset grouped lists, and an
accessible accent blue (#0071E3, 4.6:1 with white text).

## The `teamerge` CLI

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

Build it with `pnpm build:teamerge-cli` (output: `out/teamerge/teamerge.cjs`).

## Getting started

Requires Node 24 and pnpm 12 (pinned in `package.json`).

```bash
pnpm install
pnpm dev
```

1. Add a repository, open **Team** in the sidebar, and **Create Team** (or **Host on This Mac** for a LAN relay).
2. Commit and push `.teamerge/team.json`.
3. Teammates open the same repository and choose **Join Team**, then commit and push the roster.

## Code map

- `src/main/teamerge/core/` — git engine (hunks, child branches, landing queue, races, collisions, claims),
  identity and encryption, relay server and client. No Electron imports; shared with the CLI.
- `src/main/teamerge/teamerge-service.ts`, `pane-share.ts`, `pty-tap.ts` — presence, live panes, inbox.
- `src/main/ipc/teamerge/`, `src/preload/api/teamerge-*.ts` — `window.api.teamerge`.
- `src/renderer/src/components/teamerge/` — the Team hub and in-app integrations.
- `src/main/teamerge/cli/teamerge-cli.ts` — the `teamerge` CLI.

Tests: `pnpm exec vitest run --config config/vitest.config.ts src/main/teamerge` (real git repos and a real relay).

## License

MIT, like Orca. Orca’s original README is at [docs/readme/README.orca.md](docs/readme/README.orca.md).
