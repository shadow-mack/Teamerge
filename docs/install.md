# Installing Teamerge on macOS

1. Download `teamerge-macos-arm64.dmg` (Apple silicon) or `teamerge-macos-x64.dmg` (Intel) from
   [Releases](https://github.com/shadow-mack/Teamerge/releases/latest).
2. Open the disk image and drag **Teamerge** to **Applications**.
3. Open Teamerge from Applications.

## The first launch

Teamerge builds are not notarized by Apple yet, so the first time you open the app macOS shows
_“Teamerge” Not Opened_. **Do not press Move to Trash.** Press **Done**, then:

1. Open **System Settings → Privacy & Security**.
2. Scroll to **Security**. You will see _“Teamerge” was blocked to protect your Mac._
3. Press **Open Anyway** and confirm with your password or Touch ID.
4. Press **Open** in the dialog that follows.

macOS remembers the choice, so later launches open normally.

If you prefer the terminal, this clears the download flag on the installed copy instead:

```bash
xattr -dr com.apple.quarantine /Applications/Teamerge.app
```

## The `teamerge` command

Agents started inside Teamerge already have `teamerge` on their `PATH`. To use it in your own shell, link
it once:

```bash
ln -sf /Applications/Teamerge.app/Contents/Resources/bin/teamerge /usr/local/bin/teamerge
```

## Updating

Teamerge checks [Releases](https://github.com/shadow-mack/Teamerge/releases) and offers new versions in the
app. Every teammate should run the same version: the team relay’s message format can change between
releases.
