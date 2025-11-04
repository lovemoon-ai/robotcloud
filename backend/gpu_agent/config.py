from __future__ import annotations

import os
import socket
from dataclasses import dataclass


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


@dataclass(frozen=True)
class AgentConfig:
    """Configuration values for the GPU agent."""

    backend_base_url: str
    node_name: str
    report_ip: str
    listen_host: str
    api_port: int
    gpu_total: int
    heartbeat_interval: int
    version: str
    step_delay: float

    @classmethod
    def from_env(cls) -> "AgentConfig":
        backend_base = os.getenv("SCHEDULER_API_BASE_URL", "http://localhost:8000/api/v1").rstrip("/")
        node_name = os.getenv("AGENT_NODE_NAME", socket.gethostname())
        report_ip = os.getenv("AGENT_IP", "127.0.0.1")
        listen_host = os.getenv("AGENT_LISTEN_HOST", "0.0.0.0")
        api_port = _int_env("AGENT_PORT", 5000)
        gpu_total = max(_int_env("AGENT_GPU_TOTAL", 1), 1)
        heartbeat_interval = max(_int_env("AGENT_HEARTBEAT_INTERVAL", 30), 5)
        version = os.getenv("AGENT_VERSION", "1.0.0")
        step_delay = max(_float_env("AGENT_STEP_DELAY", 0.5), 0.1)
        return cls(
            backend_base_url=backend_base,
            node_name=node_name,
            report_ip=report_ip,
            listen_host=listen_host,
            api_port=api_port,
            gpu_total=gpu_total,
            heartbeat_interval=heartbeat_interval,
            version=version,
            step_delay=step_delay,
        )
