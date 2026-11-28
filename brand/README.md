# Teamerge brand

## Name and line

- **Name:** Teamerge, one word, capital T. The command is `teamerge`.
- **Tagline:** Parallel coding agents, together — across every teammate’s machine.
- **Short form:** Parallel coding agents, together.
- **Sub-line:** Every task in its own git worktree. Every teammate’s agents in one window.

## Mark

Two branches converging into one: two teammates’ work merging. The secondary branch is drawn at 72%
opacity.

| File                             | Use                                                              |
| -------------------------------- | ---------------------------------------------------------------- |
| `app-icon.svg`                   | The app icon: the mark in white on the indigo-to-blue tile.      |
| `menu-bar-mark.svg`              | The macOS menu bar template image: solid black, tinted by macOS. |
| `../resources/teamerge-logo.svg` | The bare white mark, for use on the brand tile in the app.       |

**The current app icon is a placeholder.** To replace it, overwrite `app-icon.svg` (1024×1024, with the
tile inset 100 px on each side like the current one) and run:

```bash
pnpm build:icons
```

That regenerates `resources/build/icon.icns`, `icon.ico` and `icon.png`, the in-app icons, the mobile app icons, the Midnight
and Light variants in `resources/app-icons/`, and the menu bar images in `resources/tray/`. It needs
Google Chrome (to render the SVG) and macOS’s `sips` and `iconutil`.

## Colour

| Token  | Light     | Dark      | Use                                       |
| ------ | --------- | --------- | ----------------------------------------- |
| Indigo | `#5e5ce6` | `#8e8dff` | Tile gradient start, secondary accent     |
| Blue   | `#0071e3` | `#3b8cff` | Tile gradient end, links, primary buttons |

The app’s own UI colours live in `src/renderer/src/assets/main.css`.
