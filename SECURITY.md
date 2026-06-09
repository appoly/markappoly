# Security Policy

## Supported versions

Markappoly is distributed through GitHub Releases, and security fixes land on the latest release line. The built-in updater points every install at the most recent signed release, so the safest thing is to stay current.

| Version | Supported |
| ------- | --------- |
| 0.3.x   | ✅ |
| < 0.3   | ❌ |

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
