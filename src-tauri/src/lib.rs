use base64::{engine::general_purpose::STANDARD, Engine as _};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind, Debouncer};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

// ---------- Live file watching (replaces mtime polling) ----------

struct FileWatchState {
    debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

impl Default for FileWatchState {
    fn default() -> Self {
        Self {
            debouncer: Mutex::new(None),
        }
    }
}

fn path_key(p: &Path) -> String {
    // Normalize for comparison across platforms without requiring the file to exist.
    p.to_string_lossy().replace('\\', "/").to_lowercase()
}

/// Replace the set of watched files. Watches each file's parent directory (so
/// atomic save-via-rename from editors is still detected) and emits
/// `file-changed` with the original open-tab path when a watched file changes.
#[tauri::command]
fn set_watched_files(
    app: AppHandle,
    state: tauri::State<FileWatchState>,
    paths: Vec<String>,
) -> Result<(), String> {
    // key (normalized) → original path string the frontend opened with
    let mut by_key: HashMap<String, String> = HashMap::new();
    let mut parents = HashSet::new();
    for p in &paths {
        let pb = PathBuf::from(p);
        if let Some(parent) = pb.parent() {
            parents.insert(parent.to_path_buf());
        }
        by_key.insert(path_key(&pb), p.clone());
    }

    // Drop the previous debouncer (stops its thread) before creating a new one.
    {
        let mut slot = state.debouncer.lock().map_err(|e| e.to_string())?;
        *slot = None;
    }

    if parents.is_empty() {
        return Ok(());
    }

    let watched = Arc::new(by_key);
    let app_for_cb = app.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
            let Ok(events) = res else {
                return;
            };
            for ev in events {
                if ev.kind != DebouncedEventKind::Any {
                    continue;
                }
                let key = path_key(&ev.path);
                if let Some(original) = watched.get(&key) {
                    let _ = app_for_cb.emit("file-changed", original.clone());
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    for parent in parents {
        // Non-recursive: nested files register their own parent separately.
        let _ = debouncer
            .watcher()
            .watch(&parent, RecursiveMode::NonRecursive);
    }

    *state.debouncer.lock().map_err(|e| e.to_string())? = Some(debouncer);
    Ok(())
}

/// Whether a path currently exists as a regular file (session restore for tabs).
#[tauri::command]
fn path_exists(path: String) -> bool {
    Path::new(&path).is_file()
}

/// Whether a path currently exists as a directory (session restore for folders).
#[tauri::command]
fn path_is_dir(path: String) -> bool {
    Path::new(&path).is_dir()
}

/// Read a UTF-8 text file from an absolute path chosen via the dialog.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Write UTF-8 contents to an absolute path chosen via the dialog.
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Write base64-encoded binary contents (used for .docx export) to an absolute path.
#[tauri::command]
fn write_file_base64(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Last-modified time of a file in milliseconds since the Unix epoch (for live reload).
#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified: SystemTime = meta.modified().map_err(|e| e.to_string())?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64)
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    path: String,
}

const MD_EXTS: [&str; 6] = ["md", "markdown", "mdown", "mkd", "mkdn", "txt"];

fn collect_markdown(dir: &Path, base: &Path, out: &mut Vec<FileEntry>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        if path.is_dir() {
            collect_markdown(&path, base, out);
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if MD_EXTS.contains(&ext.to_lowercase().as_str()) {
                let rel = path.strip_prefix(base).unwrap_or(&path);
                out.push(FileEntry {
                    name: rel.to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                });
            }
        }
    }
}

/// List Markdown files under a folder (recursive) for the files sidebar.
#[tauri::command]
fn list_markdown_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let base = PathBuf::from(&path);
    if !base.is_dir() {
        return Err("not a directory".into());
    }
    let mut out = Vec::new();
    collect_markdown(&base, &base, &mut out);
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// A Markdown file passed on the command line (Windows/Linux "open with").
#[tauri::command]
fn cli_file_arg() -> Option<String> {
    std::env::args().skip(1).find(|a| {
        let p = Path::new(a);
        p.is_file()
            && p.extension()
                .and_then(|e| e.to_str())
                .map(|e| MD_EXTS.contains(&e.to_lowercase().as_str()))
                .unwrap_or(false)
    })
}

/// Files macOS asked us to open (Finder double-click / "open with") via the
/// `Opened` event. On a cold launch that event fires before the webview has
/// registered its listener, so the path is buffered here and drained by the
/// frontend on startup instead of being lost to the race.
#[derive(Default)]
struct PendingOpen(Mutex<Vec<String>>);

#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Vec<String> {
    let mut pending = state.0.lock().unwrap();
    std::mem::take(&mut *pending)
}

// ---------- Folder-wide search ----------

#[derive(Serialize)]
struct SearchHit {
    path: String,
    name: String,
    line: u32,
    text: String,
}

/// Case-insensitive search across every Markdown file in a folder (for the sidebar).
#[tauri::command]
fn search_dir(path: String, query: String) -> Result<Vec<SearchHit>, String> {
    let base = PathBuf::from(&path);
    if !base.is_dir() {
        return Err("not a directory".into());
    }
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    collect_markdown(&base, &base, &mut files);
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let mut hits = Vec::new();
    for f in &files {
        if hits.len() >= 300 {
            break;
        }
        let Ok(content) = fs::read_to_string(&f.path) else {
            continue;
        };
        for (i, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                hits.push(SearchHit {
                    path: f.path.clone(),
                    name: f.name.clone(),
                    line: (i as u32) + 1,
                    text: line.trim().chars().take(200).collect(),
                });
                if hits.len() >= 300 {
                    break;
                }
            }
        }
    }
    Ok(hits)
}

// ---------- Vault link/tag index ----------

#[derive(Serialize)]
struct LinkRef {
    target: String,
    line: u32,
    text: String,
    wiki: bool,
}

#[derive(Serialize)]
struct FileIndex {
    path: String,
    name: String,
    links: Vec<LinkRef>,
    tags: Vec<String>,
}

fn push_tag(tags: &mut Vec<String>, raw: &str) {
    let t = raw
        .trim()
        .trim_start_matches('#')
        .trim_matches(|c| c == '"' || c == '\'')
        .to_string();
    if t.is_empty() || tags.contains(&t) {
        return;
    }
    tags.push(t);
}

fn context_snippet(line: &str) -> String {
    line.trim().chars().take(200).collect()
}

fn scan_wiki_links(line: &str, lineno: u32, out: &mut Vec<LinkRef>) {
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("]]") else { break };
        let target = &after[..end];
        if !target.is_empty() && !target.contains('[') && !target.contains('\n') {
            out.push(LinkRef {
                target: target.to_string(),
                line: lineno,
                text: context_snippet(line),
                wiki: true,
            });
        }
        rest = &after[end + 2..];
    }
}

fn scan_md_links(line: &str, lineno: u32, out: &mut Vec<LinkRef>) {
    let mut rest = line;
    while let Some(pos) = rest.find("](") {
        let after = &rest[pos + 2..];
        let Some(end) = after.find(')') else { break };
        let target = after[..end].trim().trim_matches(|c| c == '<' || c == '>');
        rest = &after[end + 1..];
        let lower = target.to_lowercase();
        if target.is_empty()
            || target.starts_with('#')
            || lower.starts_with("http:")
            || lower.starts_with("https:")
            || lower.starts_with("mailto:")
        {
            continue;
        }
        let bare = target.split(['#', '?']).next().unwrap_or("").to_lowercase();
        if MD_EXTS.iter().any(|e| bare.ends_with(&format!(".{}", e))) {
            out.push(LinkRef {
                target: target.to_string(),
                line: lineno,
                text: context_snippet(line),
                wiki: false,
            });
        }
    }
}

fn scan_tags(line: &str, tags: &mut Vec<String>) {
    for token in line.split_whitespace() {
        let Some(rest) = token.strip_prefix('#') else {
            continue;
        };
        let end = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '/'))
            .unwrap_or(rest.len());
        let cleaned = &rest[..end];
        // Require at least one non-digit so "#123" (an issue ref) is not a tag.
        if cleaned.is_empty() || cleaned.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        push_tag(tags, cleaned);
    }
}

fn index_file_content(content: &str) -> (Vec<LinkRef>, Vec<String>) {
    let mut links = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    let mut in_fence = false;
    let mut in_frontmatter = false;
    let mut in_fm_tag_list = false;
    for (i, line) in content.lines().enumerate() {
        let lineno = (i as u32) + 1;
        if i == 0 && line.trim_end() == "---" {
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter {
            let t = line.trim();
            if t == "---" {
                in_frontmatter = false;
                continue;
            }
            if in_fm_tag_list {
                if let Some(item) = t.strip_prefix('-') {
                    push_tag(&mut tags, item);
                    continue;
                }
                in_fm_tag_list = false;
            }
            let lower = t.to_lowercase();
            for key in ["tags:", "tag:", "keywords:"] {
                if let Some(val) = lower.strip_prefix(key).map(|_| t[key.len()..].trim()) {
                    if val.is_empty() {
                        in_fm_tag_list = true;
                    } else {
                        let inner = val.trim_start_matches('[').trim_end_matches(']');
                        for part in inner.split(',') {
                            push_tag(&mut tags, part);
                        }
                    }
                    break;
                }
            }
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        scan_wiki_links(line, lineno, &mut links);
        scan_md_links(line, lineno, &mut links);
        scan_tags(line, &mut tags);
    }
    (links, tags)
}

/// Outgoing links (wiki + relative Markdown) and tags for every file in a
/// folder. Powers wiki-link resolution, the backlinks panel, and the graph.
#[tauri::command]
fn index_dir(path: String) -> Result<Vec<FileIndex>, String> {
    let base = PathBuf::from(&path);
    if !base.is_dir() {
        return Err("not a directory".into());
    }
    let mut files = Vec::new();
    collect_markdown(&base, &base, &mut files);
    let mut out = Vec::new();
    for f in files {
        let Ok(content) = fs::read_to_string(&f.path) else {
            continue;
        };
        let (links, tags) = index_file_content(&content);
        out.push(FileIndex {
            path: f.path,
            name: f.name,
            links,
            tags,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod index_tests {
    use super::index_file_content;

    #[test]
    fn indexes_wiki_and_md_links_and_tags() {
        let src = "---\ntags: [a, b]\n---\nSee [[Other Note]] and [x](./x.md) #tag\n```\n[[not-indexed]]\n```\n";
        let (links, tags) = index_file_content(src);
        assert_eq!(links.len(), 2);
        assert!(links[0].wiki);
        assert_eq!(links[0].target, "Other Note");
        assert_eq!(links[1].target, "./x.md");
        assert!(!links[1].wiki);
        assert_eq!(tags, vec!["a", "b", "tag"]);
    }

    #[test]
    fn skips_numeric_refs_and_web_links() {
        let (links, tags) = index_file_content("Issue #123, #real-tag, [w](https://x.com/a.md)\n");
        assert!(links.is_empty());
        assert_eq!(tags, vec!["real-tag"]);
    }

    #[test]
    fn collects_list_style_frontmatter_tags() {
        let (_, tags) = index_file_content("---\ntags:\n  - one\n  - two\n---\nBody\n");
        assert_eq!(tags, vec!["one", "two"]);
    }

    #[test]
    fn records_context_lines_for_backlinks() {
        let (links, _) = index_file_content("intro\n\nA line with [[Target]] in it\n");
        assert_eq!(links[0].line, 3);
        assert_eq!(links[0].text, "A line with [[Target]] in it");
    }
}

// ---------- Image attachments ----------

/// Save a pasted/dropped image next to the current document (in an `assets/`
/// folder) and return the relative path to insert into the Markdown.
#[tauri::command]
fn save_image(doc_path: String, data: String, ext: String) -> Result<String, String> {
    let doc = PathBuf::from(&doc_path);
    let dir = doc.parent().ok_or("the document has no folder")?;
    let assets = dir.join("assets");
    fs::create_dir_all(&assets).map_err(|e| e.to_string())?;

    let safe: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    let ext = if safe.is_empty() { "png".into() } else { safe };
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let name = format!("image-{}.{}", ts, ext);

    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    fs::write(assets.join(&name), bytes).map_err(|e| e.to_string())?;
    Ok(format!("assets/{}", name))
}

/// Copy an existing image file into the document's `assets/` folder.
#[tauri::command]
fn attach_image_file(doc_path: String, source: String) -> Result<String, String> {
    let doc = PathBuf::from(&doc_path);
    let dir = doc.parent().ok_or("the document has no folder")?;
    let assets = dir.join("assets");
    fs::create_dir_all(&assets).map_err(|e| e.to_string())?;

    let src = PathBuf::from(&source);
    let file_name = src
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .ok_or("source has no file name")?;
    let mut dest = assets.join(&file_name);
    // Avoid clobbering an existing file of the same name.
    if dest.exists() {
        let stem = src
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "image".into());
        let ext = src
            .extension()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "png".into());
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis();
        dest = assets.join(format!("{}-{}.{}", stem, ts, ext));
    }
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    let name = dest.file_name().unwrap().to_string_lossy().to_string();
    Ok(format!("assets/{}", name))
}

// ---------- Pandoc export ----------

/// Find a usable `pandoc` binary. GUI apps launched from Finder get a minimal
/// PATH, so we also probe the common Homebrew/system locations.
fn find_pandoc() -> Option<String> {
    let candidates = [
        "pandoc",
        "/opt/homebrew/bin/pandoc",
        "/usr/local/bin/pandoc",
        "/usr/bin/pandoc",
    ];
    for c in candidates {
        let ok = std::process::Command::new(c)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if ok {
            return Some(c.to_string());
        }
    }
    None
}

/// Whether Pandoc is installed (enables the richer export formats in the UI).
#[tauri::command]
fn pandoc_available() -> bool {
    find_pandoc().is_some()
}

/// Convert Markdown to any Pandoc-supported format, inferred from the output
/// file's extension.
#[tauri::command]
fn export_pandoc(src: String, out_path: String) -> Result<(), String> {
    let pandoc = find_pandoc().ok_or("Pandoc was not found on this system.")?;
    // A private temp file (0600, unique name) rather than a predictable,
    // world-readable path in the shared temp dir; it's removed on drop.
    let mut tmp = tempfile::Builder::new()
        .prefix("markappoly-")
        .suffix(".md")
        .tempfile()
        .map_err(|e| e.to_string())?;
    use std::io::Write as _;
    tmp.write_all(src.as_bytes()).map_err(|e| e.to_string())?;

    let result = std::process::Command::new(&pandoc)
        .arg(tmp.path())
        .arg("-f")
        .arg("gfm")
        .arg("-o")
        .arg(&out_path)
        .output();

    match result {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------- Recent files ----------

fn recents_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("recents.json"))
}

fn load_recents<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let Some(p) = recents_file(app) else {
        return vec![];
    };
    let Ok(s) = fs::read_to_string(&p) else {
        return vec![];
    };
    serde_json::from_str(&s).unwrap_or_default()
}

fn store_recents<R: Runtime>(app: &AppHandle<R>, list: &[String]) {
    if let Some(p) = recents_file(app) {
        if let Some(dir) = p.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(s) = serde_json::to_string(list) {
            let _ = fs::write(&p, s);
        }
    }
}

/// The recent-files list (most recent first), for the welcome screen.
#[tauri::command]
fn recent_files(app: AppHandle) -> Vec<String> {
    load_recents(&app)
        .into_iter()
        .filter(|p| Path::new(p).is_file())
        .collect()
}

/// Record a freshly opened file and refresh the native Open Recent menu.
#[tauri::command]
fn push_recent(app: AppHandle, path: String) {
    let mut list = load_recents(&app);
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(10);
    store_recents(&app, &list);
    if let Ok(menu) = build_app_menu(&app, &list) {
        let _ = app.set_menu(menu);
    }
}

/// Empty the recent-files list and refresh the menu.
#[tauri::command]
fn clear_recents(app: AppHandle) {
    store_recents(&app, &[]);
    if let Ok(menu) = build_app_menu(&app, &[]) {
        let _ = app.set_menu(menu);
    }
}

fn basename_str(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn build_app_menu<R: Runtime>(app: &AppHandle<R>, recents: &[String]) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "Markappoly")
        .about(Some(AboutMetadata::default()))
        .separator()
        .item(
            &MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("CmdOrCtrl+,")
                .build(app)?,
        )
        .separator()
        .hide()
        .quit()
        .build()?;

    let mut recent_builder = SubmenuBuilder::new(app, "Open Recent");
    if recents.is_empty() {
        recent_builder = recent_builder.item(
            &MenuItemBuilder::with_id("recent::none", "No Recent Files")
                .enabled(false)
                .build(app)?,
        );
    } else {
        for p in recents {
            recent_builder = recent_builder.item(
                &MenuItemBuilder::with_id(format!("recent::{}", p), basename_str(p)).build(app)?,
            );
        }
        recent_builder = recent_builder
            .separator()
            .item(&MenuItemBuilder::with_id("recent::clear", "Clear Recently Opened").build(app)?);
    }
    let recent_menu = recent_builder.build()?;

    let export_menu = SubmenuBuilder::new(app, "Export")
        .item(&MenuItemBuilder::with_id("export:txt", "Text (.txt)").build(app)?)
        .item(&MenuItemBuilder::with_id("export:html", "HTML (.html)").build(app)?)
        .item(&MenuItemBuilder::with_id("export:json", "JSON (.json)").build(app)?)
        .item(&MenuItemBuilder::with_id("export:docx", "Word (.docx)").build(app)?)
        .item(&MenuItemBuilder::with_id("export:pdf", "PDF…").build(app)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("open_folder", "Open Folder…")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(app)?,
        )
        .item(&recent_menu)
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("reload", "Reload from Disk").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("bookmark", "Bookmark This File")
                .accelerator("CmdOrCtrl+D")
                .build(app)?,
        )
        .separator()
        .item(&export_menu)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(
            &MenuItemBuilder::with_id("find", "Find…")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("copy_html", "Copy as HTML").build(app)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(
            &MenuItemBuilder::with_id("quick_switcher", "Quick Switcher…")
                .accelerator("CmdOrCtrl+P")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("local_graph", "Local Graph")
                .accelerator("CmdOrCtrl+Shift+G")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("toggle_mode", "Toggle Edit / Preview")
                .accelerator("CmdOrCtrl+E")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("toggle_split", "Toggle Split View")
                .accelerator("CmdOrCtrl+Shift+E")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("present", "Start Presentation")
                .accelerator("CmdOrCtrl+Shift+P")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("zoom_in", "Zoom In").build(app)?)
        .item(&MenuItemBuilder::with_id("zoom_out", "Zoom Out").build(app)?)
        .item(&MenuItemBuilder::with_id("zoom_reset", "Actual Size").build(app)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu])
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    let app = builder
        .manage(PendingOpen::default())
        .manage(FileWatchState::default())
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.clone());
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let recents = load_recents(&handle);
            let menu = build_app_menu(&handle, &recents)?;
            handle.set_menu(menu)?;

            // Native window chrome per platform.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                let window = app.get_webview_window("main").unwrap();
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::FollowsWindowActiveState),
                    None,
                )
                .expect("vibrancy is only supported on macOS");
            }
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                let window = app.get_webview_window("main").unwrap();
                let _ = apply_acrylic(&window, Some((18, 18, 18, 125)));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            write_file_base64,
            file_mtime,
            list_markdown_dir,
            index_dir,
            cli_file_arg,
            take_pending_open,
            search_dir,
            save_image,
            attach_image_file,
            pandoc_available,
            export_pandoc,
            recent_files,
            push_recent,
            clear_recents,
            set_watched_files,
            path_exists,
            path_is_dir
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // macOS delivers "open with" / Finder double-clicks as Opened events.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            let pending = app_handle.state::<PendingOpen>();
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let p = path.to_string_lossy().to_string();
                    // Buffer it for the cold-start drain AND emit for a window
                    // that is already up. openPath de-dupes, so either or both
                    // firing is fine.
                    pending.0.lock().unwrap().push(p.clone());
                    let _ = app_handle.emit("open-file", p);
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, &event);
        }
    });
}
