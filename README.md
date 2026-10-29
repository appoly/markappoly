<p align="center">
  <img src="assets/icon.png" alt="Markappoly" width="128" />
</p>

<p align="center"><em>Pass Go, straight to preview.</em></p>

<p align="center">
  <a href="https://github.com/appoly/markappoly/releases/latest"><img src="https://img.shields.io/github/v/release/appoly/markappoly?label=download&color=2ea44f" alt="Latest release" /></a>
  <a href="https://github.com/appoly/markappoly/wiki"><img src="https://img.shields.io/badge/docs-user%20manual-blue" alt="User manual" /></a>
  <img src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-informational" alt="Platforms" />
  <a href="LICENSE"><img src="https://img.shields.io/github/license/appoly/markappoly" alt="License" /></a>
</p>

# Markappoly

Markappoly is a desktop app for reading and editing Markdown. Double-click a `.md` file and it opens formatted, with headings, tables, code, math and diagrams drawn properly. Press ⌘E when you want to change something, and again to go back to reading.

It also keeps track of files that change under you. When an AI agent rewrites a plan or a teammate's edit arrives with `git pull`, Markappoly highlights what moved since you last read it. Claude Code, Codex and Cursor can open their files in it directly.

It's built with Tauri and React, so the download is small and the app uses the native window chrome on each platform. macOS, Windows and Linux builds come from the same code.

## Screenshot

<p align="center">
  <img src="assets/screenshot.png" alt="Markappoly previewing a Markdown file" width="820" />
</p>

## Download

Get the installer for your platform from the [latest release](https://github.com/appoly/markappoly/releases/latest).

- macOS: download the `.dmg`, open it, and drag Markappoly into Applications. The build is signed and notarized by Apple, so it opens without security warnings.
- Windows: download and run the `.msi`.
- Linux: download the `.AppImage` (make it executable, then run it) or install the `.deb`.

The app updates itself. When a new version ships it asks before downloading, then restarts into the new one.

## Features

### Reading

- GitHub-flavored Markdown: tables, task lists, strikethrough, footnotes and GitHub-style alerts (`> [!NOTE]`)
- Syntax-highlighted code, KaTeX math and Mermaid diagrams
- An outline with scroll spy, word count and reading time, and find in the document (⌘F)
- YAML frontmatter shown as a title, tags and date above the text
- Adjustable reading width, font and line spacing, your own CSS, and an option to block remote images
- With the sidebar closed, a slim heading rail shows where you are; hover or click it to jump between sections
- Present mode (⌘⇧P) turns the document into slides, split on `---`
- Compare two open files side by side as a diff

### Reviewing changes

Markappoly remembers the version of each file you last read. When the file changes on disk, it shows you the difference:

- Changed and added passages are highlighted in the preview, with a marker where text was removed. Hover a change to see what it said before
- A review bar counts the changes ("4 changes in 3 sections"), steps through them with F7 and ⇧F7, opens a source diff, and clears the highlights when you choose Mark as reviewed
- The outline puts a dot beside each section with unreviewed changes, and in Edit and Split view the changed lines are marked in the editor
- Select a passage to comment on it. Comments are stored per file and stay with their passage when the file changes
- Copy feedback turns your comments into Markdown, with each section name and quoted passage, ready to paste back to the author or an agent

You can turn change tracking off in Settings (Highlight outside changes).

### Working with agents

In Settings, under Agents, switch on Claude Code, Codex or Cursor. Markappoly then adds a hook to that agent's config, and whenever the agent writes or edits a Markdown file, the file opens here as a tab with its changes highlighted. It opens in the background, so your terminal or editor keeps focus while the agent works.

- The hook ignores other file types (including `.txt`) and always exits straight away, so it never slows down or fails the agent
- Markappoly adds or removes only its own entry and keeps the rest of the config. It backs up the original first, as `settings.json.markappoly.bak` or `hooks.json.markappoly.bak`
- Codex asks you to approve new hooks once: run `/hooks` in Codex after switching it on

The hooks live in `~/.claude/settings.json`, `~/.codex/hooks.json` and `~/.cursor/hooks.json`.

### Editing

- Edit view (⌘E) is a CodeMirror editor with live formatting: headings, emphasis, links, task boxes, tables and math look formatted as you type, and the Markdown markup reappears on the line you're editing. The file stays plain Markdown. You can switch to raw source in Settings
- Type `/` on an empty line to insert a block: headings, lists, tasks, quote, code, table, math, Mermaid, callout, divider, image or link
- Split view (⌘⇧E) puts the source and the preview side by side, scrolling together
- Heading and Insert menus, table tools to insert, extend and align tables, and ⌘B, ⌘I and ⌘K for bold, italic and links
- Focus mode, typewriter scrolling and spellcheck
- Paste or drag an image and it's saved next to the document. Paste rich text and it becomes Markdown
- Tick a checkbox in the preview and the change is written back to the source
- Optional autosave. File History keeps a snapshot before every save and before folder-wide replaces, and you can diff or restore any of them from the File menu

Save status and failures are shown in the status bar. Closing a changed file offers Save, Don't Save or Cancel, and reloading asks before discarding edits. If the file changed on disk while you were editing, saving asks before replacing it, and Save a copy gives you another way out.

### Notes and linking

Open a folder of notes (an Obsidian vault works as it is) and Markappoly treats it as a knowledge base:

- `[[Wiki links]]` jump between notes by name, and typing `[[` in the editor autocompletes from the folder
- The backlinks panel lists every note that links to the current one, with the line each link sits on
- `![[Note]]` embeds a whole note in the preview, and `![[Note#Section]]` embeds one section
- `#tags` show as chips in the text and in frontmatter. Click one to search the folder for it
- Hover an internal link to see a small preview of the target
- Graph (⌘⇧G) shows the current note's neighbours, or switch to Vault for a map of every note
- Templates: keep skeleton notes in a `Templates` folder and create new notes from them (⌘N), with `{{title}}`, `{{date}}` and `{{time}}` filled in
- Daily notes (⌘⇧D) open today's note and create it on first use. Name a template `Daily` to seed it
- Frontmatter is editable as properties, typed fields that are written back as YAML
- Extra preview syntax: `==highlights==`, hidden `%%comments%%`, foldable callouts (`> [!note]-`) and Obsidian's other callout types

### Data files

CSV, TSV, JSON and JSONL files open in Markappoly as well:

- CSV and TSV show as a table. Click a cell to edit it, and add or delete rows and columns
- JSON shows as labelled fields. True and false values are switches, numbers and strings are editable in place, and lists of records become small tables
- JSONL shows as one record per line, as a table when the records share their keys
- Saving rewrites only the values you changed, so the rest of the file stays byte for byte as it was

### Files, folders and tabs

- A folder tree that updates as other tools create, rename or delete files. Drag files and folders to move them on disk, and open tabs follow. Sort by name or by last edit, remembered for each folder
- Search a whole folder, with matching file names listed above matching lines, and replace across the folder
- Quick switcher (⌘P) finds any file. Type `>` for commands (or press ⌘K outside the editor), `#` for tags, or `@` for headings in the current document
- Drag tabs to reorder them, and reopen the last closed tab with ⌘⇧T
- Back and Forward (⌘[ and ⌘], or your mouse's side buttons) move between documents and sections
- Relative links open other notes as tabs, and `guide.md#install` lands on the heading. Links to source files open in a read-only code view (`main.rs#L42` jumps to the line). PDFs, images and office files open in their default app
- Bookmarks (⌘D) pin files to the top of the sidebar, and Open Recent remembers the rest
- Tabs, the open folder and each document's view mode come back when you relaunch, and each tab keeps its cursor, undo history and scroll position

### Export

Export to text, HTML, JSON (the Markdown syntax tree), Word (.docx) or PDF, or use Copy as HTML to paste rich text into another app. Exports match the preview. HTML is a single file with images inlined, diagrams as SVG and math that renders offline. Word keeps callouts, highlights, images, diagrams and equations. PDF waits for diagrams and fonts to finish before printing. With [Pandoc](https://pandoc.org) installed you also get RTF, EPUB, LaTeX, and Pandoc's own Word and PDF output.

### On your desktop

- Frosted vibrancy on macOS and acrylic on Windows
- System, light and dark themes. ⌘⇧L switches between light and dark
- A native menu bar, drag and drop, "Open with" file association, and a window that reopens where you left it
- On macOS, a Quick Look extension renders Markdown when you press Space on a `.md` file in Finder

Settings (⌘,) holds the reading preferences and everything else, and ⌘/ lists every shortcut. Less frequent actions such as Graph, Present, File History, Reload and zoom are in the More menu.

The [user manual](https://github.com/appoly/markappoly/wiki) walks through every feature.

## Keyboard shortcuts

On Windows and Linux, use Ctrl in place of ⌘.

| Action | Shortcut | Action | Shortcut |
| ------ | -------- | ------ | -------- |
| Open | ⌘O | Find | ⌘F |
| Open folder | ⌘⇧O | Quick switcher | ⌘P |
| New note | ⌘N | Commands | ⌘K (outside the editor) |
| Daily note | ⌘⇧D | Toggle edit / preview | ⌘E |
| Save | ⌘S | Split view | ⌘⇧E |
| Reload from disk | ⌘R | Present | ⌘⇧P |
| New tab / Close tab | ⌘T / ⌘W | Graph | ⌘⇧G |
| Reopen closed tab | ⌘⇧T | Toggle sidebar | ⌘\ |
| Back / Forward | ⌘[ / ⌘] | Light / dark | ⌘⇧L |
| Next / previous change | F7 / ⇧F7 | Zoom | ⌘+ / ⌘- / ⌘0 |
| Bold / Italic / Link | ⌘B / ⌘I / ⌘K | Bookmark | ⌘D |
| Settings | ⌘, | All shortcuts | ⌘/ |

## Command line

Choose Install Command Line Tool… from the Markappoly menu to get a `markappoly` command, similar to VS Code's `code`:

```bash
markappoly notes.md              # open a file
markappoly a.md b.md             # open several files as tabs
markappoly docs/                 # open a folder in the sidebar
markappoly guide.md#install      # open a file at a heading
claude -p "draft a plan" | markappoly   # show piped output, live as it streams
markappoly - < draft.md          # read stdin explicitly
markappoly --help
```

Paths are relative to the directory you run it from. If Markappoly is already open, the files open as tabs in the existing window, and your prompt comes straight back. Piped text goes to a temporary file (cleared after a week) that updates as more input arrives, so you can watch an agent's or a build's output as it's written.

Where it installs:

- macOS: a link in `/usr/local/bin` to the script inside `Markappoly.app`. You'll be asked for your password unless that folder is already writable; if you decline, it goes in `~/.local/bin`. To link it yourself: `ln -s /Applications/Markappoly.app/Contents/Resources/cli/markappoly /usr/local/bin/markappoly`
- Linux: `~/.local/bin/markappoly`, pointing at the AppImage or installed binary
- Windows: `markappoly.cmd` in `%LOCALAPPDATA%\Markappoly\bin`, added to your user `PATH`. Open a new terminal afterwards

## Build from source

You'll need Node 18+, Rust (via [rustup](https://rustup.rs)) and your platform's [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev      # run the app with hot reload
npm run tauri build    # produce a native installer for your OS
npm test               # run the frontend tests
```

[DISTRIBUTION.md](DISTRIBUTION.md) covers signing, notarization, the app icon, auto-updates and the daily security-audit release. [SECURITY.md](SECURITY.md) explains how to report a vulnerability.

The stack is React, TypeScript and Vite on Tauri v2 (Rust), with unified/remark/rehype for rendering, CodeMirror 6 for editing, KaTeX, Mermaid and `remark-docx`.

## License

[MIT](LICENSE) © Appoly Ltd

<p align="center"><sub>Built by Appoly · "Do not pass Go, just preview your markdown."</sub></p>
