# Security Policy

## Supported versions

Markappoly is distributed through GitHub Releases, and security fixes land on the latest release line. The built-in updater points every install at the most recent signed release, so the safest thing is to stay current.

| Version | Supported |
| ------- | --------- |
| Latest release | ✅ |
| Older releases | ❌ |

A scheduled GitHub Action runs the npm and Rust dependency audits every day. If a high/critical npm advisory or a Rust vulnerability has a non-breaking fix, the job applies it, bumps the patch version, and opens a **draft** GitHub Release through the usual signed-build workflow. Findings with no upstream patch (see `audit-ci.jsonc`) are left on the allowlist and do not cut a release.

## Reporting a vulnerability

Please report security issues **privately**, not in public issues or pull requests.

Open a private report through GitHub: go to the repository's **Security** tab and click **Report a vulnerability** (GitHub Private Vulnerability Reporting). That keeps the details confidential until a fix is out.

We aim to acknowledge a report within a few business days, confirm the issue, and ship a fix in a patch release. Please allow a reasonable window to release that fix before any public disclosure.

## Scope

Markappoly opens Markdown that can come from untrusted sources, so the areas most worth probing are:

- The Markdown rendering pipeline (HTML sanitization and the Content Security Policy)
- The Tauri commands exposed to the webview (file read and write)
- The auto-updater and release signing

Issues that require an already-compromised machine, or that rely on tricking the user into running something outside the app, are out of scope.

## Dependency audit status (0.9.1)

Rustls was updated to 0.23.45 to fix RUSTSEC-2026-0285. Both npm and Rust vulnerability audits passed when preparing this release; no advisories were added to an ignore list.

Seven informational Rust warnings remain in Tauri's transitive dependencies:

- `glib` 0.18.5: RUSTSEC-2024-0429 affects `VariantStrIter` and can cause undefined behaviour and crashes. The fix is in glib 0.20+, but the current GTK3/WebKit dependencies require glib 0.18. A compatible lockfile update is unavailable; this requires an upstream dependency migration or a reviewed backport.
- `proc-macro-error` 1.0.4: unmaintained build-time dependency of the GTK macros.
- Five `unic-*` crates: unmaintained dependencies used by `urlpattern` through `tauri-utils`.

These warnings remain visible in `cargo audit`. A passing audit does not mean they are fixed or that the application has undergone a full security review.
