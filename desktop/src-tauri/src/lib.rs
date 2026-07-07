use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    fs::{self, File},
    io::{BufReader, Read, Seek, Write},
    path::{Path, PathBuf},
    process::{Child as StdChild, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::Response, AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};
use uuid::Uuid;

const RELEASE_WEB_URL: &str = "https://robotcloud.conductor-ai.top/so101/";
const DEBUG_WEB_URL: &str = "http://127.0.0.1:6151/so101/";
const MIN_DATASET_UPLOAD_EPISODES: u64 = 1;
const MIN_DATASET_UPLOAD_DURATION_SECONDS: f64 = 1.0;
const RUNTIME_READY_MARKER_VERSION: &str = "2";
const WINDOWS_SHIMS_MARKER_VERSION: &str = "2";

const DEFAULT_BRIDGE_SCRIPT: &str = r#"
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
      dataset: {
        inspectUpload: function (config) { return core.invoke("dataset_inspect_upload", { config: config }); },
        prepareUpload: function (config) { return core.invoke("dataset_prepare_upload", { config: config }); },
        readPreparedUpload: function (filePath) { return core.invoke("dataset_read_prepared_upload", { filePath: filePath }); }
      },
      runtime: {
        prepare: function () { return core.invoke("runtime_prepare"); },
        onProgress: function (callback) { return listen("runtime-progress", callback); }
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

const WINDOWS_BRIDGE_SCRIPT: &str = r#"
(function () {
  function getInvoke() {
    if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === "function") {
      return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
    }
    if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === "function") {
      return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    }
    return null;
  }

  function getEventApi() {
    if (window.__TAURI__ && window.__TAURI__.event && typeof window.__TAURI__.event.listen === "function") {
      return window.__TAURI__.event;
    }
    return null;
  }

  function getInternalEventApiReady() {
    return Boolean(
      window.__TAURI_INTERNALS__ &&
      typeof window.__TAURI_INTERNALS__.invoke === "function" &&
      typeof window.__TAURI_INTERNALS__.transformCallback === "function"
    );
  }

  function waitForBridge(callback) {
    if (getInvoke() && (getEventApi() || getInternalEventApiReady())) {
      callback();
      return;
    }
    setTimeout(function () { waitForBridge(callback); }, 25);
  }

  waitForBridge(function () {
    function invoke(command, args) {
      var invokeFn = getInvoke();
      if (!invokeFn) {
        return Promise.reject(new Error("RobotCloud Desktop IPC is not ready."));
      }
      return invokeFn(command, args || {});
    }

    function listen(name, callback) {
      var event = getEventApi();
      var unlistenPromise;
      if (event) {
        unlistenPromise = event.listen(name, function (payload) {
          callback(payload.payload);
        });
      } else {
        var handler = window.__TAURI_INTERNALS__.transformCallback(function (payload) {
          callback(payload.payload);
        });
        unlistenPromise = invoke("plugin:event|listen", {
          event: name,
          target: { kind: "Any" },
          handler: handler
        }).then(function (eventId) {
          return function () {
            try {
              if (
                window.__TAURI_EVENT_PLUGIN_INTERNALS__ &&
                typeof window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener === "function"
              ) {
                window.__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener(name, eventId);
              }
            } catch (_) {}
            return invoke("plugin:event|unlisten", { event: name, eventId: eventId }).catch(function () {});
          };
        });
      }
      return function () {
        unlistenPromise.then(function (unlisten) { unlisten(); }).catch(function () {});
      };
    }

    window.robotcloudDesktop = {
      isDesktop: true,
      status: function () { return invoke("desktop_status"); },
      so101: {
        run: function (config) { return invoke("so101_run", { config: config }); },
        stop: function (runId) { return invoke("so101_stop", { runId: runId }); },
        validatePort: function (value) { return invoke("so101_validate_port", { value: value }); },
        validateCamera: function (cameraId, width, height) { return invoke("so101_validate_camera", { cameraId: cameraId, width: width, height: height }); },
        previewCamera: function (cameraId, width, height, fps) { return invoke("so101_preview_camera", { cameraId: cameraId, width: width, height: height, fps: fps }); },
        onOutput: function (callback) { return listen("so101-output", callback); },
        onExit: function (callback) { return listen("so101-exit", callback); }
      },
      dataset: {
        inspectUpload: function (config) { return invoke("dataset_inspect_upload", { config: config }); },
        prepareUpload: function (config) { return invoke("dataset_prepare_upload", { config: config }); },
        readPreparedUpload: function (filePath) { return invoke("dataset_read_prepared_upload", { filePath: filePath }); }
      },
      runtime: {
        prepare: function () { return invoke("runtime_prepare"); },
        onProgress: function (callback) { return listen("runtime-progress", callback); }
      },
      terminal: {
        start: function () { return invoke("terminal_start"); },
        write: function (sessionId, data) { return invoke("terminal_write", { sessionId: sessionId, data: data }); },
        resize: function (sessionId, cols, rows) { return invoke("terminal_resize", { sessionId: sessionId, cols: cols, rows: rows }); },
        stop: function (sessionId) { return invoke("terminal_stop", { sessionId: sessionId }); },
        onOutput: function (callback) { return listen("terminal-output", callback); },
        onExit: function (callback) { return listen("terminal-exit", callback); }
      }
    };
    window.dispatchEvent(new CustomEvent("robotcloud-desktop-ready"));
  });
})();
"#;

fn bridge_script() -> &'static str {
    if cfg!(target_os = "windows") {
        WINDOWS_BRIDGE_SCRIPT
    } else {
        DEFAULT_BRIDGE_SCRIPT
    }
}

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
    scripts_dir: Option<String>,
    script_ready: bool,
    data_dir: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeProgressEvent {
    phase: String,
    message: String,
    current: Option<u64>,
    total: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimePrepared {
    runtime_path: String,
    ready: bool,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fps: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CameraValidationProfile {
    message: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<u32>,
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
    camera_config: Option<String>,
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
    min_episode_time_s: Option<f64>,
    max_episode_time_s: Option<f64>,
    reset_time_s: Option<f64>,
    task: Option<String>,
    teleop_time_s: Option<f64>,
    max_relative_target: Option<f64>,
    display_data: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatasetPrepareUploadConfig {
    dataset_root: String,
    dataset_repo_id: String,
    task: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreparedDatasetUpload {
    file_path: String,
    file_name: String,
    file_size: u64,
    dataset_root: String,
    name: String,
    description: String,
    visibility: String,
    created_at: String,
    stats: DatasetUploadInspection,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DatasetUploadInspection {
    dataset_root: String,
    file_count: u64,
    total_bytes: u64,
    episode_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_frames: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fps: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_seconds: Option<f64>,
}

#[derive(Debug, Default)]
struct DatasetDirectoryStats {
    file_count: u64,
    total_bytes: u64,
    episode_data_files: u64,
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
        if runtime_has_basic_entrypoints(&path) {
            return path;
        }
    }
    for root in resource_candidates(app) {
        let candidate = root
            .join("runtime")
            .join(platform_key())
            .join("lerobot-env");
        if runtime_has_basic_entrypoints(&candidate) {
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

fn runtime_archive_signature(archive: Option<&Path>) -> String {
    let Some(archive) = archive else {
        return format!("marker={RUNTIME_READY_MARKER_VERSION}\narchive=external\n");
    };
    let metadata = fs::metadata(archive).ok();
    let len = metadata
        .as_ref()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    format!(
        "marker={RUNTIME_READY_MARKER_VERSION}\narchive={}\nlen={len}\n",
        archive.file_name().unwrap_or_default().to_string_lossy()
    )
}

fn runtime_ready_marker_path(runtime: &Path) -> PathBuf {
    runtime.join(".robotcloud-runtime-ready")
}

fn runtime_has_basic_entrypoints(runtime: &Path) -> bool {
    python_path(&runtime.to_path_buf()).exists() && lerobot_info_path(runtime).exists()
}

fn runtime_ready_marker_is_current(runtime: &Path, archive: Option<&Path>) -> bool {
    if !runtime_has_basic_entrypoints(runtime) {
        return false;
    }
    fs::read_to_string(runtime_ready_marker_path(runtime))
        .map(|content| content == runtime_archive_signature(archive))
        .unwrap_or(false)
}

fn write_runtime_ready_marker(runtime: &Path, archive: Option<&Path>) -> Result<(), String> {
    fs::write(
        runtime_ready_marker_path(runtime),
        runtime_archive_signature(archive),
    )
    .map_err(|error| error.to_string())
}

fn runtime_status_validation_error(runtime: &PathBuf, archive: Option<&Path>) -> Option<String> {
    if runtime_ready_marker_is_current(runtime, archive) {
        None
    } else {
        runtime_validation_error(runtime)
    }
}

fn emit_runtime_progress<F>(
    progress: &mut F,
    phase: &str,
    message: impl Into<String>,
    current: Option<u64>,
    total: Option<u64>,
) where
    F: FnMut(RuntimeProgressEvent),
{
    progress(RuntimeProgressEvent {
        phase: phase.to_string(),
        message: message.into(),
        current,
        total,
    });
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

fn extract_runtime_archive<F>(
    archive_path: &Path,
    target: &Path,
    progress: &mut F,
) -> Result<(), String>
where
    F: FnMut(RuntimeProgressEvent),
{
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
    let total_entries = archive.len() as u64;
    emit_runtime_progress(
        progress,
        "extracting",
        "Preparing LeRobot runtime: extracting archive...",
        Some(0),
        Some(total_entries),
    );
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let current = index as u64 + 1;
        if index == 0 || current == total_entries || current % 100 == 0 {
            emit_runtime_progress(
                progress,
                "extracting",
                format!("Preparing LeRobot runtime: extracting {current}/{total_entries} files..."),
                Some(current),
                Some(total_entries),
            );
        }
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
    emit_runtime_progress(
        progress,
        "extracting",
        "Preparing LeRobot runtime: extraction complete.",
        Some(total_entries),
        Some(total_entries),
    );
    Ok(())
}

fn runtime_relocation_marker_path(runtime: &Path) -> PathBuf {
    runtime.join(".robotcloud-runtime-relocated")
}

fn runtime_relocation_is_done(runtime: &Path) -> bool {
    runtime_relocation_marker_path(runtime).exists()
}

fn run_runtime_relocation_fixups(runtime: &PathBuf) -> Result<(), String> {
    if runtime_relocation_is_done(runtime) {
        return Ok(());
    }

    let conda_unpack = if cfg!(target_os = "windows") {
        runtime.join("Scripts").join("conda-unpack.exe")
    } else {
        runtime.join("bin").join("conda-unpack")
    };
    if !conda_unpack.exists() {
        return Ok(());
    }

    let python = python_path(runtime);
    if !python.exists() {
        return Ok(());
    }

    let path_value = build_command_path(runtime, env::var_os("PATH"))?;
    let mut command = if cfg!(target_os = "windows") {
        Command::new(&conda_unpack)
    } else {
        let mut command = Command::new(&python);
        command.arg(&conda_unpack);
        command
    };
    let output = command
        .env("PATH", path_value)
        .env_remove("PYTHONHOME")
        .env_remove("PYTHONPATH")
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .output();

    match output {
        Ok(output) if output.status.success() => {
            fs::write(runtime_relocation_marker_path(runtime), "done\n")
                .map_err(|error| error.to_string())?;
            Ok(())
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("conda-unpack exited with {}", output.status)
            };
            Err(format!(
                "LeRobot runtime relocation failed at {}: {}",
                runtime.display(),
                detail
            ))
        }
        Err(error) => Err(format!(
            "LeRobot runtime relocation failed at {}: {}",
            runtime.display(),
            error
        )),
    }
}

fn ensure_runtime_with_progress<F>(app: &AppHandle, progress: &mut F) -> Result<PathBuf, String>
where
    F: FnMut(RuntimeProgressEvent),
{
    if let Ok(path) = env::var("ROBOTCLOUD_LEROBOT_ENV") {
        let runtime = PathBuf::from(path);
        if runtime_is_ready(&runtime) {
            prepare_runtime_with_progress(&runtime, progress)?;
            return Ok(runtime);
        }
        emit_runtime_progress(
            progress,
            "relocating",
            "Preparing LeRobot runtime: applying relocation fixups...",
            None,
            None,
        );
        run_runtime_relocation_fixups(&runtime)?;
        if runtime_is_ready(&runtime) {
            prepare_runtime_with_progress(&runtime, progress)?;
            return Ok(runtime);
        }
        return Err(runtime_not_ready_message(&runtime));
    }

    let runtime = runtime_path(app);
    let archive = runtime_archive_path(app);
    if runtime_ready_marker_is_current(&runtime, archive.as_deref()) {
        prepare_runtime_with_progress(&runtime, progress)?;
        return Ok(runtime);
    }

    let _guard = RUNTIME_EXTRACT_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|error| error.to_string())?;

    let runtime = runtime_path(app);
    let archive = runtime_archive_path(app);
    if runtime_ready_marker_is_current(&runtime, archive.as_deref()) {
        prepare_runtime_with_progress(&runtime, progress)?;
        return Ok(runtime);
    }

    let Some(target) = extracted_runtime_path(app) else {
        return Err("Could not resolve RobotCloud app data directory".to_string());
    };
    let archive = runtime_archive_path(app);
    if runtime_ready_marker_is_current(&target, archive.as_deref()) {
        prepare_runtime_with_progress(&target, progress)?;
        return Ok(target);
    }
    if target.exists() {
        emit_runtime_progress(
            progress,
            "validating",
            "Preparing LeRobot runtime: validating existing files...",
            None,
            None,
        );
        run_runtime_relocation_fixups(&target)?;
        if runtime_is_ready(&target) {
            prepare_runtime_with_progress(&target, progress)?;
            write_runtime_ready_marker(&target, archive.as_deref())?;
            emit_runtime_progress(progress, "ready", "LeRobot runtime is ready.", None, None);
            return Ok(target);
        }
    }

    let Some(archive) = archive else {
        return Err(format!(
            "LeRobot runtime archive not found for {}",
            platform_key()
        ));
    };
    extract_runtime_archive(&archive, &target, progress)?;
    emit_runtime_progress(
        progress,
        "relocating",
        "Preparing LeRobot runtime: applying relocation fixups...",
        None,
        None,
    );
    run_runtime_relocation_fixups(&target)?;
    emit_runtime_progress(
        progress,
        "validating",
        "Preparing LeRobot runtime: validating Python modules...",
        None,
        None,
    );
    if runtime_is_ready(&target) {
        prepare_runtime_with_progress(&target, progress)?;
        write_runtime_ready_marker(&target, Some(&archive))?;
        emit_runtime_progress(progress, "ready", "LeRobot runtime is ready.", None, None);
        Ok(target)
    } else {
        Err(runtime_not_ready_message(&target))
    }
}

fn ensure_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let mut progress = |_event: RuntimeProgressEvent| {};
    ensure_runtime_with_progress(app, &mut progress)
}

fn bundled_script_path(app: &AppHandle, name: &str) -> PathBuf {
    for root in resource_candidates(app) {
        let candidate = root.join("scripts").join(name);
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("resources").join("scripts").join(name)
}

/// Directory that holds the bundled RobotCloud Python scripts (robotcloud_*.py).
/// The frontend joins this with a script name to build `python "<dir>/<script>"`.
fn scripts_dir(app: &AppHandle) -> PathBuf {
    for root in resource_candidates(app) {
        let candidate = root.join("scripts");
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from("resources").join("scripts")
}

fn python_path(runtime: &PathBuf) -> PathBuf {
    if cfg!(target_os = "windows") {
        runtime.join("python.exe")
    } else {
        runtime.join("bin").join("python")
    }
}

fn lerobot_info_path(runtime: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        runtime
            .join("Lib")
            .join("site-packages")
            .join("lerobot")
            .join("scripts")
            .join("lerobot_info.py")
    } else {
        runtime.join("bin").join("lerobot-info")
    }
}

fn runtime_entrypoint_validation_error(runtime: &Path) -> Option<String> {
    // Actions invoke LeRobot via `python -m lerobot.scripts.*` (see so101_command_args),
    // so we no longer depend on the console-script shebang being relocatable. We only check
    // that the entrypoint file exists as an "installed" smoke test; real importability is
    // verified by the `import lerobot` check in runtime_validation_error.
    let lerobot_info = lerobot_info_path(runtime);
    if !lerobot_info.exists() {
        return Some(format!(
            "LeRobot runtime is missing lerobot-info at {}",
            lerobot_info.display()
        ));
    }

    None
}

fn runtime_is_ready(runtime: &PathBuf) -> bool {
    runtime_validation_error(runtime).is_none()
}

fn runtime_not_ready_message(runtime: &PathBuf) -> String {
    runtime_validation_error(runtime).unwrap_or_else(|| {
        format!(
            "LeRobot runtime is not ready: {}",
            runtime.to_string_lossy()
        )
    })
}

fn runtime_validation_error(runtime: &PathBuf) -> Option<String> {
    let python = python_path(runtime);
    if !python.exists() {
        return Some(format!("LeRobot runtime not found: {}", runtime.display()));
    }
    if let Some(error) = runtime_entrypoint_validation_error(runtime) {
        return Some(error);
    }

    let output = Command::new(&python)
        .arg("-c")
        .arg("import lerobot, serial, scservo_sdk")
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .output();

    match output {
        Ok(output) if output.status.success() => None,
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() {
                stderr
            } else if !stdout.is_empty() {
                stdout
            } else {
                format!("python exited with {}", output.status)
            };
            Some(format!(
                "LeRobot runtime is missing required Python modules at {}: {}",
                runtime.display(),
                detail
            ))
        }
        Err(error) => Some(format!(
            "LeRobot runtime Python failed at {}: {}",
            python.display(),
            error
        )),
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, PartialEq, Eq)]
struct ConsoleEntryPoint {
    name: String,
    module: String,
    attribute: String,
}

#[cfg(target_os = "windows")]
fn is_safe_script_name(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

#[cfg(target_os = "windows")]
fn is_safe_python_qualname(value: &str) -> bool {
    !value.is_empty()
        && value.split('.').all(|part| {
            let mut bytes = part.bytes();
            matches!(bytes.next(), Some(byte) if byte.is_ascii_alphabetic() || byte == b'_')
                && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        })
}

#[cfg(target_os = "windows")]
fn parse_console_entry_points(text: &str) -> Vec<ConsoleEntryPoint> {
    let mut section = "";
    let mut entries = Vec::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = &line[1..line.len() - 1];
            continue;
        }
        if section != "console_scripts" {
            continue;
        }

        let Some((name, target)) = line.split_once('=') else {
            continue;
        };
        let name = name.trim();
        let target = target
            .split_once('[')
            .map(|(plain, _)| plain)
            .unwrap_or(target)
            .trim();
        let Some((module, attribute)) = target.split_once(':') else {
            continue;
        };
        let module = module.trim();
        let attribute = attribute.trim();
        if is_safe_script_name(name)
            && is_safe_python_qualname(module)
            && is_safe_python_qualname(attribute)
        {
            entries.push(ConsoleEntryPoint {
                name: name.to_string(),
                module: module.to_string(),
                attribute: attribute.to_string(),
            });
        }
    }
    entries
}

#[cfg(target_os = "windows")]
fn console_shim_content(entry: &ConsoleEntryPoint) -> String {
    format!(
        concat!(
            "@echo off\r\n",
            "setlocal\r\n",
            "set \"ROBOTCLOUD_LEROBOT_ENV=%~dp0..\"\r\n",
            "\"%ROBOTCLOUD_LEROBOT_ENV%\\python.exe\" -c \"",
            "import functools, importlib, re, sys; ",
            "sys.argv[0]=re.sub(r'(-script\\.pyw?|\\.exe)?$', '', sys.argv[0]); ",
            "module=importlib.import_module('{}'); ",
            "sys.exit(functools.reduce(getattr, '{}'.split('.'), module)())",
            "\" %*\r\n",
            "exit /b %ERRORLEVEL%\r\n"
        ),
        entry.module, entry.attribute
    )
}

#[cfg(target_os = "windows")]
fn windows_shims_marker_path(runtime: &Path) -> PathBuf {
    runtime
        .join("robotcloud-shims")
        .join(".robotcloud-shims-ready")
}

#[cfg(target_os = "windows")]
fn windows_shims_are_ready(runtime: &Path) -> bool {
    fs::read_to_string(windows_shims_marker_path(runtime))
        .map(|content| content.trim() == WINDOWS_SHIMS_MARKER_VERSION)
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn ensure_windows_console_shims<F>(runtime: &Path, progress: &mut F) -> Result<(), String>
where
    F: FnMut(RuntimeProgressEvent),
{
    if windows_shims_are_ready(runtime) {
        return Ok(());
    }

    let site_packages = runtime.join("Lib").join("site-packages");
    if !site_packages.exists() {
        return Ok(());
    }

    let shim_dir = runtime.join("robotcloud-shims");
    fs::create_dir_all(&shim_dir).map_err(|error| error.to_string())?;
    let entries = fs::read_dir(&site_packages)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let total = entries.len() as u64;
    emit_runtime_progress(
        progress,
        "shims",
        "Preparing LeRobot runtime: creating command shims...",
        Some(0),
        Some(total),
    );
    for (index, entry) in entries.into_iter().enumerate() {
        let current = index as u64 + 1;
        if index == 0 || current == total || current % 50 == 0 {
            emit_runtime_progress(
                progress,
                "shims",
                format!("Preparing LeRobot runtime: scanning entry points {current}/{total}..."),
                Some(current),
                Some(total),
            );
        }
        let path = entry.path();
        if !path.is_dir()
            || !path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().ends_with(".dist-info"))
        {
            continue;
        }

        let entry_points = path.join("entry_points.txt");
        if !entry_points.exists() {
            continue;
        }
        let text = fs::read_to_string(&entry_points).map_err(|error| error.to_string())?;
        for console_entry in parse_console_entry_points(&text) {
            let shim_path = shim_dir.join(format!("{}.cmd", console_entry.name));
            fs::write(shim_path, console_shim_content(&console_entry))
                .map_err(|error| error.to_string())?;
        }
    }
    fs::write(
        windows_shims_marker_path(runtime),
        WINDOWS_SHIMS_MARKER_VERSION,
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn prepare_runtime_with_progress<F>(runtime: &Path, progress: &mut F) -> Result<(), String>
where
    F: FnMut(RuntimeProgressEvent),
{
    #[cfg(target_os = "windows")]
    ensure_windows_console_shims(runtime, progress)?;
    Ok(())
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = env::var("ROBOTCLOUD_DATA_DIR")
        .map(PathBuf::from)
        .or_else(|_| app.path().app_data_dir().map(|p| p.join("so101-data")))
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn prepared_upload_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("prepared_uploads");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn dataset_repo_path(repo_id: &str) -> Result<PathBuf, String> {
    let mut path = PathBuf::new();
    let mut has_segment = false;
    for segment in repo_id.split(|ch| ch == '/' || ch == '\\') {
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains('\0') {
            return Err("Dataset repo id must be a relative namespace/name path.".to_string());
        }
        has_segment = true;
        path.push(segment);
    }
    if !has_segment {
        return Err("Dataset repo id is required.".to_string());
    }
    Ok(path)
}

fn trusted_dataset_root(app: &AppHandle, repo_id: &str) -> Result<PathBuf, String> {
    let root = data_dir(app)?.join("datasets");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root.join(dataset_repo_path(repo_id)?))
}

fn sanitize_file_stem(value: &str) -> String {
    let mut stem = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches(['_', '.'])
        .chars()
        .take(80)
        .collect::<String>();
    if stem.is_empty() {
        stem = "so101_dataset".to_string();
    }
    stem
}

fn zip_entry_name(source_root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(source_root)
        .map_err(|error| error.to_string())?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

fn zip_directory<W: Write + Seek>(
    zip: &mut zip::ZipWriter<W>,
    source_root: &Path,
    current: &Path,
    file_options: zip::write::FileOptions,
    dir_options: zip::write::FileOptions,
) -> Result<u64, String> {
    let mut file_count = 0_u64;
    for entry in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let resolved_path = path.canonicalize().map_err(|error| error.to_string())?;
        if !resolved_path.starts_with(source_root) {
            return Err(format!(
                "Refusing to package path outside dataset root: {}",
                path.display()
            ));
        }
        let entry_name = zip_entry_name(source_root, &path)?;
        if file_type.is_dir() {
            if !entry_name.is_empty() {
                zip.add_directory(format!("{entry_name}/"), dir_options)
                    .map_err(|error| error.to_string())?;
            }
            file_count += zip_directory(zip, source_root, &path, file_options, dir_options)?;
        } else if file_type.is_file() {
            if entry_name.is_empty() {
                continue;
            }
            zip.start_file(entry_name, file_options)
                .map_err(|error| error.to_string())?;
            let mut input = File::open(&path).map_err(|error| error.to_string())?;
            std::io::copy(&mut input, zip).map_err(|error| error.to_string())?;
            file_count += 1;
        }
    }
    Ok(file_count)
}

fn is_episode_data_file(entry_name: &str) -> bool {
    let file_name = entry_name.rsplit('/').next().unwrap_or(entry_name);
    file_name.starts_with("episode_") && file_name.ends_with(".parquet")
}

fn collect_dataset_directory_stats(
    source_root: &Path,
    current: &Path,
    stats: &mut DatasetDirectoryStats,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            continue;
        }
        let resolved_path = path.canonicalize().map_err(|error| error.to_string())?;
        if !resolved_path.starts_with(source_root) {
            return Err(format!(
                "Refusing to inspect path outside dataset root: {}",
                path.display()
            ));
        }
        if file_type.is_dir() {
            collect_dataset_directory_stats(source_root, &path, stats)?;
        } else if file_type.is_file() {
            let entry_name = zip_entry_name(source_root, &path)?;
            let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
            stats.file_count += 1;
            stats.total_bytes = stats.total_bytes.saturating_add(metadata.len());
            if is_episode_data_file(&entry_name) {
                stats.episode_data_files += 1;
            }
        }
    }
    Ok(())
}

fn json_u64(value: &serde_json::Value, key: &str) -> Option<u64> {
    match value.get(key)? {
        serde_json::Value::Number(number) => number.as_u64().or_else(|| {
            number.as_f64().and_then(|value| {
                if value.is_finite() && value >= 0.0 {
                    Some(value.round() as u64)
                } else {
                    None
                }
            })
        }),
        serde_json::Value::String(value) => value.parse::<u64>().ok(),
        _ => None,
    }
}

fn json_f64(value: &serde_json::Value, key: &str) -> Option<f64> {
    match value.get(key)? {
        serde_json::Value::Number(number) => number.as_f64(),
        serde_json::Value::String(value) => value.parse::<f64>().ok(),
        _ => None,
    }
    .filter(|value| value.is_finite() && *value >= 0.0)
}

fn read_dataset_info(source: &Path) -> (Option<u64>, Option<u64>, Option<f64>, Option<f64>) {
    let Ok(raw) = fs::read_to_string(source.join("meta").join("info.json")) else {
        return (None, None, None, None);
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return (None, None, None, None);
    };
    let episode_count = json_u64(&value, "total_episodes");
    let total_frames = json_u64(&value, "total_frames");
    let fps = json_f64(&value, "fps").filter(|value| *value > 0.0);
    let duration_seconds = ["total_duration_s", "duration_s", "duration_seconds"]
        .iter()
        .find_map(|key| json_f64(&value, key));
    (episode_count, total_frames, fps, duration_seconds)
}

fn inspect_dataset_upload_source(source: &Path) -> Result<DatasetUploadInspection, String> {
    let source = source.canonicalize().map_err(|error| error.to_string())?;
    let mut directory_stats = DatasetDirectoryStats::default();
    collect_dataset_directory_stats(&source, &source, &mut directory_stats)?;
    let (metadata_episodes, total_frames, fps, metadata_duration) = read_dataset_info(&source);
    let duration_seconds = metadata_duration.or_else(|| {
        total_frames.and_then(|frames| {
            fps.and_then(|fps| {
                if fps > 0.0 {
                    Some(frames as f64 / fps)
                } else {
                    None
                }
            })
        })
    });

    Ok(DatasetUploadInspection {
        dataset_root: source.to_string_lossy().to_string(),
        file_count: directory_stats.file_count,
        total_bytes: directory_stats.total_bytes,
        episode_count: metadata_episodes.unwrap_or(directory_stats.episode_data_files),
        total_frames,
        fps,
        duration_seconds,
    })
}

fn validate_dataset_upload_inspection(inspection: &DatasetUploadInspection) -> Result<(), String> {
    let mut issues = Vec::new();
    if inspection.file_count < 1 {
        issues.push("No recorded files were found.".to_string());
    }
    if inspection.episode_count < MIN_DATASET_UPLOAD_EPISODES {
        issues.push(format!(
            "At least {MIN_DATASET_UPLOAD_EPISODES} recorded episode is required."
        ));
    }
    match inspection.duration_seconds {
        Some(duration) if duration >= MIN_DATASET_UPLOAD_DURATION_SECONDS => {}
        Some(_) => issues.push(format!(
            "Recording duration must be at least {MIN_DATASET_UPLOAD_DURATION_SECONDS:.0}s."
        )),
        None => {
            issues.push("Recording duration could not be read from meta/info.json.".to_string())
        }
    }

    if issues.is_empty() {
        Ok(())
    } else {
        Err(format!("Upload blocked: {}", issues.join(" ")))
    }
}

fn build_command_path(
    runtime: &Path,
    current_path: Option<std::ffi::OsString>,
) -> Result<String, String> {
    let mut path_parts = Vec::new();
    if cfg!(target_os = "windows") {
        path_parts.push(runtime.join("robotcloud-shims"));
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
        ("PYTHONNOUSERSITE".to_string(), "1".to_string()),
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

fn terminal_startup_script() -> &'static [u8] {
    if cfg!(target_os = "windows") {
        concat!(
            "Remove-Item Env:PYTHONHOME,Env:PYTHONPATH -ErrorAction SilentlyContinue\r\n",
            "$env:Path = \"$env:ROBOTCLOUD_LEROBOT_ENV\\robotcloud-shims;$env:ROBOTCLOUD_LEROBOT_ENV\\Scripts;$env:ROBOTCLOUD_LEROBOT_ENV\\Library\\bin;$env:ROBOTCLOUD_LEROBOT_ENV;$env:Path\"\r\n",
            "$env:PYTHONNOUSERSITE = \"1\"\r\n",
            "Write-Host \"RobotCloud LeRobot runtime: $env:ROBOTCLOUD_LEROBOT_ENV\"\r\n",
        )
        .as_bytes()
    } else {
        concat!(
            "unset PYTHONHOME PYTHONPATH\n",
            "export PATH=\"$ROBOTCLOUD_LEROBOT_ENV/bin:$PATH\"\n",
            "export PYTHONNOUSERSITE=1\n",
            "hash -r 2>/dev/null || true\n",
            "printf \"RobotCloud LeRobot runtime: %s\\n\" \"$ROBOTCLOUD_LEROBOT_ENV\"\n",
        )
        .as_bytes()
    }
}

fn allowed_action(action: &str) -> bool {
    matches!(
        action,
        "info"
            | "ports"
            | "find-port"
            | "cameras"
            | "setup-follower"
            | "setup-leader"
            | "calibrate-follower"
            | "calibrate-leader"
            | "teleop"
            | "record-reset-pose"
            | "record-auto"
            | "record"
    )
}

fn config_string(value: &Option<String>, default: &str) -> String {
    value.clone().unwrap_or_else(|| default.to_string())
}

fn non_empty_config_string(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .filter(|value| !value.trim().is_empty())
        .cloned()
}

fn required_config_string(value: &Option<String>, name: &str) -> Result<String, String> {
    non_empty_config_string(value).ok_or_else(|| format!("{name} is required."))
}

fn push_eq_arg(args: &mut Vec<String>, key: &str, value: impl ToString) {
    args.push(format!("{key}={}", value.to_string()));
}

fn bool_arg(value: Option<bool>) -> &'static str {
    if value.unwrap_or(false) {
        "true"
    } else {
        "false"
    }
}

fn camera_ref_for_config(config: &So101RunConfig) -> String {
    let value = non_empty_config_string(&config.camera_id)
        .unwrap_or_else(|| config.camera_index.unwrap_or(0).to_string());
    if value.chars().all(|ch| ch.is_ascii_digit()) {
        return value;
    }

    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn camera_config_value(config: &So101RunConfig) -> String {
    if let Some(camera_config) = non_empty_config_string(&config.camera_config) {
        return camera_config;
    }

    format!(
        "{{ front: {{type: opencv, index_or_path: {}, width: {}, height: {}, fps: {}}}}}",
        camera_ref_for_config(config),
        config.width.unwrap_or(640),
        config.height.unwrap_or(480),
        config.fps.unwrap_or(30)
    )
}

fn dataset_repo_id(config: &So101RunConfig) -> String {
    config_string(&config.dataset_repo_id, "local/so101_desktop")
}

fn default_dataset_root(data_dir: &Path, repo_id: &str) -> String {
    let mut path = data_dir.join("datasets");
    for segment in repo_id
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
    {
        path = path.join(segment);
    }
    path.to_string_lossy().to_string()
}

fn dataset_root_for_config(config: &So101RunConfig, data_dir: &Path) -> String {
    non_empty_config_string(&config.dataset_root)
        .unwrap_or_else(|| default_dataset_root(data_dir, &dataset_repo_id(config)))
}

fn ensure_dataset_parent(dataset_root: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(dataset_root).parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn add_common_robot_args(
    args: &mut Vec<String>,
    config: &So101RunConfig,
    include_cameras: bool,
) -> Result<(), String> {
    push_eq_arg(args, "--robot.type", "so101_follower");
    push_eq_arg(
        args,
        "--robot.port",
        required_config_string(&config.follower_port, "Follower port")?,
    );
    if include_cameras {
        push_eq_arg(args, "--robot.cameras", camera_config_value(config));
    }
    push_eq_arg(
        args,
        "--robot.id",
        config_string(&config.robot_id, "so101_follower"),
    );
    // push_eq_arg(
    //     args,
    //     "--robot.max_relative_target",
    //     config.max_relative_target.unwrap_or(5.0),
    // );
    Ok(())
}

fn add_common_teleop_args(args: &mut Vec<String>, config: &So101RunConfig) -> Result<(), String> {
    push_eq_arg(args, "--teleop.type", "so101_leader");
    push_eq_arg(
        args,
        "--teleop.port",
        required_config_string(&config.leader_port, "Leader port")?,
    );
    push_eq_arg(
        args,
        "--teleop.id",
        config_string(&config.teleop_id, "so101_leader"),
    );
    Ok(())
}

fn python_script_args<F>(
    script_name: &str,
    script_path: &F,
    args: Vec<String>,
) -> Result<(String, Vec<String>), String>
where
    F: Fn(&str) -> PathBuf,
{
    let script = script_path(script_name);
    if !script.exists() {
        return Err(format!(
            "RobotCloud Python script not found: {}",
            script.display()
        ));
    }

    let mut all = vec![script.to_string_lossy().to_string()];
    all.extend(args);
    Ok(("python".to_string(), all))
}

fn lerobot_python_module_args(
    _command: &str,
    module: &str,
    args: Vec<String>,
) -> (String, Vec<String>) {
    // Always invoke via `python -m <module>` on every platform, so we never depend on the
    // packaged console-script (e.g. `lerobot-info`) whose shebang may not be relocatable.
    let mut all = vec!["-m".to_string(), module.to_string()];
    all.extend(args);
    ("python".to_string(), all)
}

fn so101_command_args<F>(
    config: &So101RunConfig,
    data_dir: &Path,
    script_path: F,
) -> Result<(String, Vec<String>), String>
where
    F: Fn(&str) -> PathBuf,
{
    if !allowed_action(&config.action) {
        return Err(format!("Unsupported SO101 action: {}", config.action));
    }

    match config.action.as_str() {
        "info" => Ok(lerobot_python_module_args(
            "lerobot-info",
            "lerobot.scripts.lerobot_info",
            vec![],
        )),
        "ports" | "find-port" => Ok(lerobot_python_module_args(
            "lerobot-find-port",
            "lerobot.scripts.lerobot_find_port",
            vec![],
        )),
        "cameras" => Ok(lerobot_python_module_args(
            "lerobot-find-cameras",
            "lerobot.scripts.lerobot_find_cameras",
            vec![
                "opencv".to_string(),
                "--output-dir".to_string(),
                data_dir
                    .join("captured_images")
                    .to_string_lossy()
                    .to_string(),
            ],
        )),
        "setup-follower" => {
            let mut args = vec!["--robot.type=so101_follower".to_string()];
            push_eq_arg(
                &mut args,
                "--robot.port",
                required_config_string(&config.follower_port, "Follower port")?,
            );
            push_eq_arg(
                &mut args,
                "--robot.id",
                config_string(&config.robot_id, "so101_follower"),
            );
            Ok(lerobot_python_module_args(
                "lerobot-setup-motors",
                "lerobot.scripts.lerobot_setup_motors",
                args,
            ))
        }
        "setup-leader" => {
            let mut args = vec!["--teleop.type=so101_leader".to_string()];
            push_eq_arg(
                &mut args,
                "--teleop.port",
                required_config_string(&config.leader_port, "Leader port")?,
            );
            push_eq_arg(
                &mut args,
                "--teleop.id",
                config_string(&config.teleop_id, "so101_leader"),
            );
            Ok(lerobot_python_module_args(
                "lerobot-setup-motors",
                "lerobot.scripts.lerobot_setup_motors",
                args,
            ))
        }
        "calibrate-follower" => {
            let mut args = vec!["--robot.type=so101_follower".to_string()];
            push_eq_arg(
                &mut args,
                "--robot.port",
                required_config_string(&config.follower_port, "Follower port")?,
            );
            push_eq_arg(
                &mut args,
                "--robot.id",
                config_string(&config.robot_id, "so101_follower"),
            );
            Ok(lerobot_python_module_args(
                "lerobot-calibrate",
                "lerobot.scripts.lerobot_calibrate",
                args,
            ))
        }
        "calibrate-leader" => {
            let mut args = vec!["--teleop.type=so101_leader".to_string()];
            push_eq_arg(
                &mut args,
                "--teleop.port",
                required_config_string(&config.leader_port, "Leader port")?,
            );
            push_eq_arg(
                &mut args,
                "--teleop.id",
                config_string(&config.teleop_id, "so101_leader"),
            );
            Ok(lerobot_python_module_args(
                "lerobot-calibrate",
                "lerobot.scripts.lerobot_calibrate",
                args,
            ))
        }
        "teleop" => {
            // Minimal teleoperate: robot + teleop type/port/id only. No cameras,
            // max_relative_target, fps, teleop_time_s, or display_data.
            let mut args = Vec::new();
            push_eq_arg(&mut args, "--robot.type", "so101_follower");
            push_eq_arg(
                &mut args,
                "--robot.port",
                required_config_string(&config.follower_port, "Follower port")?,
            );
            push_eq_arg(
                &mut args,
                "--robot.id",
                config_string(&config.robot_id, "so101_follower"),
            );
            add_common_teleop_args(&mut args, config)?;
            Ok(lerobot_python_module_args(
                "lerobot-teleoperate",
                "lerobot.scripts.lerobot_teleoperate",
                args,
            ))
        }
        "record-reset-pose" => {
            let mut args = Vec::new();
            add_common_robot_args(&mut args, config, false)?;
            add_common_teleop_args(&mut args, config)?;
            push_eq_arg(&mut args, "--fps", config.fps.unwrap_or(30));
            python_script_args("robotcloud_reset_pose.py", &script_path, args)
        }
        "record-auto" => {
            let dataset_root = dataset_root_for_config(config, data_dir);
            let mut args = Vec::new();
            add_common_robot_args(&mut args, config, true)?;
            add_common_teleop_args(&mut args, config)?;
            push_eq_arg(&mut args, "--dataset.repo_id", dataset_repo_id(config));
            push_eq_arg(&mut args, "--dataset.root", dataset_root);
            push_eq_arg(
                &mut args,
                "--dataset.num_episodes",
                config.episodes.unwrap_or(1),
            );
            push_eq_arg(
                &mut args,
                "--dataset.single_task",
                config_string(&config.task, "SO-101 desktop teleoperation"),
            );
            push_eq_arg(&mut args, "--dataset.push_to_hub", "false");
            push_eq_arg(&mut args, "--dataset.streaming_encoding", "true");
            push_eq_arg(&mut args, "--dataset.encoder_threads", 2);
            // push_eq_arg(&mut args, "--dataset.vcodec", "h264");
            push_eq_arg(
                &mut args,
                "--min_episode_time_s",
                config.min_episode_time_s.unwrap_or(2.0),
            );
            push_eq_arg(
                &mut args,
                "--max_episode_time_s",
                config.max_episode_time_s.unwrap_or(60.0),
            );
            push_eq_arg(&mut args, "--display_data", bool_arg(config.display_data));
            python_script_args("robotcloud_auto_record.py", &script_path, args)
        }
        "record" => {
            let dataset_root = dataset_root_for_config(config, data_dir);
            let mut args = Vec::new();
            add_common_robot_args(&mut args, config, true)?;
            add_common_teleop_args(&mut args, config)?;
            push_eq_arg(&mut args, "--dataset.repo_id", dataset_repo_id(config));
            push_eq_arg(&mut args, "--dataset.root", dataset_root);
            push_eq_arg(
                &mut args,
                "--dataset.num_episodes",
                config.episodes.unwrap_or(1),
            );
            push_eq_arg(
                &mut args,
                "--dataset.episode_time_s",
                config.episode_time_s.unwrap_or(10.0),
            );
            push_eq_arg(
                &mut args,
                "--dataset.reset_time_s",
                config.reset_time_s.unwrap_or(2.0),
            );
            push_eq_arg(
                &mut args,
                "--dataset.single_task",
                config_string(&config.task, "SO-101 desktop teleoperation"),
            );
            push_eq_arg(&mut args, "--dataset.push_to_hub", "false");
            push_eq_arg(&mut args, "--dataset.streaming_encoding", "true");
            push_eq_arg(&mut args, "--dataset.encoder_threads", 2);
            // push_eq_arg(&mut args, "--dataset.vcodec", "h264");
            push_eq_arg(&mut args, "--display_data", bool_arg(config.display_data));
            Ok(lerobot_python_module_args(
                "lerobot-record",
                "lerobot.scripts.lerobot_record",
                args,
            ))
        }
        _ => Err(format!("Unsupported SO101 action: {}", config.action)),
    }
}

fn so101_command(
    app: &AppHandle,
    config: &So101RunConfig,
) -> Result<(String, Vec<String>), String> {
    let data = data_dir(app)?;
    if matches!(config.action.as_str(), "record" | "record-auto") {
        let dataset_root = dataset_root_for_config(config, &data);
        ensure_dataset_parent(&dataset_root)?;
    }
    so101_command_args(config, &data, |name| bundled_script_path(app, name))
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

fn kill_terminal_session(session: &TerminalSession) -> Result<(), String> {
    let mut child = session.child.lock().map_err(|error| error.to_string())?;
    let _ = child.kill();
    Ok(())
}

fn kill_all_terminals(terminals: &Arc<Mutex<HashMap<String, TerminalSession>>>) {
    let sessions = match terminals.lock() {
        Ok(mut map) => map.drain().map(|(_, session)| session).collect::<Vec<_>>(),
        Err(_) => return,
    };
    for session in sessions {
        let _ = kill_terminal_session(&session);
    }
}

const CAMERA_VALIDATE_SCRIPT: &str = r#"
import json
import math
import sys

raw = sys.argv[1].strip()
width = int(sys.argv[2])
height = int(sys.argv[3])

try:
    import cv2
except Exception as exc:
    raise SystemExit(f"Could not import OpenCV: {exc}")

source = int(raw) if raw.isdigit() else raw
if sys.platform.startswith("win") and isinstance(source, int) and hasattr(cv2, "CAP_DSHOW"):
    cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(source)
else:
    cap = cv2.VideoCapture(source)
if width > 0:
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
if height > 0:
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)

if not cap.isOpened():
    cap.release()
    raise SystemExit(f"Camera is not available: {raw}")

ok, frame = cap.read()
if not ok or frame is None:
    cap.release()
    raise SystemExit(f"Camera opened but did not return a frame: {raw}")

prop_width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
prop_height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
prop_fps = cap.get(cv2.CAP_PROP_FPS)
frame_height, frame_width = frame.shape[:2]
cap.release()

def positive_int(value):
    try:
        value = float(value)
    except Exception:
        return None
    if not math.isfinite(value) or value <= 0:
        return None
    return int(round(value))

actual_width = positive_int(prop_width) or int(frame_width)
actual_height = positive_int(prop_height) or int(frame_height)
actual_fps = positive_int(prop_fps)
if actual_fps:
    message = f"Camera is available: {raw} ({actual_width}x{actual_height} @ {actual_fps} fps)"
else:
    message = f"Camera is available: {raw} ({actual_width}x{actual_height})"
print(json.dumps({
    "message": message,
    "width": actual_width,
    "height": actual_height,
    "fps": actual_fps,
}))
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
if sys.platform.startswith("win") and isinstance(source, int) and hasattr(cv2, "CAP_DSHOW"):
    cap = cv2.VideoCapture(source, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap.release()
        cap = cv2.VideoCapture(source)
else:
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

def preview_with_tkinter():
    import tkinter as tk
    from PIL import Image, ImageTk

    root = tk.Tk()
    root.title(window)
    root.minsize(320, 240)

    image_label = tk.Label(root, bg="black")
    image_label.pack(fill="both", expand=True)

    status_label = tk.Label(root, text="Opening camera preview...", anchor="w")
    status_label.pack(fill="x")

    running = {"value": True}
    delay_ms = max(1, int(1000 / fps)) if fps > 0 else 33

    def stop(_event=None):
        running["value"] = False
        root.quit()

    root.protocol("WM_DELETE_WINDOW", stop)
    root.bind("<Escape>", stop)
    root.bind("q", stop)
    root.bind("Q", stop)

    def update_frame():
        if not running["value"]:
            return
        ok, frame = cap.read()
        if ok and frame is not None:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = Image.fromarray(rgb)
            photo = ImageTk.PhotoImage(image)
            image_label.configure(image=photo)
            image_label.image = photo
            status_label.configure(text=f"{raw}  {frame.shape[1]}x{frame.shape[0]}")
        else:
            status_label.configure(text="Waiting for camera frame...")
        root.after(delay_ms, update_frame)

    root.after(0, update_frame)
    root.mainloop()
    try:
        root.destroy()
    except tk.TclError:
        pass

def preview_with_opencv_highgui():
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

if sys.platform.startswith("win"):
    try:
        try:
            preview_with_tkinter()
        except Exception as exc:
            print(f"Tk camera preview failed, falling back to OpenCV HighGUI: {exc}", file=sys.stderr)
            preview_with_opencv_highgui()
    finally:
        cap.release()
        try:
            cv2.destroyAllWindows()
        except cv2.error:
            pass
else:
    preview_with_opencv_highgui()
    cap.release()
    cv2.destroyWindow(window)
"#;

fn ok_validation(message: impl Into<String>) -> ValidationResult {
    ValidationResult {
        ok: true,
        message: message.into(),
        width: None,
        height: None,
        fps: None,
    }
}

fn failed_validation(message: impl Into<String>) -> ValidationResult {
    ValidationResult {
        ok: false,
        message: message.into(),
        width: None,
        height: None,
        fps: None,
    }
}

fn ok_camera_validation(
    message: impl Into<String>,
    width: Option<u32>,
    height: Option<u32>,
    fps: Option<u32>,
) -> ValidationResult {
    ValidationResult {
        ok: true,
        message: message.into(),
        width,
        height,
        fps,
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
        if let Ok(profile) = serde_json::from_str::<CameraValidationProfile>(&stdout) {
            Ok(ok_camera_validation(
                profile
                    .message
                    .unwrap_or_else(|| format!("Camera is available: {camera_id}")),
                profile.width,
                profile.height,
                profile.fps,
            ))
        } else {
            Ok(ok_validation(if stdout.is_empty() {
                format!("Camera is available: {camera_id}")
            } else {
                stdout
            }))
        }
    } else {
        Ok(failed_validation(if stderr.is_empty() {
            format!("Camera validation failed: {camera_id}")
        } else {
            stderr
        }))
    }
}

fn resolve_dataset_upload_source(
    app: &AppHandle,
    config: &DatasetPrepareUploadConfig,
) -> Result<PathBuf, String> {
    let dataset_root = config.dataset_root.trim();
    if dataset_root.is_empty() {
        return Err("Dataset root is required.".to_string());
    }
    let dataset_repo_id = config.dataset_repo_id.trim();
    if dataset_repo_id.is_empty() {
        return Err("Dataset repo id is required.".to_string());
    }

    let trusted_root = data_dir(app)?.join("datasets");
    fs::create_dir_all(&trusted_root).map_err(|error| error.to_string())?;
    let trusted_root = trusted_root
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let expected_source = trusted_dataset_root(app, dataset_repo_id)?
        .canonicalize()
        .map_err(|error| {
            format!("Dataset root was not found for repo id {dataset_repo_id}: {error}")
        })?;
    let source = PathBuf::from(dataset_root)
        .canonicalize()
        .map_err(|error| format!("Dataset root was not found: {dataset_root}: {error}"))?;
    if source != expected_source || !source.starts_with(&trusted_root) {
        return Err(format!(
            "Dataset root must match RobotCloud data directory for repo id {dataset_repo_id}: {}",
            expected_source.display()
        ));
    }
    if !source.is_dir() {
        return Err(format!(
            "Dataset root is not a directory: {}",
            source.display()
        ));
    }
    Ok(source)
}

#[tauri::command]
fn dataset_inspect_upload(
    app: AppHandle,
    config: DatasetPrepareUploadConfig,
) -> Result<DatasetUploadInspection, String> {
    let source = resolve_dataset_upload_source(&app, &config)?;
    inspect_dataset_upload_source(&source)
}

#[tauri::command]
fn dataset_prepare_upload(
    app: AppHandle,
    config: DatasetPrepareUploadConfig,
) -> Result<PreparedDatasetUpload, String> {
    let dataset_repo_id = config.dataset_repo_id.trim();
    let source = resolve_dataset_upload_source(&app, &config)?;
    let inspection = inspect_dataset_upload_source(&source)?;
    validate_dataset_upload_inspection(&inspection)?;

    let upload_dir = prepared_upload_dir(&app)?
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if upload_dir.starts_with(&source) {
        return Err("Prepared upload cache cannot be inside the dataset root.".to_string());
    }
    let package_id = Uuid::new_v4().to_string();
    let package_suffix = package_id.chars().take(8).collect::<String>();
    let file_name = format!(
        "{}-{}.zip",
        sanitize_file_stem(dataset_repo_id),
        package_suffix
    );
    let temp_path = upload_dir.join(format!("{file_name}.partial"));
    let final_path = upload_dir.join(&file_name);

    let zip_file = File::create(&temp_path).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipWriter::new(zip_file);
    let file_options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let dir_options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o755);
    let file_count = zip_directory(&mut zip, &source, &source, file_options, dir_options)?;
    zip.finish().map_err(|error| error.to_string())?;

    if file_count == 0 || inspection.file_count == 0 {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("Dataset root has no files: {}", source.display()));
    }
    if final_path.exists() {
        fs::remove_file(&final_path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, &final_path).map_err(|error| error.to_string())?;

    let file_size = fs::metadata(&final_path)
        .map_err(|error| error.to_string())?
        .len();
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let task = config.task.unwrap_or_default();
    let task = task.trim();
    let description = if task.is_empty() {
        format!("SO101 Desktop recording from {}", source.display())
    } else {
        format!("SO101 Desktop recording: {task}")
    };

    Ok(PreparedDatasetUpload {
        file_path: final_path.to_string_lossy().to_string(),
        file_name,
        file_size,
        dataset_root: source.to_string_lossy().to_string(),
        name: dataset_repo_id.to_string(),
        description,
        visibility: "private".to_string(),
        created_at,
        stats: inspection,
    })
}

#[tauri::command]
fn dataset_read_prepared_upload(app: AppHandle, file_path: String) -> Result<Response, String> {
    let upload_dir = prepared_upload_dir(&app)?;
    let upload_dir = upload_dir
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let file = PathBuf::from(file_path.trim())
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !file.starts_with(&upload_dir) {
        return Err("Prepared upload file is outside the RobotCloud upload cache.".to_string());
    }
    if !file.is_file() {
        return Err(format!(
            "Prepared upload file was not found: {}",
            file.display()
        ));
    }
    let bytes = fs::read(&file).map_err(|error| error.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
fn runtime_prepare(app: AppHandle) -> Result<RuntimePrepared, String> {
    let progress_app = app.clone();
    let mut progress = move |event: RuntimeProgressEvent| {
        let _ = progress_app.emit("runtime-progress", event);
    };
    let runtime = ensure_runtime_with_progress(&app, &mut progress)?;
    Ok(RuntimePrepared {
        runtime_path: runtime.to_string_lossy().to_string(),
        ready: true,
    })
}

#[tauri::command]
fn desktop_status(app: AppHandle) -> Result<DesktopStatus, String> {
    let runtime = runtime_path(&app);
    let archive = runtime_archive_path(&app);
    let runtime_error = runtime_status_validation_error(&runtime, archive.as_deref());
    let runtime_ready = runtime_error.is_none();
    let runtime_archive_ready = archive.as_ref().is_some_and(|path| path.exists());
    let runtime_error = if runtime_ready {
        None
    } else if runtime_archive_ready {
        runtime_error
    } else {
        Some(runtime_not_ready_message(&runtime))
    };
    let scripts = scripts_dir(&app);
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
        script_ready: scripts.join("robotcloud_auto_record.py").exists(),
        scripts_dir: Some(scripts.to_string_lossy().to_string()),
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

    let _ = writer.write_all(terminal_startup_script());
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
    // Write terminal input verbatim: what the terminal shows is exactly what runs.
    // No command rewriting happens between display and execution.
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
        kill_terminal_session(&session)?;
        Ok(serde_json::json!({ "stopped": true }))
    } else {
        Ok(serde_json::json!({ "stopped": false }))
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            runtime_prepare,
            desktop_status,
            dataset_inspect_upload,
            dataset_prepare_upload,
            dataset_read_prepared_upload,
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
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                let state = window.state::<AppState>();
                kill_all_terminals(&state.terminals);
            }
            _ => {}
        })
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
                .initialization_script(bridge_script())
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

    fn test_data_dir() -> PathBuf {
        env::temp_dir().join("robotcloud-so101-command-test")
    }

    fn test_script_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("scripts")
            .join(name)
    }

    fn test_so101_command_args(config: &So101RunConfig) -> Result<(String, Vec<String>), String> {
        let data_dir = test_data_dir();
        so101_command_args(config, &data_dir, test_script_path)
    }

    fn create_basic_runtime_entrypoints(runtime: &Path) {
        if cfg!(target_os = "windows") {
            let module_dir = runtime
                .join("Lib")
                .join("site-packages")
                .join("lerobot")
                .join("scripts");
            fs::create_dir_all(&module_dir).unwrap();
            fs::write(runtime.join("python.exe"), b"python").unwrap();
            fs::write(module_dir.join("lerobot_info.py"), b"def main(): pass\n").unwrap();
        } else {
            fs::create_dir_all(runtime.join("bin")).unwrap();
            fs::write(runtime.join("bin").join("python"), b"#!/bin/sh\n").unwrap();
            fs::write(runtime.join("bin").join("lerobot-info"), b"#!/bin/sh\n").unwrap();
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
    fn runtime_ready_marker_signature_ignores_archive_mtime() {
        let base = env::temp_dir().join(format!("robotcloud-runtime-test-{}", Uuid::new_v4()));
        let runtime = base.join("lerobot-env");
        let archive = base.join(runtime_archive_name());
        fs::create_dir_all(&base).unwrap();
        create_basic_runtime_entrypoints(&runtime);
        fs::write(&archive, b"runtime-v1").unwrap();

        write_runtime_ready_marker(&runtime, Some(&archive)).unwrap();
        fs::write(&archive, b"runtime-v2").unwrap();

        assert!(runtime_ready_marker_is_current(&runtime, Some(&archive)));

        fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn parses_console_entry_points_for_runtime_shims() {
        let entries = parse_console_entry_points(
            r#"
[console_scripts]
lerobot-info = lerobot.scripts.lerobot_info:main
unsafe/name = os.system:main
bad-target = os:system-call
robotcloud-nested = robotcloud.cli:commands.main [extra]
"#,
        );

        assert_eq!(
            entries,
            vec![
                ConsoleEntryPoint {
                    name: "lerobot-info".to_string(),
                    module: "lerobot.scripts.lerobot_info".to_string(),
                    attribute: "main".to_string(),
                },
                ConsoleEntryPoint {
                    name: "robotcloud-nested".to_string(),
                    module: "robotcloud.cli".to_string(),
                    attribute: "commands.main".to_string(),
                },
            ]
        );

        let shim = console_shim_content(&entries[0]);
        assert!(shim.contains("%ROBOTCLOUD_LEROBOT_ENV%\\python.exe"));
        assert!(shim.contains("lerobot.scripts.lerobot_info"));
        assert!(!shim.contains("C:\\"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_console_shims_are_generated_once_after_marker() {
        let base = env::temp_dir().join(format!("robotcloud-runtime-test-{}", Uuid::new_v4()));
        let runtime = base.join("lerobot-env");
        let dist_info = runtime
            .join("Lib")
            .join("site-packages")
            .join("lerobot-0.0.0.dist-info");
        fs::create_dir_all(&dist_info).unwrap();
        fs::write(
            dist_info.join("entry_points.txt"),
            "[console_scripts]\nlerobot-info = lerobot.scripts.lerobot_info:main\n",
        )
        .unwrap();

        let mut progress_count = 0_u32;
        ensure_windows_console_shims(&runtime, &mut |_event| {
            progress_count += 1;
        })
        .unwrap();

        let shim = runtime.join("robotcloud-shims").join("lerobot-info.cmd");
        assert!(shim.exists());
        assert!(windows_shims_are_ready(&runtime));
        assert!(progress_count > 0);

        fs::write(
            dist_info.join("entry_points.txt"),
            "[console_scripts]\nlerobot-info = lerobot.scripts.lerobot_info:main\nnew-tool = lerobot.scripts.new_tool:main\n",
        )
        .unwrap();
        progress_count = 0;
        ensure_windows_console_shims(&runtime, &mut |_event| {
            progress_count += 1;
        })
        .unwrap();

        assert_eq!(progress_count, 0);
        assert!(!runtime
            .join("robotcloud-shims")
            .join("new-tool.cmd")
            .exists());

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn action_allowlist_matches_so101_surface() {
        for action in [
            "info",
            "ports",
            "find-port",
            "cameras",
            "setup-follower",
            "setup-leader",
            "calibrate-follower",
            "calibrate-leader",
            "teleop",
            "record-reset-pose",
            "record-auto",
            "record",
        ] {
            assert!(allowed_action(action), "{action} should be allowed");
        }
        assert!(!allowed_action("shell"));
        assert!(!allowed_action("info; whoami"));
    }

    #[test]
    fn rejects_unknown_so101_actions_before_spawn() {
        let error = test_so101_command_args(&test_config("info; whoami"))
            .expect_err("unsafe actions must be rejected");
        assert!(error.contains("Unsupported SO101 action"));
    }

    #[test]
    fn builds_info_command_directly() {
        let (program, args) = test_so101_command_args(&test_config("info")).unwrap();

        assert_eq!(program, "python");
        assert_eq!(
            args,
            vec!["-m".to_string(), "lerobot.scripts.lerobot_info".to_string()]
        );
    }

    #[test]
    fn builds_record_command_without_so101_wrapper_script() {
        let mut config = test_config("record");
        config.follower_port = Some("/dev/cu.usbmodem-follower".to_string());
        config.leader_port = Some("/dev/cu.usbmodem-leader".to_string());
        config.robot_id = Some("robot-one".to_string());
        config.teleop_id = Some("leader-one".to_string());
        config.dataset_repo_id = Some("local/so101_desktop".to_string());
        config.task = Some("Pick the cube".to_string());

        let (program, args) = test_so101_command_args(&config).unwrap();

        assert_eq!(program, "python");
        assert_eq!(args[0], "-m");
        assert_eq!(args[1], "lerobot.scripts.lerobot_record");
        assert!(args.iter().any(|arg| arg == "--robot.type=so101_follower"));
        assert!(args
            .iter()
            .any(|arg| arg == "--robot.port=/dev/cu.usbmodem-follower"));
        assert!(args
            .iter()
            .any(|arg| arg == "--dataset.repo_id=local/so101_desktop"));
        assert!(args.iter().all(|arg| !arg.contains("so101.sh")));
        assert!(args.iter().all(|arg| !arg.contains("so101.ps1")));
        assert!(args.iter().all(|arg| arg != "--action"));
    }

    #[test]
    fn builds_robotcloud_python_actions_directly() {
        let mut config = test_config("record-reset-pose");
        config.follower_port = Some("/dev/cu.usbmodem-follower".to_string());
        config.leader_port = Some("/dev/cu.usbmodem-leader".to_string());

        let (program, args) = test_so101_command_args(&config).unwrap();

        assert_eq!(program, "python");
        assert!(args
            .first()
            .is_some_and(|arg| arg.ends_with("robotcloud_reset_pose.py")));
        assert!(args.iter().any(|arg| arg == "--robot.type=so101_follower"));
        assert!(args.iter().all(|arg| !arg.contains("so101.sh")));
        assert!(args.iter().all(|arg| !arg.contains("so101.ps1")));
    }

    #[test]
    fn inspects_lerobot_dataset_metadata() {
        let base = env::temp_dir().join(format!("robotcloud-dataset-test-{}", Uuid::new_v4()));
        let source = base.join("datasets").join("local").join("so101");
        fs::create_dir_all(source.join("meta")).unwrap();
        fs::create_dir_all(source.join("data").join("chunk-000")).unwrap();
        fs::write(
            source.join("meta").join("info.json"),
            r#"{"total_episodes":1,"total_frames":300,"fps":30}"#,
        )
        .unwrap();
        fs::write(
            source
                .join("data")
                .join("chunk-000")
                .join("episode_000000.parquet"),
            b"episode",
        )
        .unwrap();

        let inspection = inspect_dataset_upload_source(&source).unwrap();

        assert_eq!(inspection.file_count, 2);
        assert_eq!(inspection.episode_count, 1);
        assert_eq!(inspection.total_frames, Some(300));
        assert_eq!(inspection.fps, Some(30.0));
        assert_eq!(inspection.duration_seconds, Some(10.0));

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn falls_back_to_episode_parquet_count_without_metadata() {
        let base = env::temp_dir().join(format!("robotcloud-dataset-test-{}", Uuid::new_v4()));
        let source = base.join("datasets").join("local").join("so101");
        fs::create_dir_all(source.join("data").join("chunk-000")).unwrap();
        fs::write(
            source
                .join("data")
                .join("chunk-000")
                .join("episode_000000.parquet"),
            b"episode",
        )
        .unwrap();

        let inspection = inspect_dataset_upload_source(&source).unwrap();

        assert_eq!(inspection.file_count, 1);
        assert_eq!(inspection.episode_count, 1);
        assert_eq!(inspection.duration_seconds, None);

        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn rejects_invalid_dataset_upload_inspection() {
        let valid = DatasetUploadInspection {
            dataset_root: "/tmp/dataset".to_string(),
            file_count: 2,
            total_bytes: 2048,
            episode_count: 1,
            total_frames: Some(30),
            fps: Some(30.0),
            duration_seconds: Some(1.0),
        };
        assert!(validate_dataset_upload_inspection(&valid).is_ok());

        let no_episodes = DatasetUploadInspection {
            episode_count: 0,
            ..valid.clone()
        };
        let error = validate_dataset_upload_inspection(&no_episodes).unwrap_err();
        assert!(error.contains("At least 1 recorded episode is required."));

        let short_duration = DatasetUploadInspection {
            duration_seconds: Some(0.5),
            ..valid.clone()
        };
        let error = validate_dataset_upload_inspection(&short_duration).unwrap_err();
        assert!(error.contains("Recording duration must be at least 1s."));

        let unknown_duration = DatasetUploadInspection {
            duration_seconds: None,
            ..valid
        };
        let error = validate_dataset_upload_inspection(&unknown_duration).unwrap_err();
        assert!(error.contains("Recording duration could not be read from meta/info.json."));
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
    fn terminal_startup_script_restores_runtime_path_after_login_shell() {
        let script = std::str::from_utf8(terminal_startup_script()).unwrap();

        assert!(script.contains("unset PYTHONHOME PYTHONPATH"));
        assert!(script.contains("export PATH=\"$ROBOTCLOUD_LEROBOT_ENV/bin:$PATH\""));
        assert!(script.contains("export PYTHONNOUSERSITE=1"));
        assert!(script.contains("hash -r"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn terminal_startup_script_prefers_windows_runtime_shims() {
        let script = std::str::from_utf8(terminal_startup_script()).unwrap();

        assert!(script.contains("Remove-Item Env:PYTHONHOME,Env:PYTHONPATH"));
        assert!(script.contains(
            "$env:ROBOTCLOUD_LEROBOT_ENV\\robotcloud-shims;$env:ROBOTCLOUD_LEROBOT_ENV\\Scripts"
        ));
        assert!(script.contains("$env:PYTHONNOUSERSITE = \"1\""));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_runtime_entrypoint_uses_lerobot_python_module() {
        let base = env::temp_dir().join(format!("robotcloud-runtime-test-{}", Uuid::new_v4()));
        let runtime = base.join("lerobot-env");
        let module_dir = runtime
            .join("Lib")
            .join("site-packages")
            .join("lerobot")
            .join("scripts");
        fs::create_dir_all(&module_dir).unwrap();
        fs::write(runtime.join("python.exe"), b"python").unwrap();
        fs::write(module_dir.join("lerobot_info.py"), b"def main(): pass\n").unwrap();

        assert!(runtime_has_basic_entrypoints(&runtime));
        assert!(runtime_entrypoint_validation_error(&runtime).is_none());

        fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn accepts_lerobot_info_entrypoint_regardless_of_shebang() {
        // Actions run `python -m lerobot.scripts.*`, so a plain pip console script
        // (non-relocatable shebang) is fine as long as the entrypoint file exists.
        let base = env::temp_dir().join(format!("robotcloud-runtime-test-{}", Uuid::new_v4()));
        let runtime = base.join("lerobot-env");
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::write(
            runtime.join("bin").join("lerobot-info"),
            b"#!/usr/bin/env python\nfrom lerobot.scripts.lerobot_info import main\n",
        )
        .unwrap();

        assert!(runtime_entrypoint_validation_error(&runtime).is_none());

        fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_missing_lerobot_info_entrypoint() {
        let base = env::temp_dir().join(format!("robotcloud-runtime-test-{}", Uuid::new_v4()));
        let runtime = base.join("lerobot-env");
        fs::create_dir_all(runtime.join("bin")).unwrap();

        let error = runtime_entrypoint_validation_error(&runtime).unwrap();
        assert!(error.contains("missing lerobot-info"));

        fs::remove_dir_all(&base).unwrap();
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

    #[cfg(target_os = "windows")]
    #[test]
    fn command_path_prefers_windows_runtime_shims() {
        let runtime = Path::new("C:\\robotcloud-runtime");
        let path = build_command_path(
            runtime,
            Some(std::ffi::OsString::from(
                "C:\\Windows\\System32;C:\\Windows",
            )),
        )
        .unwrap();
        let parts = env::split_paths(&std::ffi::OsString::from(path)).collect::<Vec<_>>();

        assert_eq!(parts[0], runtime.join("robotcloud-shims"));
        assert_eq!(parts[1], runtime.join("Scripts"));
        assert_eq!(parts[2], runtime.join("Library").join("bin"));
        assert_eq!(parts[3], runtime);
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

        let mut progress = |_event: RuntimeProgressEvent| {};
        extract_runtime_archive(&archive_path, &target, &mut progress).unwrap();

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
