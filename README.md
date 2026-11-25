# VeloFrame

Ultra-fast, local-first desktop presentation studio engineered for locked 60–120fps HTML5 Canvas 2D rendering, R-tree spatial indexing, dirty-rectangle compositing, IndexedDB offline autosave, and a built-in GitHub Releases auto-updater.

## Desktop App & Built-In Auto-Updater

VeloFrame packages as a native Windows desktop application (`.exe` NSIS installer) via Electron + `electron-builder` + `electron-updater`:

- **Auto-Update Feed**: Configured to check `https://github.com/halxo/veloframe/releases` automatically on startup and on-demand via **Help → Check for Updates**, the top-bar menu, or `Ctrl+K` → **Check for Desktop Updates**.
- **In-App Update Banner**: Streams live download progress and provides a one-click **Restart & Install** button when a new GitHub Release is downloaded.

## Scripts

```bash
# Run web/canvas dev server
npm run dev

# Build renderer + Electron main/preload
npm run build:all

# Build local Windows NSIS .exe installer (output in release/)
npm run dist:win

# Build & publish Windows .exe + latest.yml to GitHub Releases
npm run release:win
```

## Automated GitHub Releases

Push a version tag (e.g., `git tag v1.0.1 && git push origin v1.0.1`) to trigger [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds `VeloFrame-Setup-<version>.exe` and `latest.yml` on `windows-latest` and publishes them to GitHub Releases so installed clients auto-update seamlessly.
