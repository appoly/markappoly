use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

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
    let base = std::path::PathBuf::from(&path);
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

fn setup_menu(app: &tauri::App) -> tauri::Result<()> {
    let h = app.handle().clone();

    let app_menu = SubmenuBuilder::new(&h, "Markappoly")
        .about(Some(AboutMetadata::default()))
        .separator()
        .hide()
        .quit()
        .build()?;

    let export_menu = SubmenuBuilder::new(&h, "Export")
        .item(&MenuItemBuilder::with_id("export:txt", "Text (.txt)").build(&h)?)
        .item(&MenuItemBuilder::with_id("export:html", "HTML (.html)").build(&h)?)
        .item(&MenuItemBuilder::with_id("export:json", "JSON (.json)").build(&h)?)
        .item(&MenuItemBuilder::with_id("export:docx", "Word (.docx)").build(&h)?)
        .item(&MenuItemBuilder::with_id("export:pdf", "PDF…").build(&h)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(&h, "File")
        .item(
            &MenuItemBuilder::with_id("open", "Open…")
                .accelerator("CmdOrCtrl+O")
                .build(&h)?,
        )
        .item(
            &MenuItemBuilder::with_id("open_folder", "Open Folder…")
                .accelerator("CmdOrCtrl+Shift+O")
                .build(&h)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("save", "Save")
                .accelerator("CmdOrCtrl+S")
                .build(&h)?,
        )
        .item(&MenuItemBuilder::with_id("reload", "Reload from Disk").build(&h)?)
        .separator()
        .item(&export_menu)
        .build()?;

    let edit_menu = SubmenuBuilder::new(&h, "Edit")
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
                .build(&h)?,
        )
        .build()?;

    let view_menu = SubmenuBuilder::new(&h, "View")
        .item(
            &MenuItemBuilder::with_id("toggle_mode", "Toggle Edit / Preview")
                .accelerator("CmdOrCtrl+E")
                .build(&h)?,
        )
        .item(&MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar").build(&h)?)
        .separator()
        .item(&MenuItemBuilder::with_id("zoom_in", "Zoom In").build(&h)?)
        .item(&MenuItemBuilder::with_id("zoom_out", "Zoom Out").build(&h)?)
        .item(&MenuItemBuilder::with_id("zoom_reset", "Actual Size").build(&h)?)
        .build()?;

    let menu = MenuBuilder::new(&h)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu])
        .build()?;

    h.set_menu(menu)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    let app = builder
        .on_menu_event(|app, event| {
            let _ = app.emit("menu", event.id().0.clone());
        })
        .setup(|app| {
            setup_menu(app)?;

            // Native window chrome per platform.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{
                    apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
                };
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
            cli_file_arg
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
