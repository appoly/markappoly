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

mod cli;

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

#[derive(Default)]
struct FolderWatchState {
    debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
}

/// Whether a change under the open folder can affect the tree or the vault
/// index: Markdown files and folders, outside hidden and build directories.
fn folder_change_matters(root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    if rel.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s.starts_with('.') || s == "node_modules" || s == "target"
    }) {
        return false;
    }
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => matches!(
            ext.to_ascii_lowercase().as_str(),
            "md" | "markdown" | "mdown" | "mkd" | "mkdn" | "txt"
        ),
        // No extension: a folder, or something that no longer exists.
        None => path.is_dir() || !path.exists(),
    }
}

/// Watch the open folder recursively and emit `folder-changed` when notes or
/// subfolders appear, disappear or change, so the tree and vault stay current
/// while other tools write files. `None` stops watching.
#[tauri::command]
fn set_watched_folder(
    app: AppHandle,
    state: tauri::State<FolderWatchState>,
    folder: Option<String>,
) -> Result<(), String> {
    {
        let mut slot = state.debouncer.lock().map_err(|e| e.to_string())?;
        *slot = None;
    }
    let Some(folder) = folder else {
        return Ok(());
    };
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Ok(());
    }
    let root_for_cb = root.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |res: Result<Vec<notify_debouncer_mini::DebouncedEvent>, _>| {
            let Ok(events) = res else {
                return;
            };
            if events
                .iter()
                .any(|ev| folder_change_matters(&root_for_cb, &ev.path))
            {
                let _ = app.emit("folder-changed", ());
            }
        },
    )
    .map_err(|e| e.to_string())?;
    debouncer
        .watcher()
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
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

/// Write UTF-8 contents to an absolute path, creating parent folders as needed
/// (daily notes can live in a subfolder that doesn't exist yet).
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Write base64-encoded binary contents (used for .docx export) to an absolute path.
#[tauri::command]
fn write_file_base64(path: String, data: String) -> Result<(), String> {
    let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
    fs::write(&path, bytes).map_err(|e| e.to_string())
}

/// Largest file `read_file_base64` will load. Exports inline images as data
/// URIs; anything bigger than this is almost certainly not a document image.
const MAX_INLINE_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// Read a binary file as base64 (export inlines local images into standalone
/// HTML and .docx files).
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > MAX_INLINE_FILE_BYTES {
        return Err("File is too large to embed".into());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
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

/// Files and folders to open that arrived from outside the app: launch
/// arguments (Windows/Linux "open with", the `markappoly` command), a second
/// launch forwarded by the single-instance plugin, and macOS `Opened` events
/// (Finder double-click). On a cold launch these arrive before the webview has
/// registered its listener, so they are buffered here and drained by the
/// frontend on startup instead of being lost to the race.
#[derive(Default)]
struct PendingOpen(Mutex<Vec<String>>);

/// Buffer paths for the startup drain AND emit them for a window that is
/// already up. The frontend de-dupes, so either or both landing is fine.
fn request_open(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<PendingOpen>()
        .0
        .lock()
        .unwrap()
        .extend(paths.iter().cloned());
    for p in paths {
        let _ = app.emit("open-file", p);
    }
}

/// "Install Command Line Tool…": install the `markappoly` command and report
/// the outcome in a native dialog. Runs off the main thread because the macOS
/// path may wait on an administrator password prompt.
fn install_cli(app: AppHandle) {
    std::thread::spawn(move || {
        use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
        let (kind, text) = match cli::install() {
            Ok(msg) => (MessageDialogKind::Info, msg),
            Err(msg) => (MessageDialogKind::Error, msg),
        };
        app.dialog()
            .message(text)
            .title("Command Line Tool")
            .kind(kind)
            .show(|_| {});
    });
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

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

// ---------- File history (snapshots) ----------

/// FNV-1a — a stable filename-safe key for a file path; no crypto needed.
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Per-file snapshot folder under the app data dir, keyed by hashed path plus a
/// readable stem so the folder is identifiable by hand.
fn history_dir_for<R: Runtime>(app: &AppHandle<R>, path: &str) -> Option<PathBuf> {
    let key = path_key(Path::new(path));
    let stem: String = Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "note".into())
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(40)
        .collect();
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("history").join(format!("{:016x}-{}", fnv1a(&key), stem)))
}

/// Snapshots in a history folder, newest first: (timestamp ms, file path).
fn list_snapshot_files(dir: &Path) -> Vec<(u64, PathBuf)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return vec![];
    };
    let mut out: Vec<(u64, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let ts = p.file_stem()?.to_str()?.parse::<u64>().ok()?;
            Some((ts, p))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out
}

const SNAPSHOT_MIN_INTERVAL_MS: u64 = 5 * 60 * 1000;
const SNAPSHOT_KEEP: usize = 30;

/// Copy the current on-disk contents of `path` into its history folder. Rate
/// limited (unless forced) so autosave doesn't churn out near-identical
/// snapshots; identical content is never duplicated.
fn take_snapshot<R: Runtime>(app: &AppHandle<R>, path: &str, force: bool) -> Result<(), String> {
    let src = Path::new(path);
    if !src.is_file() {
        return Ok(());
    }
    let Some(dir) = history_dir_for(app, path) else {
        return Ok(());
    };
    let existing = list_snapshot_files(&dir);
    let now = now_ms();
    if let Some((ts, latest)) = existing.first() {
        if let (Ok(a), Ok(b)) = (fs::read(src), fs::read(latest)) {
            if a == b {
                return Ok(());
            }
        }
        if !force && now.saturating_sub(*ts) < SNAPSHOT_MIN_INTERVAL_MS {
            return Ok(());
        }
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::copy(src, dir.join(format!("{}.md", now))).map_err(|e| e.to_string())?;
    let _ = fs::write(dir.join("path.txt"), path);
    for (_, p) in list_snapshot_files(&dir).iter().skip(SNAPSHOT_KEEP) {
        let _ = fs::remove_file(p);
    }
    Ok(())
}

/// Record a snapshot of a file's current on-disk state (called before saving).
#[tauri::command]
fn snapshot_file(app: AppHandle, path: String, force: Option<bool>) -> Result<(), String> {
    take_snapshot(&app, &path, force.unwrap_or(false))
}

#[derive(Serialize)]
struct Snapshot {
    ts: u64,
    path: String,
    size: u64,
}

/// Saved snapshots for a file, newest first (for the File History view).
#[tauri::command]
fn list_snapshots(app: AppHandle, path: String) -> Vec<Snapshot> {
    let Some(dir) = history_dir_for(&app, &path) else {
        return vec![];
    };
    list_snapshot_files(&dir)
        .into_iter()
        .map(|(ts, p)| {
            let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            Snapshot {
                ts,
                path: p.to_string_lossy().to_string(),
                size,
            }
        })
        .collect()
}

// ---------- Opening linked files outside the app ----------

/// File types a document link may hand to the system's default app. An
/// allowlist, so a link can never launch an executable, script or installer.
/// CSV and TSV open in the app's own table view instead. Mirrors EXTERNAL_EXTS
/// in src/navigation.ts.
const EXTERNAL_OPEN_EXTS: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tif", "tiff", "heic", "avif",
    "ico", "mp3", "m4a", "wav", "ogg", "flac", "mp4", "m4v", "mov", "webm", "xlsx", "xls",
    "docx", "doc", "pptx", "ppt", "key", "pages", "numbers", "odt", "ods", "odp", "rtf",
    "epub", "html", "htm",
];

fn externally_openable(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTERNAL_OPEN_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Open a linked document (PDF, image, spreadsheet…) in its default app.
#[tauri::command]
fn open_with_default_app(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let p = Path::new(&path);
    if !p.is_file() {
        return Err("File not found".into());
    }
    if !externally_openable(p) {
        return Err("This kind of file isn't opened from links".into());
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

// ---------- Change review: the version the reader last saw ----------

const SEEN_MAX_BYTES: usize = 4 * 1024 * 1024;
const SEEN_KEEP: usize = 2000;

fn seen_file_for<R: Runtime>(app: &AppHandle<R>, path: &str) -> Option<PathBuf> {
    let key = path_key(Path::new(path));
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("seen").join(format!("{:016x}.md", fnv1a(&key))))
}

/// The contents of `path` as the reader last acknowledged them, if recorded.
#[tauri::command]
fn seen_get(app: AppHandle, path: String) -> Option<String> {
    fs::read_to_string(seen_file_for(&app, &path)?).ok()
}

/// Record `contents` as the version of `path` the reader has seen. Very large
/// files are skipped, and the store keeps only the most recently seen files.
#[tauri::command]
fn seen_set(app: AppHandle, path: String, contents: String) -> Result<(), String> {
    let Some(file) = seen_file_for(&app, &path) else {
        return Ok(());
    };
    if contents.len() > SEEN_MAX_BYTES {
        let _ = fs::remove_file(&file);
        return Ok(());
    }
    let dir = file.parent().map(Path::to_path_buf).unwrap_or_default();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(&file, contents).map_err(|e| e.to_string())?;
    prune_seen(&dir);
    Ok(())
}

fn prune_seen(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    if files.len() <= SEEN_KEEP {
        return;
    }
    files.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, p) in files.iter().skip(SEEN_KEEP) {
        let _ = fs::remove_file(p);
    }
}

// ---------- Folder-wide replace ----------

#[derive(Serialize)]
struct ReplaceSummary {
    files: u32,
    occurrences: u32,
    failed: u32,
}

/// Literal, case-sensitive search & replace across every Markdown file in a
/// folder. Each modified file gets a forced history snapshot first, so the
/// operation is recoverable. A file that can't be written is counted and
/// skipped rather than aborting a half-applied replace.
#[tauri::command]
fn replace_in_dir(
    app: AppHandle,
    path: String,
    query: String,
    replacement: String,
) -> Result<ReplaceSummary, String> {
    let base = PathBuf::from(&path);
    if !base.is_dir() {
        return Err("not a directory".into());
    }
    if query.is_empty() {
        return Err("nothing to search for".into());
    }
    let mut files_list = Vec::new();
    collect_markdown(&base, &base, &mut files_list);

    let mut files = 0u32;
    let mut occurrences = 0u32;
    let mut failed = 0u32;
    for f in &files_list {
        let Ok(content) = fs::read_to_string(&f.path) else {
            continue;
        };
        let count = content.matches(&query).count() as u32;
        if count == 0 {
            continue;
        }
        let _ = take_snapshot(&app, &f.path, true);
        let updated = content.replace(&query, &replacement);
        if fs::write(&f.path, updated).is_err() {
            failed += 1;
            continue;
        }
        files += 1;
        occurrences += count;
    }
    Ok(ReplaceSummary {
        files,
        occurrences,
        failed,
    })
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
/// file's extension. `doc_path` is the source document, when it has one:
/// Pandoc runs from its folder with that folder on `--resource-path`, so
/// relative image references resolve the way they do in the preview.
#[tauri::command]
fn export_pandoc(
    src: String,
    out_path: String,
    doc_path: Option<String>,
    files: Option<Vec<PandocFile>>,
) -> Result<(), String> {
    let pandoc = find_pandoc().ok_or("Pandoc was not found on this system.")?;
    // A private temp folder (0700, unique name) for the input and any
    // generated diagrams, rather than predictable paths in the shared temp
    // dir; it's removed on drop.
    let work = tempfile::Builder::new()
        .prefix("markappoly-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let input = work.path().join("document.md");
    fs::write(&input, src.as_bytes()).map_err(|e| e.to_string())?;
    for f in files.unwrap_or_default() {
        // Names come from the frontend: keep them to a bare file name.
        let name = Path::new(&f.name)
            .file_name()
            .ok_or("Invalid file name")?
            .to_owned();
        let bytes = STANDARD.decode(f.base64).map_err(|e| e.to_string())?;
        fs::write(work.path().join(name), bytes).map_err(|e| e.to_string())?;
    }

    let doc_dir = doc_path
        .as_deref()
        .and_then(|p| Path::new(p).parent())
        .filter(|d| d.is_dir());

    // Generated files first, then the document's folder for its own images.
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut resource_path = work.path().display().to_string();
    if let Some(dir) = doc_dir {
        resource_path = format!("{}{}{}", resource_path, sep, dir.display());
    }

    let mut cmd = std::process::Command::new(&pandoc);
    // commonmark_x: CommonMark (what the app writes) plus Pandoc's extensions
    // for math, task lists, footnotes, `[…]{.mark}` spans and YAML metadata.
    cmd.arg(&input)
        .arg("-f")
        .arg("commonmark_x")
        .arg("-o")
        .arg(&out_path)
        .arg(format!("--resource-path={}", resource_path));
    if let Some(dir) = doc_dir {
        cmd.current_dir(dir);
    }

    match cmd.output() {
        Ok(out) if out.status.success() => Ok(()),
        Ok(out) => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(serde::Deserialize)]
struct PandocFile {
    name: String,
    base64: String,
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
        .item(&MenuItemBuilder::with_id("install_cli", "Install Command Line Tool…").build(app)?)
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
            &MenuItemBuilder::with_id("new_note", "New Note…")
                .accelerator("CmdOrCtrl+N")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("daily_note", "Open Today's Note")
                .accelerator("CmdOrCtrl+Shift+D")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("reload", "Reload from Disk").build(app)?)
        .item(&MenuItemBuilder::with_id("history", "File History…").build(app)?)
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
    // `markappoly …` runs this binary as a short-lived launcher first.
    if let Some(code) = cli::run_launcher_if_requested() {
        std::process::exit(code);
    }

    let mut builder = tauri::Builder::default();

    // Must be registered before any other plugin. A second launch (the
    // `markappoly` command, or "open with" on Windows/Linux) hands its
    // arguments to this instance and exits.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let targets = cli::launch_targets(args.get(1..).unwrap_or_default(), Path::new(&cwd));
            request_open(app, targets);
            focus_main_window(app);
        }));
    }

    builder = builder
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
        .manage(FolderWatchState::default())
        .on_menu_event(|app, event| {
            if event.id().0 == "install_cli" {
                install_cli(app.clone());
                return;
            }
            let _ = app.emit("menu", event.id().0.clone());
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let recents = load_recents(&handle);
            let menu = build_app_menu(&handle, &recents)?;
            handle.set_menu(menu)?;

            // Paths passed on the command line at a cold start.
            let cwd = std::env::current_dir().unwrap_or_default();
            let args: Vec<String> = std::env::args().skip(1).collect();
            let targets = cli::launch_targets(&args, &cwd);
            if !targets.is_empty() {
                request_open(&handle, targets);
                // Launched from a terminal, the app would otherwise start
                // behind it.
                focus_main_window(&handle);
            }

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
            read_file_base64,
            file_mtime,
            list_markdown_dir,
            index_dir,
            take_pending_open,
            search_dir,
            replace_in_dir,
            snapshot_file,
            list_snapshots,
            save_image,
            attach_image_file,
            pandoc_available,
            export_pandoc,
            recent_files,
            push_recent,
            clear_recents,
            set_watched_files,
            path_exists,
            path_is_dir,
            seen_get,
            seen_set,
            open_with_default_app,
            set_watched_folder
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // macOS delivers "open with" / Finder double-clicks as Opened events.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            request_open(app_handle, paths);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, &event);
        }
    });
}

#[cfg(test)]
mod external_open_tests {
    use super::externally_openable;
    use std::path::Path;

    #[test]
    fn allows_documents_and_media() {
        for p in ["a.pdf", "b.PNG", "c/d.xlsx", "e.html"] {
            assert!(externally_openable(Path::new(p)), "{p}");
        }
    }

    #[test]
    fn refuses_executables_and_scripts() {
        for p in ["a.app", "b.exe", "c.sh", "d.command", "e.js", "f.bat", "g", "h.pkg", "i.dmg"] {
            assert!(!externally_openable(Path::new(p)), "{p}");
        }
    }

    #[test]
    fn data_files_open_in_the_app() {
        for p in ["a.csv", "b.TSV", "c.json", "d.jsonl"] {
            assert!(!externally_openable(Path::new(p)), "{p}");
        }
    }
}

#[cfg(test)]
mod folder_watch_tests {
    use super::folder_change_matters;
    use std::path::Path;

    #[test]
    fn notes_matter_but_hidden_and_build_dirs_do_not() {
        let root = Path::new("/vault");
        assert!(folder_change_matters(root, Path::new("/vault/a/note.md")));
        assert!(!folder_change_matters(root, Path::new("/vault/.git/index")));
        assert!(!folder_change_matters(root, Path::new("/vault/node_modules/x/README.md")));
        assert!(!folder_change_matters(root, Path::new("/vault/img.png")));
    }
}
