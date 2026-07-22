<p align="center">
  <img src="assets/logo.png" alt="Markappoly" width="560" />
</p>

<p align="center"><em>Pass Go, straight to preview.</em></p>

<p align="center">
  <a href="https://github.com/appoly/markappoly/releases/latest"><img src="https://img.shields.io/github/v/release/appoly/markappoly?label=download&color=2ea44f" alt="Latest release" /></a>
  <a href="https://github.com/appoly/markappoly/wiki"><img src="https://img.shields.io/badge/docs-user%20manual-blue" alt="User manual" /></a>
  <img src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-informational" alt="Platforms" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/appoly/markappoly" alt="License" /></a>
</p>

# Markappoly

A desktop app that opens Markdown files and shows them formatted, the way they're meant to look. Double-click a `.md` and you're reading it, not staring at raw `#` and `*`. When you do need to change something, one key flips you into an editor and back.

It's built with Tauri and React, so the download is small and it feels like a real Mac app rather than a web page in a window. Windows and Linux builds come from the same code.

## Screenshot

<p align="center">
  <img src="assets/screenshot.png" alt="Markappoly previewing a Markdown file" width="820" />
</p>

## Download

Grab the installer for your platform from the [latest release](https://github.com/appoly/markappoly/releases/latest):

On **macOS**, download the `.dmg`, open it, and drag Markappoly into Applications. The build is signed and notarized by Apple, so it opens without security warnings.

On **Windows**, download and run the `.msi`.

On **Linux**, download the `.AppImage` (make it executable, then run it) or install the `.deb`.

After the first launch the app keeps itself up to date: when a new version ships it asks before downloading, then restarts into the new one.

## Features

**Reading**
- Formatted preview by default, with GitHub-flavored Markdown: tables, task lists, strikethrough
- Syntax-highlighted code, **KaTeX math**, **Mermaid diagrams**, and GitHub-style alerts (`> [!NOTE]`)
- Outline sidebar (with scroll spy) and folder tree browser, find-in-document (⌘F), and search across a whole folder
- Open Recent, word count and reading time, live reload when the file changes on disk
- Session restore: tabs, folder, and view mode come back when you relaunch
- Adjustable reading width, font, and line spacing, plus your own custom CSS, and an option to block remote images
- YAML frontmatter chrome (title, tags, date) above the preview
- Relative Markdown links open sibling notes as tabs
- **Compare** two open files side by side as a diff
- **Present mode** (⌘⇧P): turn the document into slides, split on `---`

**Notes and linking**

Point Markappoly at a folder of notes (an Obsidian vault works as-is) and it behaves like a knowledge base:

- `[[Wiki links]]` jump between notes by name; type `[[` in the editor and it autocompletes from the folder
- A **backlinks** panel in the sidebar shows every note that links to the one you're reading, with the line it came from
- `![[Note]]` embeds a whole note into the preview; `![[Note#Section]]` embeds just that section
- `#tags` render as clickable chips, in the text and in frontmatter. Click one to search the folder for it
- Hover any internal link and a small rendered preview of the target pops up
- **Quick switcher** (⌘P): fuzzy-find any file, or type `>` for commands and `#` for tags
- **Local graph** (⌘⇧G): the current note in the middle, everything it links to and from around it
- **Bookmarks** (⌘D) pin your most-used files to the top of the sidebar
- Frontmatter is editable as **properties**: typed fields that write themselves back as YAML
- More preview syntax: `==highlights==`, `%%comments%%` that stay hidden, foldable callouts (`> [!note]-`), and Obsidian's extra callout types (info, question, danger, and friends)

**Editing**
- Toggle to a CodeMirror source editor with a formatting toolbar, or a **split view** (⌘⇧E) with editor and preview side by side, scrolling together
- **Focus mode** and **typewriter scrolling** for distraction-free writing, with editor spellcheck
- Table tools to insert, extend, and align Markdown tables
- Paste or drag an image to attach it next to the document; paste rich text and it converts to Markdown
- Tick a checkbox in the preview and it writes the change back to the source

Everything's tunable from **Settings** (⌘,).

**Export:** Text, HTML, JSON (AST), **Word (.docx)**, and PDF, plus **Copy as HTML** for pasting rich text elsewhere. With [Pandoc](https://pandoc.org) installed, also RTF, EPUB, LaTeX, and Pandoc-rendered Word and PDF.

**Native polish:** frosted vibrancy on macOS and acrylic on Windows, system/light/dark themes, a native menu bar, drag-and-drop, "open with" file association, and a window that reopens where you left it.

For a walkthrough of every feature, see the **[user manual](https://github.com/appoly/markappoly/wiki)**.

## Keyboard shortcuts

| Action | Shortcut | Action | Shortcut |
| ------ | -------- | ------ | -------- |
| Open | ⌘O | Find | ⌘F |
| Open folder | ⌘⇧O | Quick switcher | ⌘P |
| Save | ⌘S | Toggle edit/preview | ⌘E |
| Reload from disk | ⌘R | Split view | ⌘⇧E |
| Bookmark | ⌘D | Present | ⌘⇧P |
| Toggle sidebar | ⌘\ | Local graph | ⌘⇧G |
| Bold / Italic / Link | ⌘B / ⌘I / ⌘K | Zoom | ⌘+ / ⌘- / ⌘0 |
| Settings | ⌘, | New tab / Close | ⌘T / ⌘W |

## Build from source

For contributors. You'll need **Node 18+**, **Rust** (via [rustup](https://rustup.rs)), and your platform's [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # produce a native installer for your OS
```

**[DISTRIBUTION.md](DISTRIBUTION.md)** covers signing, notarization, the app icon, and auto-updates.

**Stack:** React + TypeScript + Vite · Tauri v2 (Rust) · unified/remark/rehype · CodeMirror 6 · KaTeX · Mermaid · `remark-docx`

## License

[MIT](LICENSE) © Appoly Ltd

---

<p align="center"><sub>Built by Appoly · "Do not pass Go, just preview your markdown."</sub></p>
