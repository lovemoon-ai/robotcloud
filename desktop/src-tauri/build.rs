use std::env;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn first_env(names: &[&str]) -> Option<String> {
    names.iter().find_map(|name| {
        env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn git_commit() -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn utc_now() -> String {
    let command_output = if cfg!(target_os = "windows") {
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "[DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')",
            ])
            .output()
    } else {
        Command::new("date")
            .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
            .output()
    };

    if let Ok(output) = command_output {
        if output.status.success() {
            if let Ok(value) = String::from_utf8(output.stdout) {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }

    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    seconds.to_string()
}

fn main() {
    println!("cargo:rerun-if-env-changed=ROBOTCLOUD_APP_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=ROBOTCLOUD_BUILD_COMMIT");
    println!("cargo:rerun-if-env-changed=GIT_COMMIT");
    println!("cargo:rerun-if-env-changed=COMMIT_SHA");
    println!("cargo:rerun-if-env-changed=ROBOTCLOUD_APP_BUILD_TIME");
    println!("cargo:rerun-if-env-changed=ROBOTCLOUD_BUILD_TIME");
    println!("cargo:rerun-if-env-changed=BUILD_TIME");

    let commit = first_env(&[
        "ROBOTCLOUD_APP_BUILD_COMMIT",
        "ROBOTCLOUD_BUILD_COMMIT",
        "GIT_COMMIT",
        "COMMIT_SHA",
    ])
    .or_else(git_commit)
    .unwrap_or_else(|| "unknown".to_string());
    let build_time = first_env(&[
        "ROBOTCLOUD_APP_BUILD_TIME",
        "ROBOTCLOUD_BUILD_TIME",
        "BUILD_TIME",
    ])
    .unwrap_or_else(utc_now);

    println!("cargo:rustc-env=ROBOTCLOUD_APP_BUILD_COMMIT={commit}");
    println!("cargo:rustc-env=ROBOTCLOUD_APP_BUILD_TIME={build_time}");
    tauri_build::build();
}
