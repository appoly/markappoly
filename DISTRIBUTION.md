# Distribution & Release

How to sign, notarize, build, and ship Markdown Viewer. The app config (`src-tauri/tauri.conf.json`) is already wired for icons, file associations, and the updater plugin — the steps below cover the parts that need **your** credentials.

## 1. App icon

The icon set under `src-tauri/icons/` is generated from `app-icon.png` — a rounded square crop of the Markappoly logo (`assets/logo.png`):

```bash
npm run tauri icon ./app-icon.png   # or point at any 1024×1024 PNG
```

This regenerates every platform size (`.icns`, `.ico`, PNGs) referenced in `tauri.conf.json`. Replace `app-icon.png` with new artwork and re-run to rebrand.

## 2. macOS code signing + notarization (needs an Apple Developer account)

Notarization is required for Gatekeeper to open the app without warnings. You need a paid **Apple Developer** membership and a **Developer ID Application** certificate.

Set these environment variables before `tauri build`:

```bash
# Signing identity (from `security find-identity -v -p codesigning`)
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# Notarization — either an App Store Connect API key (recommended)…
export APPLE_API_ISSUER="<issuer-uuid>"
export APPLE_API_KEY="<key-id>"
export APPLE_API_KEY_PATH="/path/to/AuthKey_XXXX.p8"

# …or an app-specific password:
# export APPLE_ID="you@example.com"
# export APPLE_PASSWORD="app-specific-password"
# export APPLE_TEAM_ID="TEAMID"
```

Then:

```bash
npm run tauri build
```

Tauri signs the `.app`, staples the notarization ticket, and produces a `.dmg`. The `tauri.conf.json` `bundle.macOS` block can pin `minimumSystemVersion` and an entitlements file if you add capabilities (e.g. hardened runtime exceptions).

## 3. Windows / Linux

- **Windows**: set `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` (a base64 PFX) to authenticode-sign the `.msi`/`.exe`. The acrylic window effect is applied at runtime; no extra config.
- **Linux**: `tauri build` produces `.deb`/`.rpm`/AppImage. No vibrancy; the window uses a solid background.

## 4. Auto-updater

The updater plugin is wired in. To enable real updates:

1. **Generate a signing key** (one-time):
   ```bash
   npm run tauri signer generate -- -w ~/.tauri/markdown-viewer.key
   ```
   This prints a **public key** — paste it into `tauri.conf.json` → `plugins.updater.pubkey`. Keep the private key secret; expose it to CI as `TAURI_SIGNING_PRIVATE_KEY` (+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).

2. **Host an update manifest.** Point `plugins.updater.endpoints` at a URL serving JSON like:
   ```json
   {
     "version": "0.2.0",
     "notes": "What changed",
     "pub_date": "2026-06-09T00:00:00Z",
     "platforms": {
       "darwin-aarch64": {
         "signature": "<contents of the .sig file>",
         "url": "https://example.com/downloads/MarkdownViewer_0.2.0_aarch64.app.tar.gz"
       }
     }
   }
   ```
   GitHub Releases works well: upload the bundles + `latest.json` and point the endpoint at the release asset URL. The app checks this on launch (see `checkForUpdate()` in the frontend).

3. `tauri build` emits the signed update artifacts (`.tar.gz` + `.sig`) automatically once the key env vars are set.

The updater endpoint is set to `https://github.com/appoly/markappoly/releases/latest/download/latest.json`, which the release CI (below) publishes automatically.

## 5. Continuous releases (GitHub Actions)

`.github/workflows/release.yml` builds and publishes installers for macOS (Apple Silicon + Intel), Windows, and Linux whenever you push a version tag.

**Cut a release:**

```bash
# bump "version" in src-tauri/tauri.conf.json (e.g. 0.2.0), commit, then:
git tag v0.2.0
git push origin v0.2.0
```

The workflow builds every platform, creates a **draft** GitHub Release with the installers attached, and (when the signing key secret is set) attaches the updater `latest.json`. Review the draft and publish it.

**Required repo secrets** (Settings → Secrets and variables → Actions):

| Secret | Needed for | Status |
| ------ | ---------- | ------ |
| `TAURI_SIGNING_PRIVATE_KEY` | Signing auto-update artifacts | ✅ set |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Same (empty if the key has no password) | optional |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` | macOS Developer ID signing | ✅ set |
| `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_BASE64` | macOS notarization (App Store Connect API key) | ✅ set |

macOS builds are signed with the Developer ID certificate and notarized via the App Store Connect API key. The workflow decodes `APPLE_API_KEY_BASE64` into a `.p8` on the runner and points `APPLE_API_KEY_PATH` at it, so downloaded `.dmg`s open with a normal double-click — no Gatekeeper warning. The signing `.p12` was exported from Keychain and stored only as the encrypted `APPLE_CERTIFICATE` secret.
