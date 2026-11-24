# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(A Tauri v2 desktop app. The React UI runs in the system webview, which is WKWebView on macOS, WebView2 on Windows and WebKitGTK on Linux, inside native window chrome.)

## Users

Primary: developers working alongside AI coding agents (Claude Code, Codex, Cursor). Agents write and rewrite Markdown such as plans, specs, READMEs and notes, and the developer reads what changed, judges it, and sends feedback back. They work in a terminal or IDE, and this app sits beside it.

Secondary: people keeping a local Markdown notes folder (Obsidian-vault compatible), and anyone who double-clicks a `.md` file and wants it to read well.

## Product Purpose

A fast desktop reader and reviewer for Markdown. Files open formatted by default, and editing is one keystroke away. The app remembers the version of each file you last read and shows exactly what has changed since, so you can review a document written by an agent or a teammate like a diff, comment on it, and answer. It succeeds when a developer trusts it as the place where agent output lands and gets reviewed, and it never steals focus from their terminal.

## Positioning

Markdown review since you last read, wired directly to coding agents. One-click hooks open agent-written files in the background with changes highlighted, passage comments re-anchor across edits, and "Copy feedback" turns the comments into Markdown to paste back to the agent. It also live-streams piped output with `cmd | <app>`. None of the surveyed competitors (Typora, Obsidian, iA Writer, MarkEdit, Zettlr, Marked 2, VS Code preview) combines these.

## Operating Context

- Opened from Finder or Explorer, "Open with", the CLI (`markappoly file.md`, `claude -p … | markappoly`), or agent hooks that open files in the background.
- Used beside a terminal or IDE, often on the other half of the screen. Sessions are long stretches of reading with short bursts of editing.
- Works on local files only. Folders may be git repos or Obsidian vaults. It also opens CSV/TSV/JSON/JSONL as editable data views and source files as read-only code views.
- A macOS Quick Look extension renders Markdown in Finder.

## Capabilities and Constraints

- The full feature inventory is in README.md. Core features: GFM with alerts, KaTeX, Mermaid and frontmatter; Preview, Edit (CodeMirror, live formatting, slash menu) and Split; change review (F7 stepping, comments, Copy feedback, File History); notes (wiki links, backlinks, embeds, tags, graph, templates, daily notes); exports (txt/html/json/docx/pdf, optional Pandoc); auto-update; signed and notarized macOS builds.
- Constraints: release builds enforce a strict CSP, with style-src left open for CodeMirror. UI must be verified in a real release build rather than in `tauri dev`. Windows and Linux ship from the same code, so the chrome cannot depend on macOS-only effects without fallbacks.
- Name: **Markappoly** (confirmed 2026-11-24 after a rename was considered and declined). The CLI command is `markappoly` and the repo is `appoly/markappoly`. The bundle identifier `com.appoly.markdownviewer` and the crate name `markdown-viewer` stay internal.

## Brand Commitments

- Name: Markappoly. Publisher: Appoly Ltd (MIT licence). The Appoly link stays visible but quiet: "by Appoly" appears in About, the README footer and the licence, and not in the icon.
- The user has repeatedly asked for the app to feel native on the desktop (vibrancy, traffic lights inside the toolbar, system conventions) and not like a web page in a window. Treat that as binding.
- Icon, palette, type and voice are open for the rebrand. The "Pass Go" Monopoly pun is not binding.

## Evidence on Hand

- `README.md` (feature list, CLI docs), the GitHub wiki user manual, `assets/screenshot.png`, the current icon `assets/icon.svg` / `icon-macos.svg`, and `assets/social-preview.svg`.
- The repo has no user testimonials, usage numbers, press or download counts. Do not fabricate any.

## Product Principles

1. Reading comes first. A document opens formatted and stays calm, and editing is one keystroke away without getting in the way.
2. Show what changed. The user should never have to diff a document in their head.
3. Stay out of the agent's way: open files in the background, never steal focus, and keep hooks that always exit immediately and touch only their own config.
4. Plain files, no lock-in. Markdown on disk stays plain Markdown, and vaults keep working in other tools.
5. Native on every desktop. The app should behave like a well-made app for the OS it runs on.

## Accessibility & Inclusion

No product-specific standard is recorded. The default target is WCAG 2.2 AA for the app chrome, full keyboard operation (it is a keyboard-heavy tool), and respect for system light/dark, reduced motion and zoom.
