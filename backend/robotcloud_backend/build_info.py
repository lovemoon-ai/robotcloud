"""Build metadata helpers for the RobotCloud backend."""
from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Dict


UNKNOWN = "unknown"
DEFAULT_BACKEND_VERSION = "0.1.0"


def _first_env(*names: str) -> str:
    for name in names:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return ""


def _package_version() -> str:
    try:
        return version("robotcloud-backend")
    except PackageNotFoundError:
        return DEFAULT_BACKEND_VERSION


def _git_commit() -> str:
    repo_root = Path(__file__).resolve().parents[2]
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=repo_root,
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return UNKNOWN


def _build_time_from_env() -> str:
    explicit = _first_env(
        "ROBOTCLOUD_BACKEND_BUILD_TIME",
        "ROBOTCLOUD_BUILD_TIME",
        "BUILD_TIME",
    )
    if explicit:
        return explicit

    source_date_epoch = os.getenv("SOURCE_DATE_EPOCH", "").strip()
    if source_date_epoch:
        try:
            return datetime.fromtimestamp(int(source_date_epoch), timezone.utc).isoformat().replace("+00:00", "Z")
        except ValueError:
            return source_date_epoch

    return UNKNOWN


def get_backend_build_info() -> Dict[str, Any]:
    """Return backend build metadata as API data."""
    version_value = _first_env("ROBOTCLOUD_BACKEND_VERSION", "ROBOTCLOUD_VERSION") or _package_version()
    build_commit = _first_env(
        "ROBOTCLOUD_BACKEND_BUILD_COMMIT",
        "ROBOTCLOUD_BUILD_COMMIT",
        "GIT_COMMIT",
        "COMMIT_SHA",
        "VERCEL_GIT_COMMIT_SHA",
    ) or _git_commit()
    build_time = _build_time_from_env()

    return {
        "version": version_value or UNKNOWN,
        "build_commit": build_commit or UNKNOWN,
        "build_time": build_time or UNKNOWN,
    }
