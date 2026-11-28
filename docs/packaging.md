# Building Teamerge for macOS

How to turn a checkout into `Teamerge.app` and a disk image on your own Mac. To install a published
build instead, read [install.md](install.md).

## Once per machine

- Node 24 and pnpm 12 (the versions are pinned in `package.json`).
- Xcode Command Line Tools (`xcode-select --install`) for the native helpers.

```bash
pnpm install
pnpm --dir mobile install --frozen-lockfile
```

The second install is needed because the app bundles the mobile web client.

## Build

```bash
pnpm build:mac
```

This typechecks, builds the app, the CLIs and the native macOS helpers, and runs electron-builder. The
results land in `dist/`:

| File                                    | What it is                                         |
| --------------------------------------- | -------------------------------------------------- |
| `dist/mac-arm64/Teamerge.app`           | The app itself (Apple silicon)                     |
| `dist/teamerge-macos-arm64.dmg`         | The disk image to share                            |
| `dist/Teamerge-<version>-arm64-mac.zip` | The archive the in-app updater downloads           |
| `dist/latest-mac.yml`                   | Update metadata; written once every arch has built |

A local build is signed ad hoc, not with an Apple Developer ID, and it is not notarized. It runs on the
Mac that built it; on another Mac, follow the first-launch steps in [install.md](install.md).

### If the Swift helpers fail to build

`pnpm build:mac` compiles four small Swift helpers for both Apple silicon and Intel. If it stops with
`Invalid manifest` or `Undefined symbols for architecture x86_64`, the Command Line Tools install is
damaged. Reinstall it:

```bash
sudo rm -rf /Library/Developer/CommandLineTools && xcode-select --install
```

Installing full Xcode and running `sudo xcode-select -s /Applications/Xcode.app` works too.

## Publishing a release

1. Bump `version` in `package.json`.
2. Build as above.
3. Create a GitHub release on `shadow-mack/Teamerge` tagged `v<version>`, and attach the `.dmg`, `.zip`,
   `.zip.blockmap` and `latest-mac.yml` from `dist/`. The in-app updater reads `latest-mac.yml` from the
   latest release.

## Signing and notarization

A Developer ID signed and notarized build opens on any Mac without the first-launch steps. It needs an
Apple Developer account. Once you have one, set `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, and build with `pnpm build:mac:release`.

## Icons

The app icon comes from `brand/app-icon.svg`. After changing it, run
`pnpm build:icons` to regenerate every icon file; see
[brand/README.md](../brand/README.md).
