from __future__ import annotations

import os
import socket
from dataclasses import dataclass
from pathlib import Path


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in {"0", "false", "no", "off"}


def _list_env(name: str) -> tuple[str, ...]:
    raw = os.getenv(name, "")
    return tuple(item.strip() for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class AgentConfig:
    """Configuration values for the GPU agent."""

    backend_base_url: str
    node_name: str
    report_ip: str
    listen_host: str
    api_port: int
    public_base_url: str
    upload_enabled: bool
    upload_allowed_origins: tuple[str, ...]
    gpu_total: int
    heartbeat_interval: int
    version: str
    step_delay: float
    log_dir: Path
    work_dir: Path
    dataset_cache_dir: Path

    @classmethod
    def from_env(cls) -> "AgentConfig":
        backend_base = os.getenv("SCHEDULER_API_BASE_URL", "http://localhost:8000/api/v1").rstrip("/")
        node_name = os.getenv("AGENT_NODE_NAME", socket.gethostname())
        report_ip = os.getenv("AGENT_IP", "127.0.0.1")
        listen_host = os.getenv("AGENT_LISTEN_HOST", "0.0.0.0")
        api_port = _int_env("AGENT_PORT", 5000)
        public_base_url = os.getenv("AGENT_PUBLIC_BASE_URL", "").strip().rstrip("/")
        upload_enabled = _bool_env("AGENT_UPLOAD_ENABLED", True)
        upload_allowed_origins = _list_env("AGENT_UPLOAD_ALLOWED_ORIGINS")
        gpu_total = max(_int_env("AGENT_GPU_TOTAL", 1), 1)
        heartbeat_interval = max(_int_env("AGENT_HEARTBEAT_INTERVAL", 30), 5)
        version = os.getenv("AGENT_VERSION", "1.0.0")
        step_delay = max(_float_env("AGENT_STEP_DELAY", 0.5), 0.1)
        backend_root = Path(__file__).resolve().parents[1]
        repo_root = backend_root.parent
        log_dir = Path(os.getenv("AGENT_LOG_DIR", backend_root / "storage" / "train_logs")).expanduser().resolve()
        work_dir = Path(os.getenv("AGENT_WORK_DIR", repo_root)).expanduser().resolve()
        dataset_cache_dir = Path(os.getenv("AGENT_DATASET_DIR", backend_root / "storage" / "datasets_cache")).expanduser().resolve()
        return cls(
            backend_base_url=backend_base,
            node_name=node_name,
            report_ip=report_ip,
            listen_host=listen_host,
            api_port=api_port,
            public_base_url=public_base_url,
            upload_enabled=upload_enabled,
            upload_allowed_origins=upload_allowed_origins,
            gpu_total=gpu_total,
            heartbeat_interval=heartbeat_interval,
            version=version,
            step_delay=step_delay,
            log_dir=log_dir,
            work_dir=work_dir,
            dataset_cache_dir=dataset_cache_dir,
        )
