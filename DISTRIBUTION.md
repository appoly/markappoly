# Distribution & Release

How to sign, notarize, build and ship Markdown Viewer. The app config (`src-tauri/tauri.conf.json`) already sets up icons, file associations and the updater plugin. The steps below cover the parts that need your own credentials.

## 1. App icon

The icon artwork lives in `assets/icon.svg` (full-bleed tile, used for Windows, Linux, the README and the favicon) and `assets/icon-macos.svg` (the same tile on Apple's icon grid with a soft shadow, so it sits at the right size in the Dock). To regenerate:

```bash
node -e 'const s=require("sharp");s("assets/icon.svg",{density:288}).resize(1024,1024).png().toFile("app-icon.png")'
node -e 'const s=require("sharp");s("assets/icon-macos.svg",{density:288}).resize(1024,1024).png().toFile("/tmp/icon-macos.png")'
npm run tauri icon ./app-icon.png                        # every platform size
npx tauri icon /tmp/icon-macos.png -o /tmp/icon-macos    # then keep only its .icns
cp /tmp/icon-macos/icon.icns src-tauri/icons/icon.icns
node -e 'const s=require("sharp");s("assets/icon.svg",{density:144}).resize(256,256).png().toFile("assets/icon.png")'
cp assets/icon.svg public/icon.svg
```

`tauri icon` writes every size (`.icns`, `.ico`, PNGs) referenced in `tauri.conf.json`. The macOS `.icns` is then replaced with the gridded version.

## 2. macOS code signing + notarization (needs an Apple Developer account)

Gatekeeper only opens the app without warnings if it is notarized. You need a paid Apple Developer membership and a Developer ID Application certificate.

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

Tauri signs the `.app`, staples the notarization ticket, and produces a `.dmg`. If you add capabilities (for example, hardened runtime exceptions), the `bundle.macOS` block in `tauri.conf.json` can pin `minimumSystemVersion` and an entitlements file.

### Quick Look extension

The `.app` embeds a Quick Look preview extension (`Contents/PlugIns/MarkappolyQuickLook.appex`, macOS 13+) so pressing Space on a `.md` file in Finder shows it rendered. Sources live in `quicklook/`: a Swift `QLPreviewProvider` that runs marked plus `render.js` in JavaScriptCore and returns sandboxed HTML.

`tauri.macos.conf.json` runs `scripts/build-quicklook.mjs` as the `beforeBundleCommand` and copies the result in via `bundle.macOS.files`. Tauri's bundler signs the outer app without `--deep` and never signs those copied files, so the script signs the extension itself first (sandbox entitlement, hardened runtime, secure timestamp) using the same `APPLE_CERTIFICATE` / `APPLE_SIGNING_IDENTITY` env vars. Without an identity it ad-hoc signs the extension, which is fine for local builds. It builds only the slice for the target being bundled (`TAURI_ENV_TARGET_TRIPLE`) and needs nothing beyond the Command Line Tools' `swiftc`.

To check the renderer without bundling: `node scripts/build-quicklook.mjs --harness`, then `src-tauri/target/quicklook/harness src-tauri/target/quicklook/MarkappolyQuickLook.appex/Contents/Resources file.md`. To try the extension, install the built app in `/Applications`, run `qlmanage -r`, and press Space on a Markdown file; `pluginkit -m -p com.apple.quicklook.preview | grep appoly` shows whether it registered.

## 3. Windows / Linux

On Windows, set `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` (a base64 PFX) to Authenticode-sign the `.msi`/`.exe`. The acrylic window effect is applied at runtime and needs no extra config.

On Linux, `tauri build` produces `.deb`/`.rpm`/AppImage. Linux has no vibrancy, so the window uses a solid background.

## 4. Auto-updater

The updater plugin is already set up. To enable real updates:

1. Generate a signing key (one time only):
   ```bash
   npm run tauri signer generate -- -w ~/.tauri/markdown-viewer.key
   ```
   This prints a public key. Paste it into `plugins.updater.pubkey` in `tauri.conf.json`. Keep the private key secret, and give it to CI as `TAURI_SIGNING_PRIVATE_KEY` (plus `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).

2. Host an update manifest. Point `plugins.updater.endpoints` at a URL that serves JSON like this:
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
   GitHub Releases works well for this. Upload the bundles and `latest.json`, then point the endpoint at the release asset URL. The app checks it on launch (see `checkForUpdate()` in the frontend).

3. Once the key env vars are set, `tauri build` emits the signed update artifacts (`.tar.gz` and `.sig`) automatically.

The updater endpoint is set to `https://github.com/appoly/markappoly/releases/latest/download/latest.json`, which the release CI (below) publishes.

## 5. Continuous releases (GitHub Actions)

`.github/workflows/release.yml` builds and publishes installers for macOS (Apple Silicon and Intel), Windows and Linux whenever you push a version tag.

To cut a release:

```bash
# bump "version" in package.json, src-tauri/tauri.conf.json and
# src-tauri/Cargo.toml (e.g. 0.2.0), refresh the lockfiles, commit and push, then:
cargo metadata --manifest-path src-tauri/Cargo.toml --format-version 1 >/dev/null
git tag v0.2.0
git push origin v0.2.0
```

The workflow builds every platform and creates a draft GitHub Release with the installers attached. When the signing key secret is set, it also attaches the updater `latest.json`. Review the draft and publish it (`gh release edit v0.2.0 --draft=false --latest`). Until you do, the updater keeps serving the previous version.

You can also dispatch the workflow by tag (Actions → Release → Run workflow) and optionally paste release notes. The daily security job starts releases this way when it fixes an advisory.

Required repo secrets (Settings → Secrets and variables → Actions):

| Secret | Needed for | Status |
| ------ | ---------- | ------ |
| `TAURI_SIGNING_PRIVATE_KEY` | Signing auto-update artifacts | set |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Same (empty if the key has no password) | optional |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` | macOS Developer ID signing | set |
| `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_BASE64` | macOS notarization (App Store Connect API key) | set |

macOS builds are signed with the Developer ID certificate and notarized with the App Store Connect API key. The workflow decodes `APPLE_API_KEY_BASE64` into a `.p8` on the runner and points `APPLE_API_KEY_PATH` at it, so a downloaded `.dmg` opens with a normal double-click and Gatekeeper shows no warning. The signing `.p12` was exported from Keychain and is stored only as the encrypted `APPLE_CERTIFICATE` secret.

## 6. Daily security audit

`.github/workflows/daily-security.yml` runs every day at 06:00 UTC, and on demand.

1. It runs `npm audit` (high/critical, production deps, honouring `audit-ci.jsonc`) and `cargo audit`.
2. If a non-breaking fix exists, it runs `npm audit fix` / `cargo audit fix` and bumps the patch version in `package.json`, `Cargo.toml` and `tauri.conf.json`.
3. Once the unit tests and a frontend build pass, it commits, tags `vX.Y.Z` and dispatches the Release workflow above, so a signed draft appears on GitHub Releases.
4. If a high/critical npm advisory or any Rust vulnerability remains and cannot be auto-fixed, it opens (or comments on) an "Outstanding dependency vulnerabilities" issue and does not ship.

It does not cut a release for allowlisted advisories that are still unpatched. The job needs permission to push to `main` (or a bypass for the Actions bot if the branch is protected).

## 7. Website (GitHub Pages)

The site at https://appoly.github.io/markappoly/ is the static `site/` folder: `index.html`, `style.css`, `site.js` and `img/`. There is no build step.

`.github/workflows/pages.yml` deploys it whenever `site/` changes on `main` and whenever a release is published. Before uploading, it writes `site/release.json` from the GitHub API: the latest version, a direct link to each installer, and the total installer downloads across releases. `site.js` reads that file to fill in the Download button, the download table and the version line. Without it, every link falls back to the latest release page. `site/release.json` is gitignored.

The figures in `site/img/` are renders of the app's own frontend with demo documents. Each figure's numbered callouts are positioned in percent of the image in `index.html` (`--x`/`--y`, plus `--mx`/`--my` for phones), so a new screenshot needs its callout positions checked.

Search engines: `index.html` carries a canonical URL, Open Graph and Twitter tags, and SoftwareApplication JSON-LD. `site/sitemap.xml` lists the page. A project site can't serve `robots.txt` (that lives at the root of `appoly.github.io`), so submit the sitemap in Google Search Console if you want it indexed faster.
