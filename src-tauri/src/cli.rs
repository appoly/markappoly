//! The `markappoly` shell command.
//!
//! The installed command is a tiny script that runs the app binary with
//! `--cli` first. In that mode the binary acts as a short-lived launcher: it
//! resolves the arguments against the caller's working directory, turns piped
//! input into a temporary Markdown file, starts (or, through the single-instance
//! plugin, forwards to) the real app in a detached process, and then exits.
//! Keeping the app itself out of the terminal means the shell prompt comes back
//! straight away and closing the terminal doesn't close the app.

use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// First argument that switches the binary into launcher mode.
pub const CLI_FLAG: &str = "--cli";

/// The shell script installed as `markappoly` on macOS and Linux. Inside the
/// macOS bundle it finds the app relative to itself; installed copies on Linux
/// have the binary path filled in (see `bake_unix_script`).
#[cfg(any(unix, test))]
pub const UNIX_SCRIPT: &str = include_str!("../cli/markappoly");

const USAGE: &str = "Usage: markappoly [options] [paths...]

Open Markdown files and folders in Markappoly.

  markappoly notes.md               open a file
  markappoly a.md b.md              open several files as tabs
  markappoly docs/                  open a folder in the sidebar
  markappoly guide.md#install       open a file at a heading
  some-command | markappoly         show piped output, updating as it streams
  markappoly - < draft.md           read from stdin explicitly

Options:
  -h, --help       show this help
  -v, --version    print the version
";

#[derive(Debug, Default, PartialEq)]
pub struct Resolved {
    /// Absolute paths to open, with any `#fragment` kept on the end.
    pub targets: Vec<String>,
    /// Arguments that didn't name an existing file or folder.
    pub missing: Vec<String>,
    /// `-` was passed: read the document from stdin.
    pub stdin: bool,
    pub help: bool,
    pub version: bool,
}

impl Resolved {
    fn has_positional(&self) -> bool {
        !self.targets.is_empty() || !self.missing.is_empty()
    }
}

/// Resolve launch arguments (without argv[0]) against `cwd`.
///
/// Unknown flags are ignored so that OS-supplied arguments such as macOS's
/// `-psn_…` don't get treated as paths.
pub fn resolve_args(args: &[String], cwd: &Path) -> Resolved {
    let mut out = Resolved::default();
    for arg in args {
        match arg.as_str() {
            "-" => out.stdin = true,
            "-h" | "--help" => out.help = true,
            "-v" | "--version" => out.version = true,
            a if a.starts_with('-') => {}
            a => match resolve_path(a, cwd) {
                Some(t) => out.targets.push(t),
                None => out.missing.push(a.to_string()),
            },
        }
    }
    out
}

/// Turn one path argument into an absolute path, keeping a trailing
/// `#fragment` (a heading anchor) when the part before it is a file. A path
/// that exists as written wins, so file names containing `#` still open.
pub fn resolve_path(arg: &str, cwd: &Path) -> Option<String> {
    let full = normalize(&cwd.join(arg));
    if full.exists() {
        return Some(full.to_string_lossy().into_owned());
    }
    let (base, fragment) = arg.rsplit_once('#')?;
    if base.is_empty() || fragment.is_empty() {
        return None;
    }
    let file = normalize(&cwd.join(base));
    file.is_file()
        .then(|| format!("{}#{}", file.to_string_lossy(), fragment))
}

/// Lexically tidy a path (drop `.`, fold `..`) without touching the disk, so
/// `./a.md` and `a.md` open the same tab and Windows paths don't gain the
/// `\\?\` prefix that `canonicalize` adds.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Paths to open for a launch of the app itself (cold start, or a second
/// instance forwarded by the single-instance plugin).
pub fn launch_targets(args_without_exe: &[String], cwd: &Path) -> Vec<String> {
    resolve_args(args_without_exe, cwd).targets
}

/// If the process was started as `<app> --cli …`, run the launcher and return
/// its exit code. Otherwise return `None` and let the app start normally.
pub fn run_launcher_if_requested() -> Option<i32> {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some(CLI_FLAG) {
        return None;
    }
    let rest: Vec<String> = args.collect();
    #[cfg(windows)]
    attach_parent_console();
    Some(run_launcher(&rest))
}

fn run_launcher(args: &[String]) -> i32 {
    let cwd = std::env::current_dir().unwrap_or_default();
    let mut resolved = resolve_args(args, &cwd);
    if resolved.help {
        print!("{USAGE}");
        return 0;
    }
    if resolved.version {
        println!("markappoly {}", env!("CARGO_PKG_VERSION"));
        return 0;
    }
    for m in &resolved.missing {
        eprintln!("markappoly: {m}: no such file or folder");
    }
    let read_stdin = resolved.stdin || (!resolved.has_positional() && stdin_is_piped());
    if !resolved.missing.is_empty() && resolved.targets.is_empty() && !read_stdin {
        return 1;
    }

    let stdin_file = if read_stdin {
        match new_stdin_file() {
            Ok(path) => {
                resolved
                    .targets
                    .insert(0, path.to_string_lossy().into_owned());
                Some(path)
            }
            Err(e) => {
                eprintln!("markappoly: couldn't create a file for stdin: {e}");
                return 1;
            }
        }
    } else {
        None
    };

    if let Err(e) = spawn_app(&resolved.targets) {
        eprintln!("markappoly: couldn't start Markappoly: {e}");
        return 1;
    }

    if let Some(path) = stdin_file {
        if let Err(e) = stream_stdin_to(&path) {
            eprintln!("markappoly: stopped reading stdin: {e}");
            return 1;
        }
    }
    0
}

/// Start the app with `targets` in its own process group, detached from the
/// terminal. If the app is already running, the single-instance plugin hands
/// the targets to it and the new process exits.
fn spawn_app(targets: &[String]) -> io::Result<()> {
    // An AppImage runs from a temporary mount that disappears when this
    // launcher exits, so start the AppImage file itself rather than the
    // binary inside the mount.
    let exe = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .map_or_else(std::env::current_exe, Ok)?;
    let mut cmd = Command::new(exe);
    cmd.args(targets)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map(|_| ())
}

/// Piped text lands in `<temp>/markappoly-stdin/stdin-<millis>.md`. Files from
/// earlier runs are cleared out after a week.
fn new_stdin_file() -> io::Result<PathBuf> {
    let dir = std::env::temp_dir().join("markappoly-stdin");
    fs::create_dir_all(&dir)?;
    prune_old_stdin_files(&dir, Duration::from_secs(7 * 24 * 60 * 60));
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("stdin-{millis}.md"));
    fs::File::create(&path)?;
    Ok(path)
}

fn prune_old_stdin_files(dir: &Path, max_age: Duration) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > max_age);
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Append stdin to `path` as it arrives, flushing each chunk so the app's file
/// watcher shows streaming output (an agent's reply, a long build log) live.
fn stream_stdin_to(path: &Path) -> io::Result<()> {
    let mut file = OpenOptions::new().append(true).open(path)?;
    let mut stdin = io::stdin().lock();
    let mut buf = [0u8; 16 * 1024];
    loop {
        let n = match stdin.read(&mut buf) {
            Ok(0) => return Ok(()),
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        file.write_all(&buf[..n])?;
        file.flush()?;
    }
}

/// Whether stdin is a pipe, socket or redirected file, as opposed to a
/// terminal or nothing at all (a Finder or Explorer launch).
#[cfg(unix)]
fn stdin_is_piped() -> bool {
    use std::os::unix::fs::FileTypeExt;
    fs::metadata("/dev/stdin")
        .map(|m| {
            let t = m.file_type();
            t.is_fifo() || t.is_socket() || t.is_file()
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn stdin_is_piped() -> bool {
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::Storage::FileSystem::{GetFileType, FILE_TYPE_DISK, FILE_TYPE_PIPE};
    use windows_sys::Win32::System::Console::{GetStdHandle, STD_INPUT_HANDLE};
    // SAFETY: plain Win32 queries on this process's own standard handle.
    unsafe {
        let handle = GetStdHandle(STD_INPUT_HANDLE);
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return false;
        }
        matches!(GetFileType(handle), FILE_TYPE_PIPE | FILE_TYPE_DISK)
    }
}

#[cfg(not(any(unix, windows)))]
fn stdin_is_piped() -> bool {
    false
}

/// Release builds use the Windows GUI subsystem, which has no console of its
/// own; borrow the caller's so `--help` and errors show up in the terminal.
#[cfg(windows)]
fn attach_parent_console() {
    use windows_sys::Win32::System::Console::{AttachConsole, ATTACH_PARENT_PROCESS};
    // SAFETY: fails harmlessly when there is no parent console.
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

// ---------- Installing the command ----------

/// Fill in the app binary for an installed copy of the script.
#[cfg(any(unix, test))]
pub fn bake_unix_script(bin: &Path) -> String {
    let quoted = bin.to_string_lossy().replace('\'', r"'\''");
    UNIX_SCRIPT.replacen(
        "MARKAPPOLY_BIN=\"\"",
        &format!("MARKAPPOLY_BIN='{quoted}'"),
        1,
    )
}

/// The `markappoly.cmd` installed on Windows.
#[cfg(any(windows, test))]
pub fn windows_script(exe: &Path) -> String {
    format!(
        "@echo off\r\nrem markappoly: open files, folders, or piped text in Markappoly.\r\n\"{}\" {} %*\r\n",
        exe.display(),
        CLI_FLAG
    )
}

/// Install the `markappoly` command and describe where it went (or why it
/// couldn't be installed) in a sentence for the user.
pub fn install() -> Result<String, String> {
    platform::install()
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;

    const SYSTEM_BIN: &str = "/usr/local/bin";

    fn shell_quote(s: &str) -> String {
        format!("'{}'", s.replace('\'', r"'\''"))
    }

    pub fn install() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        // …/Markappoly.app/Contents/MacOS/<exe> → …/Contents/Resources/cli/markappoly
        let bundled = exe
            .parent()
            .and_then(Path::parent)
            .map(|contents| contents.join("Resources/cli/markappoly"))
            .filter(|p| p.is_file());

        // Like VS Code: link to the script inside the bundle so app updates
        // carry the command along. Dev builds have no bundle, so they get a
        // copy pointing at the dev binary instead.
        let staged;
        let source = match &bundled {
            Some(p) => p.clone(),
            None => {
                staged = std::env::temp_dir().join("markappoly-cli-install");
                fs::write(&staged, bake_unix_script(&exe)).map_err(|e| e.to_string())?;
                set_executable(&staged)?;
                staged.clone()
            }
        };
        let install_cmd = |dir: &str| {
            let target = format!("{dir}/markappoly");
            if bundled.is_some() {
                format!(
                    "mkdir -p {d} && ln -sf {s} {t}",
                    d = shell_quote(dir),
                    s = shell_quote(&source.to_string_lossy()),
                    t = shell_quote(&target)
                )
            } else {
                format!(
                    "mkdir -p {d} && rm -f {t} && cp {s} {t} && chmod 755 {t}",
                    d = shell_quote(dir),
                    s = shell_quote(&source.to_string_lossy()),
                    t = shell_quote(&target)
                )
            }
        };

        // /usr/local/bin is often user-writable already (Homebrew on Intel).
        let direct = Command::new("/bin/sh")
            .arg("-c")
            .arg(install_cmd(SYSTEM_BIN))
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        if direct {
            return Ok(format!(
                "Installed. Run `markappoly` from a new terminal window ({SYSTEM_BIN}/markappoly)."
            ));
        }

        let script = install_cmd(SYSTEM_BIN)
            .replace('\\', "\\\\")
            .replace('"', "\\\"");
        let admin = Command::new("/usr/bin/osascript")
            .arg("-e")
            .arg(format!(
                "do shell script \"{script}\" with prompt \"Markappoly wants to install the markappoly command in {SYSTEM_BIN}.\" with administrator privileges"
            ))
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success());
        if admin {
            return Ok(format!(
                "Installed. Run `markappoly` from a new terminal window ({SYSTEM_BIN}/markappoly)."
            ));
        }

        // Declined (or failed): fall back to the user's own bin folder.
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let local = format!("{home}/.local/bin");
        let ok = Command::new("/bin/sh")
            .arg("-c")
            .arg(install_cmd(&local))
            .status()
            .is_ok_and(|s| s.success());
        if !ok {
            return Err("Couldn't install the markappoly command.".into());
        }
        Ok(format!(
            "Installed in {local}/markappoly instead, without administrator rights.{}",
            path_hint(&local)
        ))
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::*;

    pub fn install() -> Result<String, String> {
        // An AppImage's binary lives in a mount that changes every launch;
        // point the command at the AppImage file instead.
        let bin = std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .map_or_else(std::env::current_exe, Ok)
            .map_err(|e| e.to_string())?;
        let home = std::env::var("HOME").map_err(|e| e.to_string())?;
        let dir = PathBuf::from(&home).join(".local/bin");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let target = dir.join("markappoly");
        let _ = fs::remove_file(&target);
        fs::write(&target, bake_unix_script(&bin)).map_err(|e| e.to_string())?;
        set_executable(&target)?;
        Ok(format!(
            "Installed {}.{}",
            target.display(),
            path_hint(&dir.to_string_lossy())
        ))
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::os::windows::process::CommandExt;

    pub fn install() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or("LOCALAPPDATA is not set")?;
        let dir = base.join("Markappoly").join("bin");
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        fs::write(dir.join("markappoly.cmd"), windows_script(&exe)).map_err(|e| e.to_string())?;

        // Add the folder to the user's PATH. .NET's SetEnvironmentVariable
        // also broadcasts the change, so new terminals pick it up.
        let d = dir.to_string_lossy().replace('\'', "''");
        let ps = format!(
            "$p = [Environment]::GetEnvironmentVariable('Path', 'User'); if (-not $p) {{ $p = '' }}; \
             if (-not (($p -split ';') -contains '{d}')) {{ \
             [Environment]::SetEnvironmentVariable('Path', (($p.TrimEnd(';') + ';{d}').TrimStart(';')), 'User') }}"
        );
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let ok = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .is_ok_and(|s| s.success());
        if !ok {
            return Ok(format!(
                "Installed {}, but couldn't add {} to your PATH. Add it in Settings ▸ System ▸ About ▸ Advanced system settings ▸ Environment Variables.",
                dir.join("markappoly.cmd").display(),
                dir.display()
            ));
        }
        Ok(format!(
            "Installed. Open a new terminal and run `markappoly` ({}).",
            dir.join("markappoly.cmd").display()
        ))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
mod platform {
    pub fn install() -> Result<String, String> {
        Err("The markappoly command isn't available on this platform.".into())
    }
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())
}

#[cfg(unix)]
fn path_hint(dir: &str) -> String {
    let on_path = std::env::var("PATH")
        .map(|p| p.split(':').any(|d| d.trim_end_matches('/') == dir))
        .unwrap_or(false);
    if on_path {
        String::new()
    } else {
        format!(" Add {dir} to your PATH to use it from any terminal.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|a| a.to_string()).collect()
    }

    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.md"), "# A").unwrap();
        fs::write(dir.path().join("b.md"), "# B").unwrap();
        fs::write(dir.path().join("odd#name.md"), "x").unwrap();
        fs::create_dir(dir.path().join("docs")).unwrap();
        fs::write(dir.path().join("docs/guide.md"), "x").unwrap();
        dir
    }

    fn abs(dir: &Path, rel: &str) -> String {
        dir.join(rel).to_string_lossy().into_owned()
    }

    #[test]
    fn resolves_relative_files_and_folders_against_cwd() {
        let dir = fixture();
        let r = resolve_args(&s(&["a.md", "./b.md", "docs"]), dir.path());
        assert_eq!(
            r.targets,
            vec![abs(dir.path(), "a.md"), abs(dir.path(), "b.md"), abs(dir.path(), "docs")]
        );
        assert!(r.missing.is_empty() && !r.stdin);
    }

    #[test]
    fn folds_parent_components() {
        let dir = fixture();
        let cwd = dir.path().join("docs");
        let r = resolve_args(&s(&["../a.md", "./guide.md"]), &cwd);
        assert_eq!(r.targets, vec![abs(dir.path(), "a.md"), abs(dir.path(), "docs/guide.md")]);
    }

    #[test]
    fn keeps_heading_fragments() {
        let dir = fixture();
        let r = resolve_args(&s(&["docs/guide.md#install-steps"]), dir.path());
        assert_eq!(r.targets, vec![format!("{}#install-steps", abs(dir.path(), "docs/guide.md"))]);
    }

    #[test]
    fn a_real_file_name_with_hash_wins_over_a_fragment() {
        let dir = fixture();
        let r = resolve_args(&s(&["odd#name.md"]), dir.path());
        assert_eq!(r.targets, vec![abs(dir.path(), "odd#name.md")]);
    }

    #[test]
    fn fragment_on_a_missing_file_is_missing() {
        let dir = fixture();
        let r = resolve_args(&s(&["nope.md#x", "a.md#", "#x"]), dir.path());
        assert!(r.targets.is_empty());
        assert_eq!(r.missing, s(&["nope.md#x", "a.md#", "#x"]));
    }

    #[test]
    fn absolute_paths_ignore_cwd() {
        let dir = fixture();
        let a = abs(dir.path(), "a.md");
        let r = resolve_args(&[a.clone()], Path::new("/somewhere/else"));
        assert_eq!(r.targets, vec![a]);
    }

    #[test]
    fn flags_and_os_noise() {
        let dir = fixture();
        let r = resolve_args(&s(&["-psn_0_12345", "-", "--help", "-v", "a.md"]), dir.path());
        assert!(r.stdin && r.help && r.version);
        assert_eq!(r.targets, vec![abs(dir.path(), "a.md")]);
    }

    #[test]
    fn baked_script_points_at_the_binary() {
        let script = bake_unix_script(Path::new("/opt/it's here/markappoly"));
        assert!(script.contains(r"MARKAPPOLY_BIN='/opt/it'\''s here/markappoly'"));
        assert!(!script.contains("MARKAPPOLY_BIN=\"\""));
        assert!(script.contains("--cli"));
    }

    #[test]
    fn windows_script_passes_cli_flag() {
        let cmd = windows_script(Path::new(r"C:\Apps\Markappoly.exe"));
        assert!(cmd.contains(r#""C:\Apps\Markappoly.exe" --cli %*"#));
    }

    #[test]
    fn prunes_only_old_stdin_files() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("stdin-1.md");
        fs::write(&f, "x").unwrap();
        prune_old_stdin_files(dir.path(), Duration::from_secs(3600));
        assert!(f.exists());
        std::thread::sleep(Duration::from_millis(5));
        prune_old_stdin_files(dir.path(), Duration::ZERO);
        assert!(!f.exists());
    }
}
