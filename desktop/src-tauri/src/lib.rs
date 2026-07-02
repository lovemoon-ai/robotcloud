use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    fs::{self, File},
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child as StdChild, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

const RELEASE_WEB_URL: &str = "https://robotcloud.conductor-ai.top/so101/";
const DEBUG_WEB_URL: &str = "http://127.0.0.1:6151/so101/";

const BRIDGE_SCRIPT: &str = r#"
(function () {
  function waitForTauri(callback) {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.event) {
      callback();
      return;
    }
    setTimeout(function () { waitForTauri(callback); }, 25);
  }

  waitForTauri(function () {
    var core = window.__TAURI__.core;
    var event = window.__TAURI__.event;
    function listen(name, callback) {
      var unlistenPromise = event.listen(name, function (payload) {
        callback(payload.payload);
      });
      return function () {
        unlistenPromise.then(function (unlisten) { unlisten(); });
      };
    }

    window.robotcloudDesktop = {
      isDesktop: true,
      status: function () { return core.invoke("desktop_status"); },
      so101: {
        run: function (config) { return core.invoke("so101_run", { config: config }); },
        stop: function (runId) { return core.invoke("so101_stop", { runId: runId }); },
        validatePort: function (value) { return core.invoke("so101_validate_port", { value: value }); },
        validateCamera: function (cameraId, width, height) { return core.invoke("so101_validate_camera", { cameraId: cameraId, width: width, height: height }); },
        previewCamera: function (cameraId, width, height, fps) { return core.invoke("so101_preview_camera", { cameraId: cameraId, width: width, height: height, fps: fps }); },
        onOutput: function (callback) { return listen("so101-output", callback); },
        onExit: function (callback) { return listen("so101-exit", callback); }
      },
      terminal: {
        start: function () { return core.invoke("terminal_start"); },
        write: function (sessionId, data) { return core.invoke("terminal_write", { sessionId: sessionId, data: data }); },
        resize: function (sessionId, cols, rows) { return core.invoke("terminal_resize", { sessionId: sessionId, cols: cols, rows: rows }); },
        stop: function (sessionId) { return core.invoke("terminal_stop", { sessionId: sessionId }); },
        onOutput: function (callback) { return listen("terminal-output", callback); },
        onExit: function (callback) { return listen("terminal-exit", callback); }
      }
    };
    window.dispatchEvent(new CustomEvent("robotcloud-desktop-ready"));
  });
})();
"#;

struct AppState {
    processes: Arc<Mutex<HashMap<String, Arc<Mutex<StdChild>>>>>,
    terminals: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

#[derive(Clone)]
struct TerminalSession {
    child: Arc<Mutex<Box<dyn PtyChild + Send + Sync>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

static RUNTIME_EXTRACT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

impl Default for AppState {
    fn default() -> Self {
        Self {
            processes: Arc::new(Mutex::new(HashMap::new())),
            terminals: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    is_desktop: bool,
    platform: String,
    app_version: String,
    api_base_url: String,
    web_url: String,
    runtime_path: Option<String>,
    runtime_ready: bool,
    runtime_archive_path: Option<String>,
    runtime_archive_ready: bool,
    runtime_error: Option<String>,
    script_path: Option<String>,
    script_ready: bool,
    data_dir: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProcessOutputEvent {
    run_id: String,
    stream: String,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProcessExitEvent {
    run_id: String,
    code: Option<i32>,
    signal: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalStarted {
    session_id: String,
    shell: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    session_id: String,
    data: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    session_id: String,
    code: Option<i32>,
    signal: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ValidationResult {
    ok: bool,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewStarted {
    run_id: String,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct So101RunConfig {
    action: String,
    follower_port: Option<String>,
    leader_port: Option<String>,
    camera_id: Option<String>,
    camera_index: Option<u32>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<u32>,
    robot_id: Option<String>,
    teleop_id: Option<String>,
    dataset_repo_id: Option<String>,
    dataset_root: Option<String>,
    episodes: Option<u32>,
    episode_time_s: Option<f64>,
    reset_time_s: Option<f64>,
    task: Option<String>,
    teleop_time_s: Option<f64>,
    max_relative_target: Option<f64>,
    display_data: Option<bool>,
}

fn default_web_url() -> &'static str {
    if cfg!(debug_assertions) {
        DEBUG_WEB_URL
    } else {
        RELEASE_WEB_URL
    }
}

fn app_title() -> &'static str {
    if cfg!(debug_assertions) {
        "RobotCloud-debug"
    } else {
        "RobotCloud"
    }
}

fn web_url() -> String {
    env::var("ROBOTCLOUD_DESKTOP_URL").unwrap_or_else(|_| default_web_url().to_string())
}

fn api_base_url() -> String {
    env::var("ROBOTCLOUD_API_BASE_URL")
        .unwrap_or_else(|_| "https://robotcloud.conductor-ai.top/api/v1".to_string())
}

fn platform_key() -> &'static str {
    if cfg!(target_os = "windows") {
        "win"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn exe_dir() -> Option<PathBuf> {
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(PathBuf::from))
}

fn resource_candidates(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.clone());
        candidates.push(dir.join("resources"));
    }
    if let Some(dir) = exe_dir() {
        candidates.push(dir.join("resources"));
    }
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources"));
    candidates
}

fn runtime_path(app: &AppHandle) -> PathBuf {
    if let Ok(path) = env::var("ROBOTCLOUD_LEROBOT_ENV") {
        return PathBuf::from(path);
    }
    if let Some(path) = extracted_runtime_path(app) {
        if python_path(&path).exists() {
            return path;
        }
    }
    for root in resource_candidates(app) {
        let candidate = root
            .join("runtime")
            .join(platform_key())
            .join("lerobot-env");
        if python_path(&candidate).exists() {
            return candidate;
        }
    }
    if let Some(path) = extracted_runtime_path(app) {
        return path;
    }
    extracted_runtime_path(app).unwrap_or_else(|| {
        PathBuf::from("resources")
            .join("runtime")
            .join(platform_key())
            .join("lerobot-env")
    })
}

fn extracted_runtime_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("runtime").join(platform_key()).join("lerobot-env"))
}

fn runtime_archive_name() -> String {
    format!("lerobot-env-{}.zip", platform_key())
}

fn runtime_archive_path(app: &AppHandle) -> Option<PathBuf> {
    let archive_name = runtime_archive_name();
    for root in resource_candidates(app) {
        for candidate in [
            root.join("runtime")
                .join(platform_key())
                .join(&archive_name),
            root.join(&archive_name),
        ] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(unix)]
fn normalize_path_without_fs(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            component => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

#[cfg(unix)]
fn symlink_target_is_safe(link_path: &Path, link_target: &Path, root: &Path) -> bool {
    if link_target.is_absolute() {
        return false;
    }
    let Some(link_parent) = link_path.parent() else {
        return false;
    };
    let resolved = normalize_path_without_fs(&link_parent.join(link_target));
    let root = normalize_path_without_fs(root);
    resolved.starts_with(root)
}

fn extract_runtime_archive(archive_path: &Path, target: &Path) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("invalid runtime target: {}", target.display()))?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let temp = parent.join("lerobot-env.partial");
    if temp.exists() {
        fs::remove_dir_all(&temp).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&temp).map_err(|error| error.to_string())?;

    let archive_file = File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(archive_file).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(enclosed_name) = entry.enclosed_name() else {
            continue;
        };
        let outpath = temp.join(enclosed_name);
        if entry.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            if mode & 0o170000 == 0o120000 {
                let mut link_target = String::new();
                entry
                    .read_to_string(&mut link_target)
                    .map_err(|error| error.to_string())?;
                let link_target = PathBuf::from(link_target);
                if !symlink_target_is_safe(&outpath, &link_target, &temp) {
                    return Err(format!(
                        "Refusing to extract unsafe symlink {} -> {}",
                        outpath.display(),
                        link_target.display()
                    ));
                }
                std::os::unix::fs::symlink(&link_target, &outpath)
                    .map_err(|error| error.to_string())?;
                continue;
            }
        }

        let mut outfile = File::create(&outpath).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut outfile).map_err(|error| error.to_string())?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                fs::set_permissions(&outpath, fs::Permissions::from_mode(mode))
                    .map_err(|error| error.to_string())?;
            }
        }
    }

    if target.exists() {
        fs::remove_dir_all(target).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp, target).map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("ROBOTCLOUD_LEROBOT_ENV") {
        let runtime = PathBuf::from(path);
        if python_path(&runtime).exists() {
            return Ok(runtime);
        }
        return Err(format!("LeRobot runtime not found: {}", runtime.display()));
    }

    let runtime = runtime_path(app);
    if python_path(&runtime).exists() {
        return Ok(runtime);
    }

    let _guard = RUNTIME_EXTRACT_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;

    let runtime = runtime_path(app);
    if python_path(&runtime).exists() {
        return Ok(runtime);
    }

    let Some(target) = extracted_runtime_path(app) else {
        return Err("Could not resolve RobotCloud app data directory".to_string());
    };
    if python_path(&target).exists() {
        return Ok(target);
    }

    let Some(archive) = runtime_archive_path(app) else {
        return Err(format!(
            "LeRobot runtime archive not found for {}",
            platform_key()
        ));
    };
    extract_runtime_archive(&archive, &target)?;
    if python_path(&target).exists() {
        Ok(target)
    } else {
        Err(format!(
            "LeRobot runtime extraction did not create {}",
            python_path(&target).display()
        ))
    }
}

fn script_path(app: &AppHandle) -> PathBuf {
    let name = if cfg!(target_os = "windows") {
        "so101.ps1"
    } else {
        "so101.sh"
    };
    for root in resource_candidates(app) {
        let candidate = root.join("scripts").join(name);
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("resources").join("scripts").join(name)
}

fn python_path(runtime: &PathBuf) -> PathBuf {
    if cfg!(target_os = "windows") {
        runtime.join("python.exe")
    } else {
        runtime.join("bin").join("python")
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = env::var("ROBOTCLOUD_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|_| app.path().app_data_dir().map(|p| p.join("so101-data")))
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn build_command_path(
    runtime: &Path,
    current_path: Option<std::ffi::OsString>,
) -> Result<String, String> {
    let mut path_parts = Vec::new();
    if cfg!(target_os = "windows") {
        path_parts.push(runtime.join("Scripts"));
        path_parts.push(runtime.join("Library").join("bin"));
        path_parts.push(runtime.to_path_buf());
    } else {
        path_parts.push(runtime.join("bin"));
    }
    if let Some(current_path) = current_path {
        path_parts.extend(env::split_paths(&current_path));
    }
    env::join_paths(path_parts)
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

fn command_env(app: &AppHandle) -> Result<Vec<(String, String)>, String> {
    let runtime = runtime_path(app);
    let data = data_dir(app)?;
    let path_value = build_command_path(&runtime, env::var_os("PATH"))?;
    Ok(vec![
        ("PATH".to_string(), path_value),
        ("PYTHONUTF8".to_string(), "1".to_string()),
        ("PYTHONIOENCODING".to_string(), "utf-8".to_string()),
        ("ROBOTCLOUD_API_BASE_URL".to_string(), api_base_url()),
        (
            "ROBOTCLOUD_LEROBOT_ENV".to_string(),
            runtime.to_string_lossy().to_string(),
        ),
        (
            "ROBOTCLOUD_DATA_DIR".to_string(),
            data.to_string_lossy().to_string(),
        ),
    ])
}

fn powershell_program() -> String {
    if cfg!(target_os = "windows") {
        if let Ok(system_root) = env::var("SystemRoot") {
            let candidate = PathBuf::from(system_root)
                .join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe");
            if candidate.exists() {
                return candidate.to_string_lossy().to_string();
            }
        }
    }
    "powershell.exe".to_string()
}

#[cfg(unix)]
fn valid_unix_shell(shell: &str) -> Option<String> {
    let shell = shell.trim();
    if shell.is_empty() || shell.contains('\0') {
        return None;
    }
    let path = Path::new(shell);
    if path.is_absolute() && path.is_file() {
        Some(shell.to_string())
    } else {
        None
    }
}

#[cfg(unix)]
fn unix_terminal_shell() -> String {
    if let Ok(shell) = env::var("SHELL") {
        if let Some(shell) = valid_unix_shell(&shell) {
            return shell;
        }
    }

    for candidate in [
        "/bin/zsh",
        "/bin/bash",
        "/usr/bin/zsh",
        "/usr/bin/bash",
        "/bin/sh",
        "/usr/bin/sh",
    ] {
        if let Some(shell) = valid_unix_shell(candidate) {
            return shell;
        }
    }

    "/bin/sh".to_string()
}

fn terminal_command() -> (String, Vec<String>) {
    if cfg!(target_os = "windows") {
        (
            powershell_program(),
            vec![
                "-NoLogo".to_string(),
                "-NoProfile".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
            ],
        )
    } else {
        #[cfg(unix)]
        {
            return (unix_terminal_shell(), vec!["-l".to_string()]);
        }

        #[allow(unreachable_code)]
        ("/bin/sh".to_string(), vec!["-l".to_string()])
    }
}

fn allowed_action(action: &str) -> bool {
    matches!(
        action,
        "info"
            | "ports"
            | "cameras"
            | "setup-follower"
            | "setup-leader"
            | "calibrate-follower"
            | "calibrate-leader"
            | "teleop"
            | "record"
    )
}

fn push_arg(args: &mut Vec<String>, key: &str, value: impl ToString) {
    args.push(key.to_string());
    args.push(value.to_string());
}

fn so101_command_args(
    script: &Path,
    config: &So101RunConfig,
) -> Result<(String, Vec<String>), String> {
    if !allowed_action(&config.action) {
        return Err(format!("Unsupported SO101 action: {}", config.action));
    }
    if cfg!(target_os = "windows") {
        let mut args = vec![
            "-NoLogo".to_string(),
            "-NoProfile".to_string(),
            "-ExecutionPolicy".to_string(),
            "Bypass".to_string(),
            "-File".to_string(),
            script.to_string_lossy().to_string(),
        ];
        push_arg(&mut args, "-Action", &config.action);
        push_arg(
            &mut args,
            "-FollowerPort",
            config.follower_port.clone().unwrap_or_default(),
        );
        push_arg(
            &mut args,
            "-LeaderPort",
            config.leader_port.clone().unwrap_or_default(),
        );
        if let Some(camera_id) = &config.camera_id {
            if !camera_id.trim().is_empty() {
                push_arg(&mut args, "-CameraId", camera_id);
            }
        }
        push_arg(&mut args, "-CameraIndex", config.camera_index.unwrap_or(0));
        push_arg(&mut args, "-Width", config.width.unwrap_or(640));
        push_arg(&mut args, "-Height", config.height.unwrap_or(480));
        push_arg(&mut args, "-Fps", config.fps.unwrap_or(30));
        push_arg(
            &mut args,
            "-RobotId",
            config
                .robot_id
                .clone()
                .unwrap_or_else(|| "so101_follower".to_string()),
        );
        push_arg(
            &mut args,
            "-TeleopId",
            config
                .teleop_id
                .clone()
                .unwrap_or_else(|| "so101_leader".to_string()),
        );
        push_arg(
            &mut args,
            "-DatasetRepoId",
            config
                .dataset_repo_id
                .clone()
                .unwrap_or_else(|| "local/so101_desktop".to_string()),
        );
        if let Some(root) = &config.dataset_root {
            if !root.trim().is_empty() {
                push_arg(&mut args, "-DatasetRoot", root);
            }
        }
        push_arg(&mut args, "-Episodes", config.episodes.unwrap_or(1));
        push_arg(
            &mut args,
            "-EpisodeTimeS",
            config.episode_time_s.unwrap_or(10.0),
        );
        push_arg(&mut args, "-ResetTimeS", config.reset_time_s.unwrap_or(2.0));
        push_arg(
            &mut args,
            "-TeleopTimeS",
            config.teleop_time_s.unwrap_or(5.0),
        );
        push_arg(
            &mut args,
            "-MaxRelativeTarget",
            config.max_relative_target.unwrap_or(5.0),
        );
        push_arg(
            &mut args,
            "-Task",
            config
                .task
                .clone()
                .unwrap_or_else(|| "SO-101 desktop teleoperation".to_string()),
        );
        if config.display_data.unwrap_or(false) {
            args.push("-DisplayData".to_string());
        }
        Ok((powershell_program(), args))
    } else {
        let mut args = vec![script.to_string_lossy().to_string()];
        push_arg(&mut args, "--action", &config.action);
        push_arg(
            &mut args,
            "--follower-port",
            config.follower_port.clone().unwrap_or_default(),
        );
        push_arg(
            &mut args,
            "--leader-port",
            config.leader_port.clone().unwrap_or_default(),
        );
        if let Some(camera_id) = &config.camera_id {
            if !camera_id.trim().is_empty() {
                push_arg(&mut args, "--camera-id", camera_id);
            }
        }
        push_arg(
            &mut args,
            "--camera-index",
            config.camera_index.unwrap_or(0),
        );
        push_arg(&mut args, "--width", config.width.unwrap_or(640));
        push_arg(&mut args, "--height", config.height.unwrap_or(480));
        push_arg(&mut args, "--fps", config.fps.unwrap_or(30));
        push_arg(
            &mut args,
            "--robot-id",
            config
                .robot_id
                .clone()
                .unwrap_or_else(|| "so101_follower".to_string()),
        );
        push_arg(
            &mut args,
            "--teleop-id",
            config
                .teleop_id
                .clone()
                .unwrap_or_else(|| "so101_leader".to_string()),
        );
        push_arg(
            &mut args,
            "--dataset-repo-id",
            config
                .dataset_repo_id
                .clone()
                .unwrap_or_else(|| "local/so101_desktop".to_string()),
        );
        if let Some(root) = &config.dataset_root {
            if !root.trim().is_empty() {
                push_arg(&mut args, "--dataset-root", root);
            }
        }
        push_arg(&mut args, "--episodes", config.episodes.unwrap_or(1));
        push_arg(
            &mut args,
            "--episode-time-s",
            config.episode_time_s.unwrap_or(10.0),
        );
        push_arg(
            &mut args,
            "--reset-time-s",
            config.reset_time_s.unwrap_or(2.0),
        );
        push_arg(
            &mut args,
            "--teleop-time-s",
            config.teleop_time_s.unwrap_or(5.0),
        );
        push_arg(
            &mut args,
            "--max-relative-target",
            config.max_relative_target.unwrap_or(5.0),
        );
        push_arg(
            &mut args,
            "--task",
            config
                .task
                .clone()
                .unwrap_or_else(|| "SO-101 desktop teleoperation".to_string()),
        );
        if config.display_data.unwrap_or(false) {
            args.push("--display-data".to_string());
        }
        Ok(("/usr/bin/env".to_string(), {
            let mut all = vec!["bash".to_string()];
            all.extend(args);
            all
        }))
    }
}

fn so101_command(
    app: &AppHandle,
    config: &So101RunConfig,
) -> Result<(String, Vec<String>), String> {
    let script = script_path(app);
    if !script.exists() {
        return Err(format!("SO101 script not found: {}", script.display()));
    }
    so101_command_args(&script, config)
}

fn spawn_reader<R: Read + Send + 'static>(
    app: AppHandle,
    event: &'static str,
    id_key: String,
    stream: Option<&'static str>,
    reader: R,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buffer[..n]).to_string();
                    if event == "so101-output" {
                        let _ = app.emit(
                            event,
                            ProcessOutputEvent {
                                run_id: id_key.clone(),
                                stream: stream.unwrap_or("stdout").to_string(),
                                data,
                            },
                        );
                    } else {
                        let _ = app.emit(
                            event,
                            TerminalOutputEvent {
                                session_id: id_key.clone(),
                                data,
                            },
                        );
                    }
                }
                Err(error) => {
                    let data = format!("read error: {error}\n");
                    if event == "so101-output" {
                        let _ = app.emit(
                            event,
                            ProcessOutputEvent {
                                run_id: id_key.clone(),
                                stream: "stderr".to_string(),
                                data,
                            },
                        );
                    } else {
                        let _ = app.emit(
                            event,
                            TerminalOutputEvent {
                                session_id: id_key.clone(),
                                data,
                            },
                        );
                    }
                    break;
                }
            }
        }
    });
}

fn watch_process(
    app: AppHandle,
    state: Arc<Mutex<HashMap<String, Arc<Mutex<StdChild>>>>>,
    id: String,
    exit_event: &'static str,
) {
    thread::spawn(move || loop {
        let status = {
            let map = state.lock().expect("process map poisoned");
            let Some(child_arc) = map.get(&id).cloned() else {
                return;
            };
            let result = child_arc.lock().expect("child poisoned").try_wait();
            result
        };
        match status {
            Ok(Some(status)) => {
                {
                    let mut map = state.lock().expect("process map poisoned");
                    map.remove(&id);
                }
                if exit_event == "so101-exit" {
                    let _ = app.emit(
                        exit_event,
                        ProcessExitEvent {
                            run_id: id,
                            code: status.code(),
                            signal: None,
                        },
                    );
                } else {
                    let _ = app.emit(
                        exit_event,
                        TerminalExitEvent {
                            session_id: id,
                            code: status.code(),
                            signal: None,
                        },
                    );
                }
                return;
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(error) => {
                {
                    let mut map = state.lock().expect("process map poisoned");
                    map.remove(&id);
                }
                if exit_event == "so101-exit" {
                    let _ = app.emit(
                        "so101-output",
                        ProcessOutputEvent {
                            run_id: id.clone(),
                            stream: "stderr".to_string(),
                            data: format!("process wait error: {error}\n"),
                        },
                    );
                } else {
                    let _ = app.emit(
                        "terminal-output",
                        TerminalOutputEvent {
                            session_id: id.clone(),
                            data: format!("process wait error: {error}\n"),
                        },
                    );
                }
                return;
            }
        }
    });
}

fn watch_terminal_process(
    app: AppHandle,
    state: Arc<Mutex<HashMap<String, TerminalSession>>>,
    id: String,
) {
    thread::spawn(move || loop {
        let status = {
            let map = state.lock().expect("terminal map poisoned");
            let Some(session) = map.get(&id).cloned() else {
                return;
            };
            let result = session
                .child
                .lock()
                .expect("terminal child poisoned")
                .try_wait();
            result
        };

        match status {
            Ok(Some(status)) => {
                {
                    let mut map = state.lock().expect("terminal map poisoned");
                    map.remove(&id);
                }
                let _ = app.emit(
                    "terminal-exit",
                    TerminalExitEvent {
                        session_id: id,
                        code: Some(status.exit_code() as i32),
                        signal: status.signal().map(ToString::to_string),
                    },
                );
                return;
            }
            Ok(None) => thread::sleep(Duration::from_millis(200)),
            Err(error) => {
                {
                    let mut map = state.lock().expect("terminal map poisoned");
                    map.remove(&id);
                }
                let _ = app.emit(
                    "terminal-output",
                    TerminalOutputEvent {
                        session_id: id.clone(),
                        data: format!("process wait error: {error}\n"),
                    },
                );
                let _ = app.emit(
                    "terminal-exit",
                    TerminalExitEvent {
                        session_id: id,
                        code: None,
                        signal: Some("wait-error".to_string()),
                    },
                );
                return;
            }
        }
    });
}

const CAMERA_VALIDATE_SCRIPT: &str = r#"
import sys

raw = sys.argv[1].strip()
width = int(sys.argv[2])
height = int(sys.argv[3])

try:
    import cv2
except Exception as exc:
    raise SystemExit(f"Could not import OpenCV: {exc}")

source = int(raw) if raw.isdigit() else raw
cap = cv2.VideoCapture(source)
if width > 0:
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
if height > 0:
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

if not cap.isOpened():
    cap.release()
    raise SystemExit(f"Camera is not available: {raw}")

ok, frame = cap.read()
cap.release()
if not ok or frame is None:
    raise SystemExit(f"Camera opened but did not return a frame: {raw}")

print(f"Camera is available: {raw}")
"#;

const CAMERA_PREVIEW_SCRIPT: &str = r#"
import sys
import time

raw = sys.argv[1].strip()
width = int(sys.argv[2])
height = int(sys.argv[3])
fps = int(sys.argv[4])

try:
    import cv2
except Exception as exc:
    raise SystemExit(f"Could not import OpenCV: {exc}")

source = int(raw) if raw.isdigit() else raw
cap = cv2.VideoCapture(source)
if width > 0:
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
if height > 0:
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
if fps > 0:
    cap.set(cv2.CAP_PROP_FPS, fps)

if not cap.isOpened():
    cap.release()
    raise SystemExit(f"Camera is not available: {raw}")

window = f"RobotCloud Camera Preview - {raw}"
cv2.namedWindow(window, cv2.WINDOW_NORMAL)
while True:
    ok, frame = cap.read()
    if not ok or frame is None:
        time.sleep(0.05)
        continue
    cv2.imshow(window, frame)
    key = cv2.waitKey(1) & 0xFF
    if key in (27, ord("q")):
        break
    try:
        if cv2.getWindowProperty(window, cv2.WND_PROP_VISIBLE) < 1:
            break
    except cv2.error:
        break

cap.release()
cv2.destroyWindow(window)
"#;

fn ok_validation(message: impl Into<String>) -> ValidationResult {
    ValidationResult {
        ok: true,
        message: message.into(),
    }
}

fn failed_validation(message: impl Into<String>) -> ValidationResult {
    ValidationResult {
        ok: false,
        message: message.into(),
    }
}

fn trim_required(value: &str, label: &str) -> Result<String, ValidationResult> {
    let value = value.trim();
    if value.is_empty() {
        Err(failed_validation(format!("{label} is required.")))
    } else {
        Ok(value.to_string())
    }
}

fn camera_source_is_readable(
    app: &AppHandle,
    camera_id: &str,
    width: u32,
    height: u32,
) -> Result<ValidationResult, String> {
    let runtime = ensure_runtime(app)?;
    let width = width.to_string();
    let height = height.to_string();
    let output = Command::new(python_path(&runtime))
        .args(["-c", CAMERA_VALIDATE_SCRIPT, camera_id, &width, &height])
        .current_dir(data_dir(app)?)
        .envs(command_env(app)?)
        .output()
        .map_err(|error| format!("failed to validate camera: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(ok_validation(if stdout.is_empty() {
            format!("Camera is available: {camera_id}")
        } else {
            stdout
        }))
    } else {
        Ok(failed_validation(if stderr.is_empty() {
            format!("Camera validation failed: {camera_id}")
        } else {
            stderr
        }))
    }
}

#[tauri::command]
fn desktop_status(app: AppHandle) -> Result<DesktopStatus, String> {
    let runtime = runtime_path(&app);
    let archive = runtime_archive_path(&app);
    let runtime_ready = python_path(&runtime).exists();
    let runtime_archive_ready = archive.as_ref().is_some_and(|path| path.exists());
    let runtime_error = if runtime_ready || runtime_archive_ready {
        None
    } else {
        Some(format!("LeRobot runtime not found: {}", runtime.display()))
    };
    let script = script_path(&app);
    let data = data_dir(&app)?;
    Ok(DesktopStatus {
        is_desktop: true,
        platform: env::consts::OS.to_string(),
        app_version: app.package_info().version.to_string(),
        api_base_url: api_base_url(),
        web_url: web_url(),
        runtime_ready,
        runtime_path: Some(runtime.to_string_lossy().to_string()),
        runtime_archive_ready,
        runtime_archive_path: archive.map(|path| path.to_string_lossy().to_string()),
        runtime_error,
        script_ready: script.exists(),
        script_path: Some(script.to_string_lossy().to_string()),
        data_dir: data.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn so101_run(
    app: AppHandle,
    state: State<AppState>,
    config: So101RunConfig,
) -> Result<serde_json::Value, String> {
    ensure_runtime(&app)?;
    let (command, args) = so101_command(&app, &config)?;
    let run_id = Uuid::new_v4().to_string();
    let mut child = Command::new(&command)
        .args(&args)
        .current_dir(data_dir(&app)?)
        .envs(command_env(&app)?)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start {command}: {error}"))?;

    let _ = app.emit(
        "so101-output",
        ProcessOutputEvent {
            run_id: run_id.clone(),
            stream: "system".to_string(),
            data: format!("> {} {}\n", command, args.join(" ")),
        },
    );

    if let Some(stdout) = child.stdout.take() {
        spawn_reader(
            app.clone(),
            "so101-output",
            run_id.clone(),
            Some("stdout"),
            stdout,
        );
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_reader(
            app.clone(),
            "so101-output",
            run_id.clone(),
            Some("stderr"),
            stderr,
        );
    }

    let child_arc = Arc::new(Mutex::new(child));
    state
        .processes
        .lock()
        .map_err(|error| error.to_string())?
        .insert(run_id.clone(), child_arc);
    watch_process(app, state.processes.clone(), run_id.clone(), "so101-exit");
    Ok(serde_json::json!({ "runId": run_id }))
}

#[tauri::command]
fn so101_stop(state: State<AppState>, run_id: String) -> Result<serde_json::Value, String> {
    let child_arc = state
        .processes
        .lock()
        .map_err(|error| error.to_string())?
        .get(&run_id)
        .cloned();
    if let Some(child_arc) = child_arc {
        let mut child = child_arc.lock().map_err(|error| error.to_string())?;
        let _ = child.kill();
        Ok(serde_json::json!({ "stopped": true }))
    } else {
        Ok(serde_json::json!({ "stopped": false }))
    }
}

#[tauri::command]
fn so101_validate_port(value: String) -> ValidationResult {
    let value = match trim_required(&value, "port") {
        Ok(value) => value,
        Err(result) => return result,
    };

    if cfg!(target_os = "windows") {
        let upper = value.to_ascii_uppercase();
        let is_com = upper.strip_prefix("COM").is_some_and(|suffix| {
            !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_digit())
        });
        if is_com || Path::new(&value).exists() {
            ok_validation(format!("Port is available: {value}"))
        } else {
            failed_validation(format!("Port was not found: {value}"))
        }
    } else if Path::new(&value).exists() {
        ok_validation(format!("Port is available: {value}"))
    } else {
        failed_validation(format!("Port was not found: {value}"))
    }
}

#[tauri::command]
fn so101_validate_camera(
    app: AppHandle,
    camera_id: String,
    width: u32,
    height: u32,
) -> Result<ValidationResult, String> {
    let camera_id = match trim_required(&camera_id, "camera id") {
        Ok(value) => value,
        Err(result) => return Ok(result),
    };
    camera_source_is_readable(&app, &camera_id, width, height)
}

#[tauri::command]
fn so101_preview_camera(
    app: AppHandle,
    state: State<AppState>,
    camera_id: String,
    width: u32,
    height: u32,
    fps: u32,
) -> Result<PreviewStarted, String> {
    let camera_id = trim_required(&camera_id, "camera id").map_err(|result| result.message)?;
    let runtime = ensure_runtime(&app)?;
    let run_id = Uuid::new_v4().to_string();
    let mut child = Command::new(python_path(&runtime))
        .arg("-c")
        .arg(CAMERA_PREVIEW_SCRIPT)
        .arg(&camera_id)
        .arg(width.to_string())
        .arg(height.to_string())
        .arg(fps.to_string())
        .current_dir(data_dir(&app)?)
        .envs(command_env(&app)?)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start camera preview: {error}"))?;

    if let Some(stdout) = child.stdout.take() {
        spawn_reader(
            app.clone(),
            "so101-output",
            run_id.clone(),
            Some("stdout"),
            stdout,
        );
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_reader(
            app.clone(),
            "so101-output",
            run_id.clone(),
            Some("stderr"),
            stderr,
        );
    }

    state
        .processes
        .lock()
        .map_err(|error| error.to_string())?
        .insert(run_id.clone(), Arc::new(Mutex::new(child)));
    watch_process(app, state.processes.clone(), run_id.clone(), "so101-exit");
    Ok(PreviewStarted { run_id })
}

#[tauri::command]
fn terminal_start(app: AppHandle, state: State<AppState>) -> Result<TerminalStarted, String> {
    ensure_runtime(&app)?;
    let session_id = Uuid::new_v4().to_string();
    let (shell, args) = terminal_command();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to open terminal pty: {error}"))?;

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to create terminal reader: {error}"))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to create terminal writer: {error}"))?;

    let mut command = CommandBuilder::new(&shell);
    command.args(&args);
    command.cwd(data_dir(&app)?.as_os_str());
    for (key, value) in command_env(&app)? {
        command.env(key, value);
    }
    if !cfg!(target_os = "windows") {
        command.env("TERM", "xterm-256color");
    }

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to start terminal: {error}"))?;

    if cfg!(target_os = "windows") {
        let _ = writer.write_all(
            b"Write-Host \"RobotCloud LeRobot runtime: $env:ROBOTCLOUD_LEROBOT_ENV\"\r\n",
        );
    } else {
        let _ = writer.write_all(
            b"printf \"RobotCloud LeRobot runtime: %s\\n\" \"$ROBOTCLOUD_LEROBOT_ENV\"\n",
        );
    }
    let _ = writer.flush();

    spawn_reader(
        app.clone(),
        "terminal-output",
        session_id.clone(),
        None,
        reader,
    );

    let session = TerminalSession {
        child: Arc::new(Mutex::new(child)),
        master: Arc::new(Mutex::new(pair.master)),
        writer: Arc::new(Mutex::new(writer)),
    };
    state
        .terminals
        .lock()
        .map_err(|error| error.to_string())?
        .insert(session_id.clone(), session);
    watch_terminal_process(app, state.terminals.clone(), session_id.clone());
    Ok(TerminalStarted { session_id, shell })
}

#[tauri::command]
fn terminal_write(
    state: State<AppState>,
    session_id: String,
    data: String,
) -> Result<serde_json::Value, String> {
    let child_arc = state
        .terminals
        .lock()
        .map_err(|error| error.to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "terminal session not found".to_string())?;
    let mut writer = child_arc.writer.lock().map_err(|error| error.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn terminal_resize(
    state: State<AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<serde_json::Value, String> {
    let session = state
        .terminals
        .lock()
        .map_err(|error| error.to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "terminal session not found".to_string())?;
    session
        .master
        .lock()
        .map_err(|error| error.to_string())?
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn terminal_stop(state: State<AppState>, session_id: String) -> Result<serde_json::Value, String> {
    let session = state
        .terminals
        .lock()
        .map_err(|error| error.to_string())?
        .get(&session_id)
        .cloned();
    if let Some(session) = session {
        let mut child = session.child.lock().map_err(|error| error.to_string())?;
        let _ = child.kill();
        Ok(serde_json::json!({ "stopped": true }))
    } else {
        Ok(serde_json::json!({ "stopped": false }))
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_status,
            so101_run,
            so101_stop,
            so101_validate_port,
            so101_validate_camera,
            so101_preview_camera,
            terminal_start,
            terminal_write,
            terminal_resize,
            terminal_stop
        ])
        .setup(|app| {
            let url = web_url();
            let parsed_url = url::Url::parse(&url).map_err(|error| {
                Box::<dyn std::error::Error>::from(format!(
                    "Invalid ROBOTCLOUD_DESKTOP_URL {url}: {error}"
                ))
            })?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed_url))
                .title(app_title())
                .inner_size(1280.0, 860.0)
                .min_inner_size(980.0, 700.0)
                .initialization_script(BRIDGE_SCRIPT)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running RobotCloud Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config(action: &str) -> So101RunConfig {
        So101RunConfig {
            action: action.to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn default_web_url_follows_build_profile() {
        if cfg!(debug_assertions) {
            assert_eq!(default_web_url(), "http://127.0.0.1:6151/so101/");
        } else {
            assert_eq!(
                default_web_url(),
                "https://robotcloud.conductor-ai.top/so101/"
            );
        }
    }

    #[test]
    fn app_title_follows_build_profile() {
        if cfg!(debug_assertions) {
            assert_eq!(app_title(), "RobotCloud-debug");
        } else {
            assert_eq!(app_title(), "RobotCloud");
        }
    }

    #[test]
    fn action_allowlist_matches_so101_surface() {
        for action in [
            "info",
            "ports",
            "cameras",
            "setup-follower",
            "setup-leader",
            "calibrate-follower",
            "calibrate-leader",
            "teleop",
            "record",
        ] {
            assert!(allowed_action(action), "{action} should be allowed");
        }
        assert!(!allowed_action("shell"));
        assert!(!allowed_action("info; whoami"));
    }

    #[test]
    fn rejects_unknown_so101_actions_before_spawn() {
        let error = so101_command_args(Path::new("so101.ps1"), &test_config("info; whoami"))
            .expect_err("unsafe actions must be rejected");
        assert!(error.contains("Unsupported SO101 action"));
    }

    #[test]
    fn builds_info_command_for_current_platform() {
        let (program, args) =
            so101_command_args(Path::new("scripts/so101.ps1"), &test_config("info")).unwrap();

        if cfg!(target_os = "windows") {
            assert!(program.to_lowercase().ends_with("powershell.exe"));
            assert!(args.iter().any(|arg| arg == "-ExecutionPolicy"));
            assert!(args.windows(2).any(|pair| pair == ["-Action", "info"]));
        } else {
            assert_eq!(program, "/usr/bin/env");
            assert_eq!(args.first().map(String::as_str), Some("bash"));
            assert!(args.windows(2).any(|pair| pair == ["--action", "info"]));
        }
    }

    #[cfg(unix)]
    #[test]
    fn rejects_invalid_shell_env_values() {
        assert!(valid_unix_shell("C:\\Windows\\System32\\cmd.exe").is_none());
        assert!(valid_unix_shell("zsh").is_none());
        assert!(valid_unix_shell("").is_none());
    }

    #[cfg(unix)]
    #[test]
    fn terminal_command_uses_absolute_unix_shell() {
        let (program, args) = terminal_command();
        assert!(Path::new(&program).is_absolute());
        assert!(!program.contains('\\'));
        assert_eq!(args, vec!["-l".to_string()]);
    }

    #[cfg(unix)]
    #[test]
    fn command_path_splits_existing_path_before_joining() {
        let runtime = Path::new("/tmp/robotcloud-runtime");
        let path = build_command_path(
            runtime,
            Some(std::ffi::OsString::from("/usr/bin:/bin:/opt/homebrew/bin")),
        )
        .unwrap();

        assert_eq!(
            path,
            "/tmp/robotcloud-runtime/bin:/usr/bin:/bin:/opt/homebrew/bin"
        );
    }

    #[cfg(unix)]
    #[test]
    fn extracts_unix_symlinks_from_runtime_archive() {
        let base = env::temp_dir().join(format!("robotcloud-runtime-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&base).unwrap();
        let source = base.join("source");
        fs::create_dir_all(source.join("bin")).unwrap();
        let archive_path = base.join("runtime.zip");
        let target = base.join("lerobot-env");

        fs::write(source.join("bin/python3.12"), b"#!/bin/sh\n").unwrap();
        std::os::unix::fs::symlink("python3.12", source.join("bin/python")).unwrap();

        let zip_status = Command::new("zip")
            .args(["-qry", "-y"])
            .arg(&archive_path)
            .arg(".")
            .current_dir(&source)
            .status();
        let Ok(zip_status) = zip_status else {
            eprintln!("skipping symlink archive extraction test because zip is unavailable");
            fs::remove_dir_all(&base).unwrap();
            return;
        };
        if !zip_status.success() {
            fs::remove_dir_all(&base).unwrap();
            panic!("zip failed with status {zip_status}");
        }

        extract_runtime_archive(&archive_path, &target).unwrap();

        let python_link = target.join("bin/python");
        let metadata = fs::symlink_metadata(&python_link).unwrap();
        assert!(metadata.file_type().is_symlink());
        assert_eq!(
            fs::read_link(&python_link).unwrap(),
            PathBuf::from("python3.12")
        );
        assert!(target.join("bin/python3.12").exists());

        fs::remove_dir_all(&base).unwrap();
    }
}
