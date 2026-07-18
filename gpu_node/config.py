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
    inference_public_host: str
    listen_host: str
    api_port: int
    public_base_url: str
    upload_enabled: bool
    upload_allowed_origins: tuple[str, ...]
    gpu_total: int
    gpu_slot_total: int
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
        inference_public_host = os.getenv("AGENT_INFERENCE_PUBLIC_HOST", report_ip).strip() or report_ip
        listen_host = os.getenv("AGENT_LISTEN_HOST", "0.0.0.0")
        api_port = _int_env("AGENT_PORT", 5000)
        public_base_url = os.getenv("AGENT_PUBLIC_BASE_URL", "").strip().rstrip("/")
        upload_enabled = _bool_env("AGENT_UPLOAD_ENABLED", True)
        upload_allowed_origins = _list_env("AGENT_UPLOAD_ALLOWED_ORIGINS")
        gpu_total = max(_int_env("AGENT_GPU_TOTAL", 1), 1)
        slots_per_gpu = max(_int_env("AGENT_GPU_SLOTS_PER_GPU", 1), 1)
        gpu_slot_total = max(_int_env("AGENT_GPU_SLOT_TOTAL", gpu_total * slots_per_gpu), gpu_total)
        heartbeat_interval = max(_int_env("AGENT_HEARTBEAT_INTERVAL", 30), 5)
        version = os.getenv("AGENT_VERSION", "1.0.0")
        step_delay = max(_float_env("AGENT_STEP_DELAY", 0.5), 0.1)
        # gpu_node 已从 backend 解耦并移到项目根目录：
        #   __file__ = <repo_root>/gpu_node/config.py
        #   repo_root    -> 项目根目录（work_dir 默认值，供 scripts/lerobot-*.sh 使用）
        #   storage_root -> gpu_node/storage（本节点自带的日志/数据集缓存，不再落在 backend 下）
        repo_root = Path(__file__).resolve().parents[1]
        storage_root = Path(__file__).resolve().parent / "storage"
        log_dir = Path(os.getenv("AGENT_LOG_DIR", storage_root / "train_logs")).expanduser().resolve()
        work_dir = Path(os.getenv("AGENT_WORK_DIR", repo_root)).expanduser().resolve()
        dataset_cache_dir = Path(os.getenv("AGENT_DATASET_DIR", storage_root / "datasets_cache")).expanduser().resolve()
        return cls(
            backend_base_url=backend_base,
            node_name=node_name,
            report_ip=report_ip,
            inference_public_host=inference_public_host,
            listen_host=listen_host,
            api_port=api_port,
            public_base_url=public_base_url,
            upload_enabled=upload_enabled,
            upload_allowed_origins=upload_allowed_origins,
            gpu_total=gpu_total,
            gpu_slot_total=gpu_slot_total,
            heartbeat_interval=heartbeat_interval,
            version=version,
            step_delay=step_delay,
            log_dir=log_dir,
            work_dir=work_dir,
            dataset_cache_dir=dataset_cache_dir,
        )
