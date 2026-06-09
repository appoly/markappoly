<p align="center">
  <img src="assets/logo.png" alt="Markappoly" width="560" />
</p>

<p align="center"><em>Pass Go, straight to preview.</em></p>

# Markappoly

A fast, cross-platform desktop app for viewing — and editing — formatted Markdown. Built with **Tauri + React**, so it's tiny, native-feeling, and runs on macOS, Windows, and Linux.

## Features

**Reading**
- Formatted preview by default with GitHub-flavored Markdown (tables, task lists, strikethrough)
- Syntax-highlighted code, **KaTeX math**, and **Mermaid diagrams**
- Outline sidebar + folder browser, find-in-document (⌘F), word count & reading time
- Live reload when the file changes on disk

**Editing**
- One-key toggle to a CodeMirror source editor with a formatting toolbar
- Interactive task checkboxes (ticking in preview rewrites the source)

**Export** — Text, HTML, JSON (AST), **Word (.docx)**, and PDF

**Native polish** — frosted vibrancy (macOS) / acrylic (Windows), system/light/dark themes, native menu bar, drag-and-drop, "open with" file association, and remembered window state.

## Getting started

Prerequisites: **Node 18+**, **Rust** (via [rustup](https://rustup.rs)), and your platform's [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # launch the app with hot reload
```

## Building

```bash
npm run tauri build    # produces a native installer for your OS
```

Signing, notarization, app icon, and auto-updates are documented in **[DISTRIBUTION.md](DISTRIBUTION.md)**.

## Keyboard shortcuts

| Action | Shortcut | Action | Shortcut |
| ------ | -------- | ------ | -------- |
| Open | ⌘O | Find | ⌘F |
| Open folder | ⌘⇧O | Toggle edit/preview | ⌘E |
| Save | ⌘S | Toggle sidebar | ⌘\ |
| Reload from disk | ⌘R | Zoom | ⌘+ / ⌘- / ⌘0 |
| Bold / Italic | ⌘B / ⌘I | Link | ⌘K |

## Tech stack

React + TypeScript + Vite · Tauri v2 (Rust) · unified/remark/rehype · CodeMirror 6 · KaTeX · Mermaid · `remark-docx`

---

<p align="center"><sub>Built by Appoly · "Do not pass Go, just preview your markdown."</sub></p>
