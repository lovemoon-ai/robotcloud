from __future__ import annotations

import json
import logging
import os
import re
import shlex
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
import tarfile
import zipfile
from urllib.parse import urlparse, parse_qs

from .config import AgentConfig


class AgentHTTPRequestHandler(BaseHTTPRequestHandler):
    """HTTP handler that receives run commands from Scheduler."""

    server: "AgentHTTPServer"

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        token = self.headers.get("X-Agent-Token", "")
        if not self.server.agent.validate_scheduler_token(token):
            self.send_error(401, "Invalid scheduler token")
            return
        # Upload dataset package
        if parsed.path == "/api/v1/agent/upload":
            self._handle_upload(parsed)
            return
        # Enqueue training run
        if parsed.path != "/api/v1/agent/run":
            self.send_error(404, "Not Found")
            return
        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON payload")
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

    def do_GET(self) -> None:  # noqa: N802
        # Lightweight log chunk endpoint for scheduler/backend proxy.
        # GET /api/v1/agent/logs?task_id=123&offset=0&limit=65536
        from urllib.parse import urlparse, parse_qs

        parsed = urlparse(self.path)
        if parsed.path != "/api/v1/agent/logs":
            self.send_error(404, "Not Found")
            return
        token = self.headers.get("X-Agent-Token", "")
        if not self.server.agent.validate_scheduler_token(token):
            self.send_error(401, "Invalid scheduler token")
            return
        qs = parse_qs(parsed.query or "")
        task_id_raw = (qs.get("task_id") or [None])[0]
        if task_id_raw is None:
            self.send_error(400, "task_id required")
            return
        try:
            task_id = int(task_id_raw)
        except (TypeError, ValueError):
            self.send_error(400, "task_id must be an integer")
            return
        try:
            offset = int((qs.get("offset") or ["0"])[0])
        except (TypeError, ValueError):
            offset = 0
        try:
            limit = int((qs.get("limit") or ["65536"])[0])
        except (TypeError, ValueError):
            limit = 65536
        if limit <= 0:
            limit = 65536

        content, next_offset, complete = self.server.agent.read_log_chunk(task_id, offset, limit)
        body = {"content": content, "next_offset": next_offset, "complete": complete}
        payload = json.dumps(body).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        """Silence default HTTP server logging."""
        self.server.agent.logger.debug("AgentHTTP: " + format, *args)

    # -------------------- Upload handling --------------------
    def _handle_upload(self, parsed) -> None:
        qs = parse_qs(parsed.query or "")
        task_id_raw = (qs.get("task_id") or [None])[0]
        if task_id_raw is None:
            self.send_error(400, "task_id required")
            return
        try:
            task_id = int(task_id_raw)
        except (TypeError, ValueError):
            self.send_error(400, "task_id must be an integer")
            return
        filename = (qs.get("filename") or [None])[0] or self.headers.get("X-Filename", "dataset.zip")

        # Read body (possibly large); prefer chunked reading
        try:
            content_length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            content_length = 0
        try:
            target_dir = self.server.agent.dataset_dir(task_id)
            target_dir.mkdir(parents=True, exist_ok=True)
            dest = target_dir / filename
            with dest.open("wb") as f:
                remaining = content_length
                chunk_size = 1024 * 1024
                if remaining <= 0:
                    # No content-length; read until EOF
                    while True:
                        chunk = self.rfile.read(chunk_size)
                        if not chunk:
                            break
                        f.write(chunk)
                else:
                    while remaining > 0:
                        chunk = self.rfile.read(min(chunk_size, remaining))
                        if not chunk:
                            break
                        f.write(chunk)
                        remaining -= len(chunk)
        except OSError as exc:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"detail": f"Failed to write file: {exc}"}).encode("utf-8"))
            return
        body = json.dumps({"status": "ok", "path": str(dest)}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class AgentHTTPServer(ThreadingHTTPServer):
    """HTTP server carrying a reference to the Agent."""

    def __init__(self, server_address, RequestHandlerClass, agent: "Agent") -> None:
        super().__init__(server_address, RequestHandlerClass)
        self.agent = agent


class TrainingJob(threading.Thread):
    """Execute a training script and stream its logs back to the backend."""

    DEFAULT_CMD = "python train.py"
    PROGRESS_TOKEN_RE = re.compile(r"progress\s*[:=]\s*(\d+(?:\.\d+)?)(%?)", re.IGNORECASE)
    STEP_PROGRESS_RE = re.compile(r"(epoch|step|iter(?:ation)?|batch)\s+(\d+)\s*/\s*(\d+)", re.IGNORECASE)
    PERCENT_BAR_RE = re.compile(r"(?<!\d)(\d{1,3}(?:\.\d+)?)%")
    METRIC_PATTERNS = [
        ("loss", re.compile(r"loss(?:[_\w]*)\s*[:=]\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)", re.IGNORECASE)),
        ("lr", re.compile(r"(?:lr|learning[_ ]?rate)\s*[:=]\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)", re.IGNORECASE)),
        ("accuracy", re.compile(r"(?:acc|accuracy)\s*[:=]\s*(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)", re.IGNORECASE)),
    ]

    def __init__(
        self,
        agent: "Agent",
        task_id: int,
        gpus: List[int],
        params: Dict,
        dataset_path: str,
        cmd: str,
        log_dir: Path,
        work_dir: Path,
    ) -> None:
        super().__init__(daemon=True)
        self.agent = agent
        self.task_id = task_id
        self.gpus = gpus
        self.params = dict(params or {})
        self.dataset_path = dataset_path or ""
        self.cmd = (cmd or self.DEFAULT_CMD).strip() or self.DEFAULT_CMD
        self.log_dir = Path(log_dir)
        self.work_dir = Path(work_dir)
        self.log_path = self.log_dir / f"{self.task_id}.log"
        self.logger = agent.logger.getChild(f"job-{task_id}")
        self._stopping = threading.Event()
        self._process: Optional[subprocess.Popen[str]] = None
        self._script_aliases = self._build_script_aliases()
        self._last_progress = 0.0
        self._last_metrics: Dict[str, Any] = {}
        self._last_status = "queued"

    # ------------------------------------------------------------------ #
    def stop(self) -> None:
        self._stopping.set()
        self._terminate_process()

    def run(self) -> None:
        try:
            self._execute()
        except Exception as exc:  # pragma: no cover - defensive guard
            self.logger.exception("Training task %s crashed: %s", self.task_id, exc)
            self.agent.notify_status(self.task_id, "failed", self._last_progress, metrics={"error": str(exc)})
        finally:
            self.agent.finish_job(self.task_id)

    # ------------------------------------------------------------------ #
    def _execute(self) -> None:
        self.log_dir.mkdir(parents=True, exist_ok=True)
        # Prepare dataset (extract uploaded archive or given file) before running
        try:
            self._prepare_dataset()
        except Exception as exc:  # pragma: no cover - defensive
            self.logger.error("Failed to prepare dataset for task %s: %s", self.task_id, exc)
            self.agent.notify_status(
                self.task_id,
                "failed",
                self._last_progress,
                metrics={"error": f"dataset prep failed: {exc}"},
            )
            return
        command = self._build_command()
        env = self._build_env()
        formatted_cmd = self._format_command(command)
        self.logger.info(
            "Starting training task %s (gpus=%s, cmd=%s, log=%s)",
            self.task_id,
            self.gpus,
            formatted_cmd,
            self.log_path,
        )
        self.agent.notify_status(
            self.task_id,
            "running",
            0.0,
            metrics={"dataset_path": self.dataset_path, "command": command[0], "log_path": str(self.log_path)},
        )
        self._last_status = "running"
        exit_code = self._stream_process(command, env)
        if self._stopping.is_set():
            self.logger.warning("Training task %s stopped by scheduler", self.task_id)
            self.agent.notify_status(
                self.task_id,
                "failed",
                self._last_progress,
                metrics={"reason": "stopped", "log_path": str(self.log_path)},
            )
            return
        if exit_code == 0:
            if self._last_progress < 1.0:
                self._last_progress = 1.0
            self.logger.info("Training task %s completed (log=%s)", self.task_id, self.log_path)
            self.agent.notify_status(
                self.task_id,
                "completed",
                self._last_progress,
                metrics={"exit_code": exit_code, "log_path": str(self.log_path)},
            )
        else:
            self.logger.error("Training task %s failed with exit code %s", self.task_id, exit_code)
            self.agent.notify_status(
                self.task_id,
                "failed",
                self._last_progress,
                metrics={"exit_code": exit_code, "log_path": str(self.log_path)},
            )

    def _stream_process(self, command: List[str], env: Dict[str, str]) -> int:
        header = (
            f"[robotcloud] task={self.task_id} gpus={self.gpus} dataset_path={self.dataset_path or 'N/A'}\n"
            f"[robotcloud] command={self._format_command(command)}\n\n"
        )
        with self.log_path.open("w", encoding="utf-8") as log_file:
            log_file.write(header)
            log_file.flush()
            try:
                process = subprocess.Popen(
                    command,
                    cwd=str(self.work_dir),
                    env=env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    universal_newlines=True,
                )
            except FileNotFoundError as exc:
                raise FileNotFoundError(f"Executable not found for training command '{command[0]}'") from exc
            self._process = process
            assert process.stdout is not None
            try:
                for line in process.stdout:
                    log_file.write(line)
                    log_file.flush()
                    self._handle_output_line(line)
                    if self._stopping.is_set():
                        break
            finally:
                process.stdout.close()
            exit_code = process.wait()
            self._process = None
            return exit_code

    # -------------------- Command helpers --------------------
    def _build_command(self) -> List[str]:
        tokens = shlex.split(self.cmd)
        if not tokens:
            tokens = shlex.split(self.DEFAULT_CMD)
        tokens = self._resolve_executable(tokens)
        return tokens + self._build_param_args()

    def _resolve_executable(self, tokens: List[str]) -> List[str]:
        first = tokens[0]
        alias = self._script_aliases.get(first)
        if alias and alias.exists():
            tokens[0] = str(alias)
            return tokens
        path = Path(first)
        if not path.is_absolute():
            candidate = (self.work_dir / first).resolve()
            if candidate.exists():
                tokens[0] = str(candidate)
                return tokens
        elif path.exists():
            tokens[0] = str(path)
        return tokens

    def _build_param_args(self) -> List[str]:
        args: List[str] = []
        params_copy = dict(self.params)
        params_copy.pop("cmd", None)
        dataset_arg = str(params_copy.pop("dataset_arg", "")).strip()
        extra_args = params_copy.pop("extra_args", None)
        dataset_key = dataset_arg or "dataset_path"
        if self.dataset_path and dataset_key not in params_copy:
            args.extend(self._param_to_cli_tokens(dataset_key, self.dataset_path))
        for key, value in params_copy.items():
            args.extend(self._param_to_cli_tokens(key, value))
        if isinstance(extra_args, list):
            args.extend(str(item) for item in extra_args)
        return args

    def _param_to_cli_tokens(self, key: str, value: Any) -> List[str]:
        if value is None:
            return []
        arg_name = self._format_arg_name(key)
        serialized: Any = value
        if isinstance(value, bool):
            serialized = "true" if value else "false"
        elif isinstance(value, (list, dict)):
            serialized = json.dumps(value)
        # Use --key=value formatting for all parameters
        return [f"{arg_name}={str(serialized)}"]

    @staticmethod
    def _format_arg_name(key: str) -> str:
        stripped = key.strip()
        if stripped.startswith("--") or stripped.startswith("-"):
            return stripped
        # Keep original key as-is (including dots or underscores)
        return f"--{stripped}"

    def _build_env(self) -> Dict[str, str]:
        env = os.environ.copy()
        if self.gpus:
            env["CUDA_VISIBLE_DEVICES"] = ",".join(str(gpu) for gpu in self.gpus)
        env["TRAIN_TASK_ID"] = str(self.task_id)
        env["TRAINING_PARAMS"] = json.dumps(self.params)
        env["RC_TRAINING_CMD"] = self.cmd
        if self.dataset_path:
            env["RC_DATASET_PATH"] = self.dataset_path
        return env

    def _format_command(self, command: List[str]) -> str:
        return shlex.join(command)

    def _build_script_aliases(self) -> Dict[str, Path]:
        scripts_dir = self.work_dir / "scripts"
        aliases: Dict[str, Path] = {}
        lerobot = scripts_dir / "lerobot.sh"
        if lerobot.exists():
            aliases["lerobot"] = lerobot
            aliases["lerobot.sh"] = lerobot
        return aliases

    # -------------------- Dataset preparation --------------------
    def _prepare_dataset(self) -> None:
        """Ensure self.dataset_path points to a directory with extracted data.

        Priority order:
          1) If dataset_path is an existing directory, keep it.
          2) If dataset_path is a file archive, extract it.
          3) If not provided or not found, look under agent's dataset_dir(task_id)
             for an uploaded archive and extract it.
        """
        # 1) Already a directory
        if self.dataset_path:
            p = Path(self.dataset_path).expanduser()
            if p.is_dir():
                return
            if p.is_file():
                extracted = self._extract_archive(p.resolve())
                if extracted:
                    self.dataset_path = str(extracted)
                    return
        # 2) Try uploaded archive
        task_dir = self.agent.dataset_dir(self.task_id)
        if not task_dir.exists():
            return
        # Find any archive-like files
        for f in sorted(task_dir.iterdir()):
            if not f.is_file():
                continue
            extracted = self._extract_archive(f)
            if extracted:
                self.dataset_path = str(extracted)
                return

    def _extract_archive(self, file_path: Path) -> Optional[Path]:
        """Extract .zip/.tar(.gz)/.tgz archives to a 'data' dir next to file.

        Returns the extraction directory on success, or None if unsupported/failed.
        """
        suffixes = [s.lower() for s in file_path.suffixes]
        if not file_path.exists() or not suffixes:
            return None
        target_dir = file_path.parent / "data"
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        try:
            if suffixes[-1] == ".zip":
                with zipfile.ZipFile(file_path, "r") as zf:
                    zf.extractall(target_dir)
                return target_dir
            if ".tar" in suffixes or suffixes[-1] in {".gz", ".tgz"}:
                try:
                    with tarfile.open(file_path, "r:*") as tf:
                        tf.extractall(target_dir)
                    return target_dir
                except tarfile.TarError:
                    return None
        except (OSError, zipfile.BadZipFile):
            return None
        return None

    # -------------------- Log parsing --------------------
    def _handle_output_line(self, line: str) -> None:
        if not line.strip():
            return
        payload = self._parse_progress_payload(line)
        if not payload:
            return
        status = payload.get("status", "running")
        progress = payload.get("progress")
        metrics = payload.get("metrics", {})
        self._report_status(status, progress, metrics)

    def _report_status(self, status: str, progress: Optional[float], metrics: Dict[str, Any]) -> None:
        metrics = self._sanitize_metrics(metrics)
        should_send = False
        if progress is not None:
            normalized = max(0.0, min(1.0, progress))
            if abs(normalized - self._last_progress) >= 0.005:
                self._last_progress = normalized
                should_send = True
        if status != self._last_status:
            self._last_status = status
            should_send = True
        if metrics and metrics != self._last_metrics:
            self._last_metrics = metrics
            should_send = True
        if should_send:
            self.agent.notify_status(self.task_id, status, self._last_progress, metrics=metrics)

    def _parse_progress_payload(self, line: str) -> Optional[Dict[str, Any]]:
        text = line.strip()
        json_payload = self._extract_json(text)
        if json_payload:
            built = self._payload_from_json(json_payload)
            if built:
                return built
        match = self.PROGRESS_TOKEN_RE.search(text)
        if match:
            progress = self._normalize_progress(match.group(1), match.group(2) == "%")
            metrics = self._parse_metrics(text)
            return {"progress": progress, "metrics": metrics}
        match = self.STEP_PROGRESS_RE.search(text)
        if match:
            current = float(match.group(2))
            total = max(float(match.group(3)), 1.0)
            metrics = {"stage": match.group(1).lower(), **self._parse_metrics(text)}
            metrics["current_step"] = int(current)
            metrics["total_steps"] = int(total)
            return {"progress": current / total, "metrics": metrics}
        percent_match = self.PERCENT_BAR_RE.search(text)
        if percent_match:
            progress_val = self._normalize_progress(percent_match.group(1), True)
            if progress_val is not None:
                return {"progress": progress_val, "metrics": self._parse_metrics(text)}
        return None

    def _payload_from_json(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        payload: Dict[str, Any] = {}
        metrics: Dict[str, Any] = {}
        progress = data.get("progress")
        if progress is None:
            step = data.get("step") or data.get("completed_steps")
            total = data.get("total_steps") or data.get("max_steps") or data.get("epochs")
            if step is not None and total:
                try:
                    progress = float(step) / float(total)
                except (TypeError, ValueError, ZeroDivisionError):
                    progress = None
        normalized = self._normalize_progress(progress, False) if progress is not None else None
        if normalized is not None:
            payload["progress"] = normalized
        metrics_field = data.get("metrics")
        if isinstance(metrics_field, dict):
            metrics.update(metrics_field)
        for key in ("loss", "lr", "learning_rate", "accuracy", "epoch", "step"):
            if key in data and key not in metrics:
                metrics[key] = data[key]
        if metrics:
            payload["metrics"] = metrics
        status = data.get("status")
        if isinstance(status, str):
            payload["status"] = status
        return payload or None

    def _parse_metrics(self, text: str) -> Dict[str, Any]:
        metrics: Dict[str, Any] = {}
        for name, pattern in self.METRIC_PATTERNS:
            match = pattern.search(text)
            if not match:
                continue
            value_str = match.group(match.lastindex or 1)
            try:
                metrics[name] = float(value_str)
            except (TypeError, ValueError):
                metrics[name] = value_str
        return metrics

    def _extract_json(self, text: str) -> Optional[Dict[str, Any]]:
        if "{" not in text or "}" not in text:
            return None
        start = text.find("{")
        end = text.rfind("}")
        if end <= start:
            return None
        candidate = text[start : end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            return None

    @staticmethod
    def _normalize_progress(value: Any, is_percent: bool) -> Optional[float]:
        try:
            progress = float(value)
        except (TypeError, ValueError):
            return None
        if is_percent or progress > 1:
            progress = progress / 100.0
        return max(0.0, min(progress, 1.0))

    @staticmethod
    def _sanitize_metrics(metrics: Dict[str, Any]) -> Dict[str, Any]:
        clean: Dict[str, Any] = {}
        for key, value in metrics.items():
            if isinstance(value, (int, float, str, bool)) or value is None:
                clean[key] = value
            else:
                clean[key] = json.dumps(value)
        return clean

    def _terminate_process(self) -> None:
        process = self._process
        if not process or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


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
                        log_dir=self.config.log_dir,
                        work_dir=self.config.work_dir,
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
            job = TrainingJob(
                self,
                task_id,
                gpus,
                params,
                dataset_path,
                cmd,
                self.config.log_dir,
                self.config.work_dir,
            )
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

    # -------------------- Log access helpers --------------------
    def _log_file_path(self, task_id: int) -> Path:
        return (self.config.log_dir / f"{task_id}.log").resolve()

    def read_log_chunk(self, task_id: int, offset: int, limit: int) -> tuple[str, int, bool]:
        path = self._log_file_path(task_id)
        if not path.exists() or offset < 0:
            return "", max(offset, 0), False
        try:
            size = path.stat().st_size
            if offset > size:
                offset = size
            to_read = min(limit, max(size - offset, 0))
            data = b""
            with path.open("rb") as f:
                if offset:
                    f.seek(offset)
                if to_read:
                    data = f.read(to_read)
            next_offset = offset + len(data)
            # Consider complete if job no longer running and we've reached EOF
            with self._lock:
                running = task_id in self._jobs
            complete = (not running) and (next_offset >= size)
            try:
                text = data.decode("utf-8", errors="replace")
            except Exception:
                text = data.decode("latin-1", errors="replace")
            return text, next_offset, bool(complete)
        except OSError:
            return "", offset, False

    # -------------------- Dataset helpers --------------------
    def dataset_dir(self, task_id: int) -> Path:
        """Return a persistent per-task dataset directory on the agent host."""
        return (self.config.dataset_dir / f"task_{task_id}").resolve()
