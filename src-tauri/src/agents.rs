//! "Set up agents": add (or remove) a hook in each coding agent's user-level
//! config that runs `markappoly hook` after the agent edits a file, so the
//! Markdown it writes opens here (see `cli::run_hook`).
//!
//! Config files are merged, never replaced: only our own entry, recognised by
//! its command containing `--cli hook`, is added or removed. A file that
//! doesn't parse is left alone and reported, and the original is copied to
//! `<file>.markappoly.bak` before the first change.

use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::cli::{CLI_FLAG, HOOK_COMMAND};

/// How an agent lays out its hooks.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Format {
    /// Claude Code and Codex: `hooks.<Event>` is a list of matcher groups,
    /// each `{ "matcher": …, "hooks": [{ "type": "command", "command": … }] }`.
    Grouped { event: &'static str, matcher: &'static str },
    /// Cursor: `{ "version": 1, "hooks": { "<event>": [{ "command": … }] } }`.
    Flat { event: &'static str },
}

struct Agent {
    id: &'static str,
    name: &'static str,
    /// The agent's config folder; it existing means the agent is installed.
    dir: PathBuf,
    /// The file our hook goes in, inside `dir`.
    file: &'static str,
    format: Format,
}

fn home() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).filter(|h| !h.is_empty()).map(PathBuf::from)
}

/// Each agent's config folder honours its own override variable, as the agent
/// itself does.
fn config_dir(env: &str, default: &str) -> Option<PathBuf> {
    std::env::var_os(env)
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .or_else(|| home().map(|h| h.join(default)))
}

fn agents() -> Vec<Agent> {
    let mut out = Vec::new();
    // https://code.claude.com/docs/en/hooks
    if let Some(dir) = config_dir("CLAUDE_CONFIG_DIR", ".claude") {
        out.push(Agent {
            id: "claude",
            name: "Claude Code",
            dir,
            file: "settings.json",
            format: Format::Grouped { event: "PostToolUse", matcher: "Write|Edit|MultiEdit" },
        });
    }
    // https://developers.openai.com/codex/hooks: file edits go through
    // `apply_patch`. Hooks are on by default but must be trusted once (/hooks).
    if let Some(dir) = config_dir("CODEX_HOME", ".codex") {
        out.push(Agent {
            id: "codex",
            name: "Codex",
            dir,
            file: "hooks.json",
            format: Format::Grouped { event: "PostToolUse", matcher: "apply_patch" },
        });
    }
    // https://cursor.com/docs/hooks
    if let Some(home) = home() {
        out.push(Agent {
            id: "cursor",
            name: "Cursor",
            dir: home.join(".cursor"),
            file: "hooks.json",
            format: Format::Flat { event: "afterFileEdit" },
        });
    }
    out
}

#[derive(Serialize)]
pub struct AgentStatus {
    id: &'static str,
    name: &'static str,
    /// The agent's config folder exists.
    installed: bool,
    /// Our hook is in its config.
    enabled: bool,
    /// Why the config couldn't be read, if it couldn't.
    error: Option<String>,
}

pub fn status() -> Vec<AgentStatus> {
    agents()
        .into_iter()
        .map(|a| {
            let path = a.dir.join(a.file);
            let (enabled, error) = match read_config(&path) {
                Ok(config) => (has_hook(&config, a.format), None),
                Err(e) => (false, Some(e)),
            };
            AgentStatus {
                id: a.id,
                name: a.name,
                installed: a.dir.is_dir(),
                enabled,
                error,
            }
        })
        .collect()
}

pub fn set(id: &str, enabled: bool) -> Result<(), String> {
    let agent = agents()
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| format!("Unknown agent: {id}"))?;
    if !agent.dir.is_dir() {
        return Err(format!("{} isn't installed.", agent.name));
    }
    let command = if enabled { Some(hook_command()?) } else { None };
    update_config(&agent.dir.join(agent.file), agent.format, command.as_deref())
}

/// The command agents run: the app binary, quoted for the shell the agent
/// runs hooks with, then `--cli hook`.
fn hook_command() -> Result<String, String> {
    let bin = crate::cli::app_binary().map_err(|e| e.to_string())?;
    let bin = bin.to_string_lossy();
    // macOS runs an app opened straight from a download at a random,
    // temporary path, which would be gone by the next agent run.
    if bin.contains("/AppTranslocation/") {
        return Err("Move Markappoly to your Applications folder first, then try again.".into());
    }
    Ok(format!("{} {CLI_FLAG} {HOOK_COMMAND}", quote(&bin)))
}

/// Quote a path for the shell. Agents run hooks with `sh` on macOS and Linux;
/// on Windows forward slashes in double quotes work in both cmd and Git Bash.
fn quote(path: &str) -> String {
    if cfg!(windows) {
        format!("\"{}\"", path.replace('\\', "/"))
    } else {
        format!("'{}'", path.replace('\'', r"'\''"))
    }
}

fn is_ours(handler: &Value) -> bool {
    handler
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|c| c.contains(&format!("{CLI_FLAG} {HOOK_COMMAND}")))
}

/// Read a JSON config. A missing or empty file is an empty object; anything
/// else that isn't a JSON object is an error, so it never gets overwritten.
fn read_config(path: &Path) -> Result<Value, String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(json!({})),
        Err(e) => return Err(format!("Couldn't read {}: {e}", path.display())),
    };
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    match serde_json::from_str::<Value>(&text) {
        Ok(v) if v.is_object() => Ok(v),
        Ok(_) => Err(format!("{} isn't a JSON object, so it was left alone.", path.display())),
        Err(e) => Err(format!(
            "{} isn't valid JSON ({e}), so it was left alone. Fix it, then try again.",
            path.display()
        )),
    }
}

/// The event's list of hooks, if the config has one.
fn event_list<'a>(config: &'a Value, event: &str) -> Option<&'a Vec<Value>> {
    config.get("hooks")?.get(event)?.as_array()
}

fn has_hook(config: &Value, format: Format) -> bool {
    match format {
        Format::Grouped { event, .. } => event_list(config, event).is_some_and(|groups| {
            groups.iter().any(|g| {
                g.get("hooks")
                    .and_then(Value::as_array)
                    .is_some_and(|hs| hs.iter().any(is_ours))
            })
        }),
        Format::Flat { event } => {
            event_list(config, event).is_some_and(|hs| hs.iter().any(is_ours))
        }
    }
}

/// Remove our hook from `config`, then add it back with `command` if given, so
/// enabling twice leaves one entry and picks up a moved app. Returns whether
/// anything changed. Errors if the parts we'd touch have an unexpected shape.
fn apply(config: &mut Value, format: Format, command: Option<&str>) -> Result<bool, String> {
    let root = config.as_object_mut().ok_or("The config isn't a JSON object.")?;
    let event = match format {
        Format::Grouped { event, .. } | Format::Flat { event } => event,
    };
    let unexpected = || format!("Its \"hooks.{event}\" setting isn't in the expected format.");

    let before = root.get("hooks").and_then(|h| h.get(event)).cloned();
    let hooks = root
        .entry("hooks")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(unexpected)?;
    let list = hooks
        .entry(event)
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(unexpected)?;

    match format {
        Format::Grouped { matcher, .. } => {
            for group in list.iter_mut() {
                if let Some(hs) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                    let had = hs.len();
                    hs.retain(|h| !is_ours(h));
                    // Drop a group only if it held nothing but our hook.
                    if had > 0 && hs.is_empty() {
                        *group = Value::Null;
                    }
                }
            }
            list.retain(|g| !g.is_null());
            if let Some(command) = command {
                list.push(json!({
                    "matcher": matcher,
                    "hooks": [{ "type": "command", "command": command }],
                }));
            }
        }
        Format::Flat { .. } => {
            list.retain(|h| !is_ours(h));
            if let Some(command) = command {
                list.push(json!({ "command": command }));
            }
        }
    }

    // Don't leave empty containers behind when turning the hook off.
    if list.is_empty() {
        hooks.remove(event);
    }
    if hooks.is_empty() {
        root.remove("hooks");
    }
    if let (Format::Flat { .. }, Some(_)) = (format, command) {
        root.entry("version").or_insert(json!(1));
    }
    let after = root.get("hooks").and_then(|h| h.get(event)).cloned();
    Ok(before != after)
}

fn update_config(path: &Path, format: Format, command: Option<&str>) -> Result<(), String> {
    // Write through a symlink (dotfiles kept in a repo) instead of replacing it.
    let path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut config = read_config(&path)?;
    let changed = apply(&mut config, format, command)
        .map_err(|e| format!("{} was left alone. {e}", path.display()))?;
    if !changed {
        return Ok(());
    }
    let dir = path.parent().ok_or("The config file has no folder.")?;
    if path.exists() {
        let mut backup = path.clone().into_os_string();
        backup.push(".markappoly.bak");
        let backup = PathBuf::from(backup);
        if !backup.exists() {
            fs::copy(&path, &backup).map_err(|e| format!("Couldn't back up {}: {e}", path.display()))?;
        }
    }
    let mut text = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    text.push('\n');
    // Write a temporary file and rename it over the config, so the agent
    // never reads a half-written file.
    let write = || -> std::io::Result<()> {
        let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
        tmp.write_all(text.as_bytes())?;
        if let Ok(meta) = fs::metadata(&path) {
            let _ = tmp.as_file().set_permissions(meta.permissions());
        }
        tmp.persist(&path).map_err(|e| e.error)?;
        Ok(())
    };
    write().map_err(|e| format!("Couldn't write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE: Format = Format::Grouped { event: "PostToolUse", matcher: "Write|Edit|MultiEdit" };
    const CURSOR: Format = Format::Flat { event: "afterFileEdit" };
    const CMD: &str = "'/Applications/Markappoly.app/Contents/MacOS/markappoly' --cli hook";

    #[test]
    fn adds_a_claude_hook_beside_existing_settings() {
        let mut config = json!({
            "model": "opus",
            "hooks": { "PostToolUse": [
                { "matcher": "Edit", "hooks": [{ "type": "command", "command": "prettier" }] }
            ] }
        });
        assert!(apply(&mut config, CLAUDE, Some(CMD)).unwrap());
        assert_eq!(config["model"], "opus");
        let groups = config["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0]["hooks"][0]["command"], "prettier");
        assert_eq!(groups[1]["matcher"], "Write|Edit|MultiEdit");
        assert_eq!(groups[1]["hooks"][0], json!({ "type": "command", "command": CMD }));
        assert!(has_hook(&config, CLAUDE));
    }

    #[test]
    fn enabling_twice_keeps_one_entry_and_updates_the_path() {
        let mut config = json!({});
        apply(&mut config, CLAUDE, Some("'/old/markappoly' --cli hook")).unwrap();
        apply(&mut config, CLAUDE, Some(CMD)).unwrap();
        assert!(!apply(&mut config, CLAUDE, Some(CMD)).unwrap());
        let groups = config["hooks"]["PostToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0]["hooks"][0]["command"], CMD);
    }

    #[test]
    fn disabling_removes_only_our_hook() {
        let mut config = json!({
            "hooks": {
                "PostToolUse": [
                    { "matcher": "Write|Edit|MultiEdit", "hooks": [
                        { "type": "command", "command": "lint" },
                        { "type": "command", "command": CMD }
                    ] },
                    { "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": CMD }] }
                ],
                "Stop": [{ "hooks": [{ "type": "command", "command": "notify" }] }]
            }
        });
        assert!(apply(&mut config, CLAUDE, None).unwrap());
        assert_eq!(
            config["hooks"]["PostToolUse"],
            json!([{ "matcher": "Write|Edit|MultiEdit", "hooks": [{ "type": "command", "command": "lint" }] }])
        );
        assert_eq!(config["hooks"]["Stop"][0]["hooks"][0]["command"], "notify");
        assert!(!has_hook(&config, CLAUDE));
    }

    #[test]
    fn disabling_the_only_hook_leaves_no_empty_containers() {
        let mut config = json!({ "theme": "dark" });
        apply(&mut config, CLAUDE, Some(CMD)).unwrap();
        apply(&mut config, CLAUDE, None).unwrap();
        assert_eq!(config, json!({ "theme": "dark" }));
        assert!(!apply(&mut config, CLAUDE, None).unwrap());
    }

    #[test]
    fn cursor_hooks_are_flat_and_versioned() {
        let mut config = json!({});
        apply(&mut config, CURSOR, Some(CMD)).unwrap();
        assert_eq!(
            config,
            json!({ "version": 1, "hooks": { "afterFileEdit": [{ "command": CMD }] } })
        );
        assert!(has_hook(&config, CURSOR));
        let mut other = json!({ "version": 1, "hooks": { "afterFileEdit": [{ "command": "./format.sh" }] } });
        apply(&mut other, CURSOR, Some(CMD)).unwrap();
        apply(&mut other, CURSOR, None).unwrap();
        assert_eq!(other, json!({ "version": 1, "hooks": { "afterFileEdit": [{ "command": "./format.sh" }] } }));
    }

    #[test]
    fn refuses_unexpected_shapes() {
        for mut bad in [json!({ "hooks": [] }), json!({ "hooks": { "PostToolUse": {} } }), json!([])] {
            assert!(apply(&mut bad, CLAUDE, Some(CMD)).is_err(), "{bad}");
        }
    }

    #[test]
    fn writes_merge_back_up_and_refuse_broken_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "{\n  \"zeta\": 1,\n  \"alpha\": 2\n}\n").unwrap();
        update_config(&path, CLAUDE, Some(CMD)).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        // Key order is kept, so the user's file stays recognisable.
        assert!(text.find("zeta").unwrap() < text.find("alpha").unwrap());
        assert!(has_hook(&read_config(&path).unwrap(), CLAUDE));
        let backup = dir.path().join("settings.json.markappoly.bak");
        assert_eq!(fs::read_to_string(&backup).unwrap(), "{\n  \"zeta\": 1,\n  \"alpha\": 2\n}\n");

        let missing = dir.path().join("hooks.json");
        update_config(&missing, CURSOR, Some(CMD)).unwrap();
        assert!(has_hook(&read_config(&missing).unwrap(), CURSOR));

        let broken = dir.path().join("broken.json");
        fs::write(&broken, "{ \"hooks\": ").unwrap();
        assert!(update_config(&broken, CLAUDE, Some(CMD)).is_err());
        assert_eq!(fs::read_to_string(&broken).unwrap(), "{ \"hooks\": ");
    }

    #[test]
    fn recognises_only_our_command() {
        assert!(is_ours(&json!({ "command": CMD })));
        assert!(!is_ours(&json!({ "command": "markappoly notes.md" })));
        assert!(!is_ours(&json!({ "type": "prompt" })));
    }

    #[cfg(unix)]
    #[test]
    fn quotes_paths_for_the_shell() {
        assert_eq!(quote("/a b/it's"), r"'/a b/it'\''s'");
    }
}
