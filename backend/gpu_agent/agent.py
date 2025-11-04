from __future__ import annotations

import json
import logging
import random
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, List, Optional

import requests

from .config import AgentConfig


class AgentHTTPRequestHandler(BaseHTTPRequestHandler):
    """HTTP handler that receives run commands from Scheduler."""

    server: "AgentHTTPServer"

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/v1/agent/run":
            self.send_error(404, "Not Found")
            return
        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON payload")
            return
        token = self.headers.get("X-Agent-Token", "")
        if not self.server.agent.validate_scheduler_token(token):
            self.send_error(401, "Invalid scheduler token")
            return
        try:
            result = self.server.agent.enqueue_task(payload)
        except ValueError as exc:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"detail": str(exc)}).encode("utf-8"))
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode("utf-8"))

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        """Silence default HTTP server logging."""
        self.server.agent.logger.debug("AgentHTTP: " + format, *args)


class AgentHTTPServer(ThreadingHTTPServer):
    """HTTP server carrying a reference to the Agent."""

    def __init__(self, server_address, RequestHandlerClass, agent: "Agent") -> None:
        super().__init__(server_address, RequestHandlerClass)
        self.agent = agent


class TrainingJob(threading.Thread):
    """Background worker that simulates a training job."""

    def __init__(
        self,
        agent: "Agent",
        task_id: int,
        gpus: List[int],
        params: Dict,
        dataset_path: str,
        cmd: str,
    ) -> None:
        super().__init__(daemon=True)
        self.agent = agent
        self.task_id = task_id
        self.gpus = gpus
        self.params = params or {}
        self.dataset_path = dataset_path
        self.cmd = cmd
        self._stopping = threading.Event()
        self.logger = agent.logger.getChild(f"job-{task_id}")

    def stop(self) -> None:
        self._stopping.set()

    def run(self) -> None:  # noqa: D401
        """Simulate an iterative training loop and report status."""
        try:
            self.logger.info("Starting training task %s (cmd=%s, gpus=%s)", self.task_id, self.cmd, self.gpus)
            self.agent.notify_status(self.task_id, "running", 0.0, metrics={"dataset_path": self.dataset_path})
            epochs = max(int(self.params.get("epochs", 10)), 1)
            delay = self.agent.config.step_delay
            for step in range(epochs):
                if self._stopping.wait(delay):
                    self.logger.warning("Training task %s interrupted", self.task_id)
                    self.agent.notify_status(self.task_id, "failed", step / epochs, metrics={"reason": "stopped"})
                    return
                progress = (step + 1) / epochs
                loss = round(max(0.01, 1.0 - progress) + random.uniform(-0.02, 0.02), 4)
                self.agent.notify_status(
                    self.task_id,
                    "running",
                    progress,
                    metrics={"loss": loss, "epoch": step + 1, "epochs": epochs},
                )
            self.agent.notify_status(self.task_id, "completed", 1.0, metrics={"loss": max(loss, 0.01)})
            self.logger.info("Training task %s completed", self.task_id)
        except Exception as exc:  # pragma: no cover - defensive guard
            self.logger.exception("Training task %s crashed: %s", self.task_id, exc)
            self.agent.notify_status(self.task_id, "failed", 0.0, metrics={"error": str(exc)})
        finally:
            self.agent.finish_job(self.task_id)


class Agent:
    """RobotCloud GPU agent implementation."""

    def __init__(self, config: AgentConfig, session: Optional[requests.Session] = None) -> None:
        self.config = config
        self.logger = logging.getLogger("robotcloud.gpu_agent")
        self.session = session or requests.Session()
        self.agent_token: Optional[str] = None
        self._jobs: Dict[int, TrainingJob] = {}
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._heartbeat_thread: Optional[threading.Thread] = None

    def start(self) -> None:
        """Register with scheduler, start heartbeat loop and HTTP server."""
        self.logger.info("Starting GPU agent for node '%s' on port %s", self.config.node_name, self.config.api_port)
        self._register_with_scheduler()
        self._start_heartbeat()
        try:
            self._serve_http()
        except KeyboardInterrupt:  # pragma: no cover - manual interrupt
            self.logger.info("Agent interrupted by user, shutting down...")
        finally:
            self.stop()

    def stop(self) -> None:
        """Signal background threads to finish."""
        self._stop_event.set()
        with self._lock:
            jobs = list(self._jobs.values())
        for job in jobs:
            job.stop()
        if self._heartbeat_thread:
            self._heartbeat_thread.join(timeout=2)
        self.logger.info("Agent stopped.")

    # -------------------- Scheduler integration --------------------
    def _register_with_scheduler(self) -> None:
        payload = {
            "node_name": self.config.node_name,
            "ip": self.config.report_ip,
            "gpu_total": self.config.gpu_total,
            "version": self.config.version,
            "port": self.config.api_port,
        }
        url = f"{self.config.backend_base_url}/internal/agent/register"
        while not self._stop_event.is_set():
            try:
                response = self.session.post(url, json=payload, timeout=5)
                response.raise_for_status()
                body = response.json()
                data = body.get("data") if isinstance(body, dict) else None
                if not isinstance(data, dict):
                    raise ValueError("Unexpected response body")
                token = data.get("token")
                if not token:
                    raise ValueError("Missing agent token in response")
                self.agent_token = token
                gpu_total = data.get("gpu_total")
                if isinstance(gpu_total, int) and gpu_total > 0:
                    self.config = AgentConfig(
                        backend_base_url=self.config.backend_base_url,
                        node_name=self.config.node_name,
                        report_ip=self.config.report_ip,
                        listen_host=self.config.listen_host,
                        api_port=self.config.api_port,
                        gpu_total=gpu_total,
                        heartbeat_interval=self.config.heartbeat_interval,
                        version=self.config.version,
                        step_delay=self.config.step_delay,
                    )
                self.logger.info("Agent registered with scheduler (token=%s)", self.agent_token[:8])
                return
            except Exception as exc:
                self.logger.error("Failed to register agent: %s", exc)
                time.sleep(5)

    def _start_heartbeat(self) -> None:
        self._heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self._heartbeat_thread.start()

    def _heartbeat_loop(self) -> None:
        while not self._stop_event.wait(self.config.heartbeat_interval):
            if not self.agent_token:
                continue
            busy = self._busy_gpu_indices()
            free = [idx for idx in range(self.config.gpu_total) if idx not in busy]
            payload = {
                "gpu_total": self.config.gpu_total,
                "gpu_free": free,
                "gpu_busy": busy,
                "version": self.config.version,
            }
            url = f"{self.config.backend_base_url}/internal/agent/heartbeat"
            headers = {
                "Content-Type": "application/json",
                "X-Agent-Token": self.agent_token,
            }
            try:
                response = self.session.post(url, json=payload, headers=headers, timeout=5)
                response.raise_for_status()
            except Exception as exc:  # pragma: no cover - network issues
                self.logger.warning("Heartbeat failed: %s", exc)

    def notify_status(self, task_id: int, status: str, progress: float, metrics: Optional[Dict] = None) -> None:
        if not self.agent_token:
            return
        payload = {
            "task_id": task_id,
            "status": status,
            "progress": round(progress, 4),
            "metrics": metrics or {},
        }
        url = f"{self.config.backend_base_url}/internal/training/update"
        headers = {
            "Content-Type": "application/json",
            "X-Agent-Token": self.agent_token,
        }
        try:
            response = self.session.post(url, json=payload, headers=headers, timeout=5)
            response.raise_for_status()
        except Exception as exc:
            self.logger.warning("Failed to report status for task %s: %s", task_id, exc)

    # -------------------- HTTP server helpers --------------------
    def _serve_http(self) -> None:
        server = AgentHTTPServer((self.config.listen_host, self.config.api_port), AgentHTTPRequestHandler, self)
        self.logger.info("Agent HTTP server listening on %s:%s", self.config.listen_host, self.config.api_port)
        try:
            server.serve_forever()
        finally:
            server.server_close()

    def validate_scheduler_token(self, incoming: str) -> bool:
        return bool(self.agent_token) and incoming == self.agent_token

    def enqueue_task(self, payload: Dict) -> Dict[str, str]:
        task_id = payload.get("task_id")
        if task_id is None:
            raise ValueError("task_id required")
        try:
            task_id = int(task_id)
        except (TypeError, ValueError) as exc:
            raise ValueError("task_id must be an integer") from exc
        gpus_raw = payload.get("gpus") or []
        gpus: List[int] = []
        for g in gpus_raw:
            try:
                gpus.append(int(g))
            except (TypeError, ValueError):
                continue
        if not gpus:
            gpus = [0]
        params = payload.get("params") or {}
        dataset_path = payload.get("dataset_path", "")
        cmd = payload.get("cmd", "python train.py")
        with self._lock:
            if task_id in self._jobs:
                self.logger.info("Task %s already running, acknowledging duplicate dispatch", task_id)
                return {"status": "accepted", "detail": "already running"}
            job = TrainingJob(self, task_id, gpus, params, dataset_path, cmd)
            self._jobs[task_id] = job
        job.start()
        return {"status": "accepted"}

    def finish_job(self, task_id: int) -> None:
        with self._lock:
            self._jobs.pop(task_id, None)

    def _busy_gpu_indices(self) -> List[int]:
        with self._lock:
            indices: List[int] = []
            for job in self._jobs.values():
                indices.extend(job.gpus)
        return sorted(set(indices))
