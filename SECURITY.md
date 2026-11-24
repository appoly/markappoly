# Security Policy

## Supported versions

Markappoly is distributed through GitHub Releases, and security fixes go into the latest release line. The built-in updater points every install at the most recent signed release, so staying current is the safest option.

| Version | Supported |
| ------- | --------- |
| Latest release | Yes |
| Older releases | No |

A scheduled GitHub Action runs the npm and Rust dependency audits every day. If a high/critical npm advisory or a Rust vulnerability has a non-breaking fix, the job applies it, bumps the patch version and opens a draft GitHub Release through the usual signed-build workflow. Findings with no upstream patch (see `audit-ci.jsonc`) stay on the allowlist and do not cut a release.

## Reporting a vulnerability

Please report security issues privately, and keep them out of public issues and pull requests.

To open a private report through GitHub, go to the repository's **Security** tab and click **Report a vulnerability** (GitHub Private Vulnerability Reporting). The details stay confidential until a fix is out.

We aim to acknowledge a report within a few business days, confirm the issue and ship a fix in a patch release. Please allow a reasonable window to release that fix before any public disclosure.

## Scope

Markappoly opens Markdown that can come from untrusted sources, so these are the areas most worth probing:

- The Markdown rendering pipeline (HTML sanitization and the Content Security Policy)
- The Tauri commands exposed to the webview (file read, write and move)
- Links in documents, which open other files in their default app through an allowlist and must never run a program
- The agent integration, which writes a hook entry into Claude Code, Codex and Cursor config files, and the `--cli hook` mode that reads the agents' JSON on stdin
- The CSV and JSON editors, which splice edits into the original file
- The auto-updater and release signing

Issues that require an already-compromised machine, or that rely on tricking the user into running something outside the app, are out of scope.

## Dependency audit status (0.12)

The npm and Rust vulnerability audits pass, and no advisories are on an ignore list. Eleven informational Rust warnings remain, all in transitive dependencies of Tauri and its GTK/WebKit stack on Linux:

- `glib` 0.18.5: RUSTSEC-2024-0429 affects `VariantStrIter` and can cause undefined behaviour and crashes. glib 0.20+ fixes it, but the current GTK3/WebKit dependencies require glib 0.18, so the fix needs an upstream migration or a reviewed backport.
- `proc-macro-error` 1.0.4: an unmaintained build-time dependency of the GTK macros.
- Five `unic-*` crates: unmaintained dependencies used by `urlpattern` through `tauri-utils`.
- `zbus_names`, `zvariant` and `zvariant_derive`: unmaintained crates in the D-Bus stack.

These warnings stay visible in `cargo audit`. A passing audit means neither that they are fixed nor that the application has had a full security review.
