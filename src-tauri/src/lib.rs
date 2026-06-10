use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime};

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
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let tmp = std::env::temp_dir().join(format!("markappoly-{}.md", ts));
    fs::write(&tmp, src).map_err(|e| e.to_string())?;

    let result = std::process::Command::new(&pandoc)
        .arg(&tmp)
        .arg("-f")
        .arg("gfm")
        .arg("-o")
        .arg(&out_path)
        .output();
    let _ = fs::remove_file(&tmp);

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
            cli_file_arg,
            search_dir,
            save_image,
            attach_image_file,
            pandoc_available,
            export_pandoc,
            recent_files,
            push_recent,
            clear_recents
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // macOS delivers "open with" / Finder double-clicks as Opened events.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    let _ = app_handle.emit("open-file", path.to_string_lossy().to_string());
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, &event);
        }
    });
}
