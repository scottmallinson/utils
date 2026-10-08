# desktop-updater

Auto-updates for the Electron apps in this repo, from their GitHub releases. Not published; apps
use it as a `workspace:*` dev dependency and electron-vite bundles it into their main process.

```ts
const updater = createUpdater({ name: 'pdf-maker', repo: 'scottmallinson/utils' });
// Add updater.menuItems() to the menu, then:
updater.start();
```

## How it works

1. **Check** (on launch after 10 s, then daily, if turned on; or from the menu): fetch the repo's
   releases and take the newest non-draft, non-prerelease `<name>-v<x.y.z>` tag above
   `app.getVersion()`. The repo holds several apps, so it can't use GitHub's "latest release".
2. **Ask**: Install Update, Release Notes, Skip This Version or Later. Skipped versions are only
   skipped by automatic checks. Preferences live in `userData/updates.json`.
3. **Download** the file for this platform and CPU, showing progress on the window, and check it
   against the SHA-256 digest GitHub publishes for each release asset. No digest, no install.
4. **Install as the app quits** (Restart Now, or whenever the user next quits):
   - **macOS** (`mac-zip`): unzip `<name>-<version>-mac-<arch>.zip` with `ditto`, then a
     detached `sh` script waits for the app's process to exit, swaps the `.app` bundle (putting
     the old one back if that fails) and reopens it on restart. This is used instead of
     Squirrel.Mac because the apps aren't code-signed, and Squirrel.Mac only installs signed
     updates. Files the app downloads itself aren't quarantined, so Gatekeeper doesn't prompt.
   - **Windows** (`win-nsis`): run `<name>-<version>-win-<arch>.exe /S --updated`, plus
     `--force-run` on restart. The NSIS installer reuses the existing install folder.
   - **Otherwise** (`manual`: portable Windows build, development, Linux, a Mac copy that is
     translocated or in a folder the user can't write to): open the release page instead.

`releases.ts` and `install.ts` hold the decisions and are unit tested, including running the
macOS swap script; `updater.ts` is the Electron glue. Each app's e2e test checks the menu flow
against a local stand-in for the releases API (`UTILS_UPDATE_RELEASES_URL`, honoured only when the
app isn't packaged).

## Gotchas

- Release file names come from each app's `electron-builder.yml` (`artifactName`) and must keep
  matching `assetName()`.
- Not yet tried on a per-machine Windows install, where the installer needs elevation.
- Apps run the installer from `will-quit`, so a quit that the app cancels (e.g. Prompt Queue's
  "prompts are still running") also postpones the install.
