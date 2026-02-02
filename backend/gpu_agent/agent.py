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
import hashlib
import shutil
import errno
import socket

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
        if parsed.path == "/api/v1/agent/infer":
            self._handle_infer()
            return
        if parsed.path == "/api/v1/agent/delete_model":
            self._handle_delete_model()
            return
        if parsed.path == "/api/v1/agent/inference/stop":
            self._handle_inference_stop()
            return
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

    def _handle_infer(self) -> None:
        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON payload")
            return
        try:
            result = self.server.agent.enqueue_inference(payload)
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

    def _handle_delete_model(self) -> None:
        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON payload")
            return
        try:
            result = self.server.agent.delete_model_files(payload)
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

    def _handle_inference_stop(self) -> None:
        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length) if content_length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON payload")
            return
        task_id = payload.get("task_id")
        if task_id is None:
            self.send_error(400, "task_id required")
            return
        try:
            task_id = int(task_id)
        except (TypeError, ValueError):
            self.send_error(400, "task_id must be an integer")
            return
        result = self.server.agent.stop_inference_task(task_id)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802
        # Lightweight log chunk endpoint for scheduler/backend proxy.
        # GET /api/v1/agent/logs?task_id=123&offset=0&limit=65536
        from urllib.parse import urlparse, parse_qs

        parsed = urlparse(self.path)
        if parsed.path not in {"/api/v1/agent/logs", "/api/v1/agent/inference_logs"}:
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

        if parsed.path == "/api/v1/agent/inference_logs":
            content, next_offset, complete = self.server.agent.read_inference_log_chunk(task_id, offset, limit)
        else:
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
        expected_md5 = (qs.get("md5") or [None])[0] or self.headers.get("X-Content-MD5")
        if isinstance(expected_md5, str):
            expected_md5 = expected_md5.strip().lower()

        # Read body (possibly large); prefer chunked reading and compute md5
        try:
            content_length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            content_length = 0
        try:
            target_dir = self.server.agent.dataset_dir(task_id)
            target_dir.mkdir(parents=True, exist_ok=True)
            dest = target_dir / f"{filename}.part"
            md5 = hashlib.md5()
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
                        md5.update(chunk)
                else:
                    while remaining > 0:
                        chunk = self.rfile.read(min(chunk_size, remaining))
                        if not chunk:
                            break
                        f.write(chunk)
                        md5.update(chunk)
                        remaining -= len(chunk)
            actual_md5 = md5.hexdigest()
            final_task_path = target_dir / filename
            dest.rename(final_task_path)
            if expected_md5 and actual_md5 != expected_md5:
                # Integrity check failed; remove file and report error
                try:
                    final_task_path.unlink(missing_ok=True)  # type: ignore[call-arg]
                except TypeError:
                    # Python 3.10 compatibility
                    if final_task_path.exists():
                        final_task_path.unlink()
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps({"detail": "MD5 mismatch", "expected": expected_md5, "actual": actual_md5}).encode("utf-8")
                )
                return
        except OSError as exc:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"detail": f"Failed to write file: {exc}"}).encode("utf-8"))
            return
        # Move/copy to cache by MD5 and persist task meta
        cache_copied = False
        cache_path_str = ""
        try:
            cache_root = self.server.agent.dataset_cache_root(actual_md5)
            archives_dir = cache_root / "archives"
            archives_dir.mkdir(parents=True, exist_ok=True)
            cache_path = archives_dir / filename
            if not cache_path.exists():
                try:
                    shutil.copy2(final_task_path, cache_path)
                    cache_copied = True
                except OSError:
                    pass
            cache_path_str = str(cache_path)
            # Save per-task meta for later reuse
            self.server.agent.save_task_dataset_meta(task_id, {
                "md5": actual_md5,
                "archive_path": cache_path_str,
                "filename": filename,
            })
        except Exception:
            # Best-effort: ignore caching errors
            cache_path_str = str(final_task_path)
        body = json.dumps({"status": "ok", "path": cache_path_str, "md5": actual_md5, "cached": cache_copied}).encode("utf-8")
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
        attach_pid: Optional[int] = None,
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
        self._attach_pid = attach_pid

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
        if self._attach_pid:
            # Attach to an existing training process and tail logs
            self.logger.info("Attaching to existing training task %s (pid=%s)", self.task_id, self._attach_pid)
            self._attach_and_tail(self._attach_pid)
            return
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
            output_dir = self._resolve_output_dir()
            checkpoint_path = output_dir / "checkpoints" / "last" / "pretrained_model"
            self.agent.notify_status(
                self.task_id,
                "completed",
                self._last_progress,
                metrics={
                    "exit_code": exit_code,
                    "log_path": str(self.log_path),
                    "output_dir": str(output_dir),
                    "checkpoint_path": str(checkpoint_path),
                },
            )
        else:
            self.logger.error("Training task %s failed with exit code %s", self.task_id, exit_code)
            self.agent.notify_status(
                self.task_id,
                "failed",
                self._last_progress,
                metrics={"exit_code": exit_code, "log_path": str(self.log_path)},
            )

    def _attach_and_tail(self, pid: int) -> None:
        # Send immediate running status with known metadata
        self.agent.notify_status(
            self.task_id,
            "running",
            self._last_progress,
            metrics={"dataset_path": self.dataset_path, "log_path": str(self.log_path), "attached": True, "pid": pid},
        )
        # Tail the existing log file similar to _stream_process loop
        offset = 0
        try:
            if self.log_path.exists():
                offset = self.log_path.stat().st_size
        except OSError:
            offset = 0
        step = max(getattr(self.agent.config, "step_delay", 0.5), 0.1)
        while True:
            # Drain new lines
            try:
                size = self.log_path.stat().st_size if self.log_path.exists() else offset
                if size > offset:
                    with self.log_path.open("r", encoding="utf-8", errors="replace") as rf:
                        rf.seek(offset)
                        data = rf.read(size - offset)
                    if data:
                        for line in data.splitlines():
                            self._handle_output_line(line)
                    offset = size
            except OSError:
                pass
            if self._stopping.is_set():
                break
            if not self._is_process_alive(pid):
                break
            time.sleep(step)
        # Decide final status heuristically
        final_status = "completed" if self._last_progress >= 0.999 else "failed"
        self.agent.notify_status(
            self.task_id,
            final_status,
            self._last_progress,
            metrics={"attached": True, "pid": pid, "log_path": str(self.log_path)},
        )

    def _stream_process(self, command: List[str], env: Dict[str, str]) -> int:
        header = (
            f"[robotcloud] task={self.task_id} gpus={self.gpus} dataset_path={self.dataset_path or 'N/A'}\n"
            f"[robotcloud] command={self._format_command(command)}\n\n"
        )
        # Write header and get starting offset for tailing
        with self.log_path.open("w", encoding="utf-8") as f:
            f.write(header)
            f.flush()
        try:
            # Open log file for appending as the child stdout/stderr sink
            log_sink = self.log_path.open("a", encoding="utf-8")
            try:
                # Start process detached from agent's stdin/stdout; keep training alive if agent dies
                process = subprocess.Popen(
                    command,
                    cwd=str(self.work_dir),
                    env=env,
                    stdout=log_sink,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    universal_newlines=True,
                    preexec_fn=os.setsid if hasattr(os, "setsid") else None,
                )
                # Persist job state for recovery
                try:
                    self.agent.save_job_state(
                        self.task_id,
                        {
                            "pid": process.pid,
                            "gpus": self.gpus,
                            "cmd": self.cmd,
                            "params": self.params,
                            "dataset_path": self.dataset_path,
                            "log_path": str(self.log_path),
                            "work_dir": str(self.work_dir),
                        },
                    )
                except Exception:
                    pass
            except FileNotFoundError as exc:
                log_sink.close()
                raise FileNotFoundError(f"Executable not found for training command '{command[0]}'") from exc
        except OSError as exc:
            raise RuntimeError(f"Failed to initialize log file: {exc}") from exc

        self._process = process
        # Tail the log file to parse progress while the process runs
        offset = self.log_path.stat().st_size
        tail_buffer = ""
        try:
            step = max(getattr(self.agent.config, "step_delay", 0.5), 0.1)
            while True:
                # Read any new data appended to the log
                try:
                    size = self.log_path.stat().st_size
                except OSError:
                    size = offset
                if size > offset:
                    try:
                        with self.log_path.open("r", encoding="utf-8", errors="replace") as rf:
                            rf.seek(offset)
                            data = rf.read(size - offset)
                    except OSError:
                        data = ""
                    if data:
                        tail_buffer += data
                        # Process complete lines; keep last partial line in buffer
                        lines = tail_buffer.splitlines(keepends=False)
                        if not tail_buffer.endswith("\n"):
                            tail_buffer = lines[-1] if lines else tail_buffer
                            lines = lines[:-1] if lines else []
                        else:
                            tail_buffer = ""
                        for line in lines:
                            self._handle_output_line(line)
                    offset = size

                if self._stopping.is_set():
                    break
                rc = process.poll()
                if rc is not None:
                    # Final drain
                    try:
                        size = self.log_path.stat().st_size
                        if size > offset:
                            with self.log_path.open("r", encoding="utf-8", errors="replace") as rf:
                                rf.seek(offset)
                                data = rf.read(size - offset)
                            if data:
                                tail_buffer += data
                                for line in tail_buffer.splitlines():
                                    self._handle_output_line(line)
                    except OSError:
                        pass
                    break
                time.sleep(step)
        finally:
            try:
                log_sink.flush()
                log_sink.close()
            except Exception:
                pass
        exit_code = process.wait()
        self._process = None
        # Clear job state on finish
        try:
            self.agent.clear_job_state(self.task_id)
        except Exception:
            pass
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

    def _resolve_output_dir(self) -> Path:
        output_dir = self.params.get("output_dir")
        if isinstance(output_dir, str) and output_dir:
            return Path(output_dir)
        return self.work_dir / "backend" / "storage" / "train_runs" / f"task_{self.task_id}"

    def _format_command(self, command: List[str]) -> str:
        return shlex.join(command)

    def _build_script_aliases(self) -> Dict[str, Path]:
        scripts_dir = self.work_dir / "scripts"
        aliases: Dict[str, Path] = {}
        lerobot = scripts_dir / "lerobot-train.sh"
        if lerobot.exists():
            aliases["lerobot"] = lerobot
            aliases["lerobot-train.sh"] = lerobot
        return aliases

    # -------------------- Dataset preparation --------------------
    def _prepare_dataset(self) -> None:
        """Ensure self.dataset_path points to a directory with extracted data.

        Priority order:
          1) If dataset_path is an existing directory, keep it.
          2) If dataset_path is a file archive, extract it.
          3) If not provided or not found, look under agent's dataset_dir(task_id)
             for an uploaded archive and extract it.
          4) If task meta contains an MD5, reuse the cache at dataset_cache_dir/<md5>.
        """
        # Prefer cached extraction via MD5 if available
        try:
            meta = self.agent.load_task_dataset_meta(self.task_id)
        except Exception:
            meta = None
        dataset_md5 = None
        if isinstance(meta, dict):
            val = meta.get("md5")
            if isinstance(val, str) and len(val) >= 16:
                dataset_md5 = val.strip().lower()
        if dataset_md5:
            cache_root = self.agent.dataset_cache_root(dataset_md5)
            extracted_root = cache_root / "extracted"
            archives_dir = cache_root / "archives"
            # If extracted already exists, use it
            if extracted_root.exists():
                self.dataset_path = str(self._normalize_dataset_root(extracted_root))
                return
            # Otherwise, find an archive in cache and extract it to cache
            archive_path: Optional[Path] = None
            arch = meta.get("archive_path") if isinstance(meta, dict) else None
            if isinstance(arch, str) and arch:
                p = Path(arch)
                if p.exists():
                    archive_path = p
            if not archive_path and archives_dir.exists():
                for f in sorted(archives_dir.iterdir()):
                    if f.is_file():
                        archive_path = f
                        break
            if archive_path and archive_path.exists():
                extracted = self._extract_archive(archive_path, target_dir=extracted_root)
                if extracted:
                    self.dataset_path = str(self._normalize_dataset_root(extracted))
                    return
        # 1) Already a directory
        if self.dataset_path:
            p = Path(self.dataset_path).expanduser()
            if p.is_dir():
                # Normalize expected layout inside existing directory
                normalized = self._normalize_dataset_root(p)
                self.dataset_path = str(normalized)
                return
            if p.is_file():
                # Attempt to reuse cache by computing md5
                try:
                    dataset_md5 = self._md5_of_file(p)
                except Exception:
                    dataset_md5 = None
                if dataset_md5:
                    cache_root = self.agent.dataset_cache_root(dataset_md5)
                    extracted_root = cache_root / "extracted"
                    if extracted_root.exists():
                        self.dataset_path = str(self._normalize_dataset_root(extracted_root))
                        return
                    extracted = self._extract_archive(p.resolve(), target_dir=extracted_root)
                else:
                    extracted = self._extract_archive(p.resolve())
                if extracted:
                    self.dataset_path = str(self._normalize_dataset_root(extracted))
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
                self.dataset_path = str(self._normalize_dataset_root(extracted))
                return

    def _extract_archive(self, file_path: Path, target_dir: Optional[Path] = None) -> Optional[Path]:
        """Extract .zip/.tar(.gz)/.tgz archives.

        - If target_dir is provided, extract there; otherwise use sibling 'data' dir.
        Returns the extraction directory on success, or None if unsupported/failed.
        """
        suffixes = [s.lower() for s in file_path.suffixes]
        if not file_path.exists() or not suffixes:
            return None
        target = target_dir or (file_path.parent / "data")
        try:
            target.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        try:
            if suffixes[-1] == ".zip":
                with zipfile.ZipFile(file_path, "r") as zf:
                    zf.extractall(target)
                # Cleanup spurious files that affect training
                self._cleanup_extracted(target)
                return target
            if ".tar" in suffixes or suffixes[-1] in {".gz", ".tgz"}:
                try:
                    with tarfile.open(file_path, "r:*") as tf:
                        tf.extractall(target)
                    # Cleanup spurious files that affect training
                    self._cleanup_extracted(target)
                    return target
                except tarfile.TarError:
                    return None
        except (OSError, zipfile.BadZipFile):
            return None
        return None

    def _md5_of_file(self, file_path: Path) -> Optional[str]:
        try:
            m = hashlib.md5()
            with file_path.open("rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    if not chunk:
                        break
                    m.update(chunk)
            return m.hexdigest()
        except OSError:
            return None

    def _cleanup_extracted(self, root: Path) -> int:
        """Remove files like '._*.parquet' that can break training.

        Returns number of files removed.
        """
        removed = 0
        try:
            for p in root.rglob("*.parquet"):
                try:
                    if p.is_file() and p.name.startswith("._"):
                        p.unlink()
                        removed += 1
                except OSError:
                    continue
        except OSError:
            return removed
        if removed:
            try:
                self.logger.info("Removed %s invalid parquet files from dataset (._*.parquet)", removed)
            except Exception:
                pass
        return removed

    @staticmethod
    def _is_process_alive(pid: int) -> bool:
        try:
            # On POSIX, signal 0 checks existence without sending a signal
            os.kill(pid, 0)
            return True
        except PermissionError:
            # Process exists but we don't have permission
            return True
        except ProcessLookupError:
            return False
        except Exception:
            # Fallback best-effort
            return False

    def _normalize_dataset_root(self, root: Path) -> Path:
        """Ensure dataset.root contains 'data', 'meta', 'videos' subfolders.

        - If current root already has them, return as-is.
        - If any immediate subdir has the required layout, select it.
        - Otherwise, create missing subfolders under current root and return it.
        """
        def has_required(d: Path) -> bool:
            return (d / "data").is_dir() and (d / "meta").is_dir() and (d / "videos").is_dir()

        try:
            if has_required(root):
                return root
            # Search one level down
            for sub in sorted([p for p in root.iterdir() if p.is_dir()]):
                if has_required(sub):
                    return sub
            # Create missing folders in current root
            for name in ("data", "meta", "videos"):
                d = root / name
                if not d.exists():
                    d.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        return root

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


class InferenceJob(threading.Thread):
    """Start an async inference policy server."""

    MAX_RUNTIME_SECONDS = 600

    def __init__(
        self,
        agent: "Agent",
        task_id: int,
        gpus: List[int],
        params: Dict,
        cmd: str,
        log_dir: Path,
        work_dir: Path,
    ) -> None:
        super().__init__(daemon=True)
        self.agent = agent
        self.task_id = task_id
        self.gpus = gpus
        self.params = dict(params or {})
        self.cmd = (cmd or "python -m lerobot.async_inference.policy_server").strip()
        self.log_dir = Path(log_dir)
        self.work_dir = Path(work_dir)
        self.log_path = self.log_dir / f"inference_{self.task_id}.log"
        self.logger = agent.logger.getChild(f"infer-{task_id}")
        self._process: Optional[subprocess.Popen[str]] = None
        self.server_port: Optional[int] = None
        self._script_aliases = self._build_script_aliases()
        self._stop_event = threading.Event()
        self._stop_completed = False

    def run(self) -> None:
        try:
            self.log_dir.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        host = str(self.params.get("host") or "0.0.0.0")
        port = str(self.params.get("port") or self._pick_port())
        self.server_port = port
        command = self._build_command(host, port)
        env = self._build_env()
        try:
            with self.log_path.open("w", encoding="utf-8") as logf:
                self._process = subprocess.Popen(
                    command,
                    cwd=self.work_dir,
                    env=env,
                    stdout=logf,
                    stderr=logf,
                    text=True,
                )
                self.agent.notify_inference_status(
                    self.task_id,
                    "running",
                    0.0,
                    server_port=port,
                    log_path=str(self.log_path),
                )
                try:
                    exit_code = self._process.wait(timeout=self.MAX_RUNTIME_SECONDS)
                except subprocess.TimeoutExpired:
                    self.logger.info("Inference task %s reached max runtime, terminating.", self.task_id)
                    self._terminate_process()
                    self.agent.notify_inference_status(
                        self.task_id,
                        "completed",
                        1.0,
                        server_port=port,
                        log_path=str(self.log_path),
                    )
                    self.agent.finish_job(self.task_id)
                    return
        except Exception as exc:
            self.logger.exception("Inference task %s crashed: %s", self.task_id, exc)
            self.agent.notify_inference_status(
                self.task_id,
                "failed",
                0.0,
                server_port=port,
                error_message=str(exc),
                log_path=str(self.log_path),
            )
            self.agent.finish_job(self.task_id)
            return
        if self._stop_event.is_set() and self._stop_completed:
            self.agent.notify_inference_status(
                self.task_id,
                "completed",
                1.0,
                server_port=port,
                log_path=str(self.log_path),
            )
            self.agent.finish_job(self.task_id)
            return
        if exit_code == 0:
            self.agent.notify_inference_status(
                self.task_id,
                "completed",
                1.0,
                server_port=port,
                log_path=str(self.log_path),
            )
        else:
            self.agent.notify_inference_status(
                self.task_id,
                "failed",
                0.0,
                server_port=port,
                error_message=f"exit_code={exit_code}",
                log_path=str(self.log_path),
            )
        self.agent.finish_job(self.task_id)

    def stop(self, mark_completed: bool = True) -> None:
        self._stop_completed = mark_completed
        self._stop_event.set()
        self._terminate_process()

    def _build_env(self) -> Dict[str, str]:
        env = os.environ.copy()
        if self.gpus:
            env["CUDA_VISIBLE_DEVICES"] = ",".join(str(gpu) for gpu in self.gpus)
        env["INFER_TASK_ID"] = str(self.task_id)
        return env

    def _terminate_process(self) -> None:
        process = self._process
        if not process or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()

    def _build_command(self, host: str, port: int) -> List[str]:
        base = shlex.split(self.cmd)
        base = self._resolve_executable(base)
        args = [f"--host={host}", f"--port={port}"]
        return base + args

    def _resolve_executable(self, tokens: List[str]) -> List[str]:
        if not tokens:
            return tokens
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

    def _build_script_aliases(self) -> Dict[str, Path]:
        scripts_dir = self.work_dir / "scripts"
        aliases: Dict[str, Path] = {}
        lerobot_infer = scripts_dir / "lerobot-infer.sh"
        if lerobot_infer.exists():
            aliases["lerobot-infer"] = lerobot_infer
            aliases["lerobot-infer.sh"] = lerobot_infer
        return aliases

    def _pick_port(self) -> int:
        start = int(os.getenv("AGENT_INFERENCE_PORT_START", "6153"))
        max_tries = int(os.getenv("AGENT_INFERENCE_PORT_RANGE", "50"))
        for offset in range(max_tries):
            port = start + offset
            if self._port_available(port):
                return port
        raise ValueError("No available inference port")

    @staticmethod
    def _port_available(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("0.0.0.0", port))
            except OSError:
                return False
        return True


class Agent:
    """RobotCloud GPU agent implementation."""

    def __init__(self, config: AgentConfig, session: Optional[requests.Session] = None) -> None:
        self.config = config
        self.logger = logging.getLogger("robotcloud.gpu_agent")
        self.session = session or requests.Session()
        self.agent_token: Optional[str] = None
        self._jobs: Dict[int, TrainingJob] = {}
        self._inference_jobs: Dict[int, InferenceJob] = {}
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._heartbeat_thread: Optional[threading.Thread] = None

    def start(self) -> None:
        """Register with scheduler, start heartbeat loop and HTTP server."""
        self.logger.info("Starting GPU agent for node '%s' on port %s", self.config.node_name, self.config.api_port)
        self._register_with_scheduler()
        # Attempt to recover any running training processes from previous session
        try:
            self._recover_existing_jobs()
        except Exception as exc:  # pragma: no cover - defensive
            self.logger.warning("Recovery of existing jobs failed: %s", exc)
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
                        dataset_cache_dir=self.config.dataset_cache_dir,
                    )
                self.logger.info("Agent registered with scheduler (token=%s)", self.agent_token[:8])
                return
            except Exception as exc:
                detail = ""
                if "response" in locals():
                    try:
                        detail = f" status={response.status_code} body={response.text}"
                    except Exception:
                        detail = ""
                self.logger.error("Failed to register agent: %s%s", exc, detail)
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

    def notify_inference_status(
        self,
        task_id: int,
        status: str,
        progress: float,
        server_port: Optional[int] = None,
        error_message: Optional[str] = None,
        log_path: Optional[str] = None,
    ) -> None:
        if not self.agent_token:
            return
        payload = {
            "task_id": task_id,
            "status": status,
            "progress": round(progress, 4),
            "server_host": self.config.report_ip,
            "server_port": server_port,
            "error_message": error_message,
            "log_path": log_path,
        }
        url = f"{self.config.backend_base_url}/internal/inference/update"
        headers = {
            "Content-Type": "application/json",
            "X-Agent-Token": self.agent_token,
        }
        try:
            response = self.session.post(url, json=payload, headers=headers, timeout=5)
            response.raise_for_status()
        except Exception as exc:
            self.logger.warning("Failed to report inference status for task %s: %s", task_id, exc)

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

    def delete_model_files(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        paths = payload.get("paths")
        if not isinstance(paths, list) or not paths:
            raise ValueError("paths required")
        removed: List[str] = []
        skipped: List[str] = []
        base_dir = self.config.work_dir.resolve()
        for raw in paths:
            if not isinstance(raw, str) or not raw.strip():
                continue
            try:
                path = Path(raw).expanduser().resolve()
            except Exception:
                skipped.append(str(raw))
                continue
            try:
                common = Path(os.path.commonpath([str(base_dir), str(path)]))
            except ValueError:
                skipped.append(str(path))
                continue
            if common != base_dir:
                skipped.append(str(path))
                continue
            if not path.exists():
                skipped.append(str(path))
                continue
            try:
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
                removed.append(str(path))
            except OSError:
                skipped.append(str(path))
        return {"status": "ok", "removed": removed, "skipped": skipped}

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

    def enqueue_inference(self, payload: Dict) -> Dict[str, str]:
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
        cmd = payload.get("cmd", "python -m lerobot.async_inference.policy_server")
        with self._lock:
            if task_id in self._inference_jobs:
                self.logger.info("Inference task %s already running, acknowledging duplicate dispatch", task_id)
                return {"status": "accepted", "detail": "already running"}
            job = InferenceJob(
                self,
                task_id,
                gpus,
                params,
                cmd,
                self.config.log_dir,
                self.config.work_dir,
            )
            self._inference_jobs[task_id] = job
        job.start()
        return {"status": "accepted"}

    def finish_job(self, task_id: int) -> None:
        with self._lock:
            self._jobs.pop(task_id, None)
            self._inference_jobs.pop(task_id, None)

    def stop_inference_task(self, task_id: int) -> Dict[str, str]:
        with self._lock:
            job = self._inference_jobs.get(task_id)
        if not job:
            return {"status": "not_running"}
        job.stop(mark_completed=True)
        return {"status": "stopping"}

    def _busy_gpu_indices(self) -> List[int]:
        with self._lock:
            indices: List[int] = []
            for job in self._jobs.values():
                indices.extend(job.gpus)
            for job in self._inference_jobs.values():
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

    def _inference_log_file_path(self, task_id: int) -> Path:
        return (self.config.log_dir / f"inference_{task_id}.log").resolve()

    def read_inference_log_chunk(self, task_id: int, offset: int, limit: int) -> tuple[str, int, bool]:
        path = self._inference_log_file_path(task_id)
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
            with self._lock:
                running = task_id in self._inference_jobs
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
        root = self.config.dataset_cache_dir.parent  # backend_root/storage
        return (root / "datasets" / f"task_{task_id}").resolve()

    def dataset_cache_root(self, md5: str) -> Path:
        """Return the cache root directory for a dataset MD5."""
        safe = (md5 or "").strip().lower()
        return (self.config.dataset_cache_dir / safe).resolve()

    def _task_meta_path(self, task_id: int) -> Path:
        return self.dataset_dir(task_id) / "meta.json"

    def save_task_dataset_meta(self, task_id: int, data: Dict[str, Any]) -> None:
        path = self._task_meta_path(task_id)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            existing: Dict[str, Any] = {}
            if path.exists():
                try:
                    existing = json.loads(path.read_text("utf-8")) or {}
                    if not isinstance(existing, dict):
                        existing = {}
                except Exception:
                    existing = {}
            existing.update(data or {})
            path.write_text(json.dumps(existing, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    def load_task_dataset_meta(self, task_id: int) -> Optional[Dict[str, Any]]:
        path = self._task_meta_path(task_id)
        if not path.exists():
            return None
        try:
            obj = json.loads(path.read_text("utf-8") or "{}")
            return obj if isinstance(obj, dict) else None
        except Exception:
            return None

    # -------------------- Recovery helpers --------------------
    def _tasks_root(self) -> Path:
        return (self.config.dataset_cache_dir.parent / "datasets").resolve()

    def _recover_existing_jobs(self) -> None:
        root = self._tasks_root()
        if not root.exists():
            return
        recovered = 0
        for child in sorted(root.iterdir()):
            if not child.is_dir() or not child.name.startswith("task_"):
                continue
            try:
                task_id = int(child.name.split("_", 1)[1])
            except Exception:
                continue
            meta = self.load_task_dataset_meta(task_id) or {}
            pid = meta.get("pid") if isinstance(meta, dict) else None
            try:
                pid = int(pid) if pid is not None else None
            except Exception:
                pid = None
            if not pid:
                continue
            # Verify process is alive
            if not TrainingJob._is_process_alive(pid):
                # Clear stale pid
                self.clear_job_state(task_id)
                continue
            if task_id in self._jobs:
                continue
            gpus = meta.get("gpus") if isinstance(meta, dict) else None
            if not isinstance(gpus, list) or not gpus:
                gpus = [0]
            cmd = meta.get("cmd") if isinstance(meta, dict) else None
            if not isinstance(cmd, str) or not cmd:
                cmd = "python train.py"
            params = meta.get("params") if isinstance(meta, dict) else None
            if not isinstance(params, dict):
                params = {}
            dataset_path = meta.get("dataset_path") if isinstance(meta, dict) else None
            if not isinstance(dataset_path, str):
                dataset_path = ""
            job = TrainingJob(
                self,
                task_id,
                gpus,
                params,
                dataset_path,
                cmd,
                self.config.log_dir,
                self.config.work_dir,
                attach_pid=pid,
            )
            self._jobs[task_id] = job
            job.start()
            recovered += 1
        if recovered:
            self.logger.info("Recovered %s running training task(s) from previous session", recovered)

    def save_job_state(self, task_id: int, data: Dict[str, Any]) -> None:
        # Alias to dataset meta store used for recovery
        self.save_task_dataset_meta(task_id, data)

    def clear_job_state(self, task_id: int) -> None:
        path = self._task_meta_path(task_id)
        try:
            if not path.exists():
                return
            meta = json.loads(path.read_text("utf-8") or "{}")
            if isinstance(meta, dict) and "pid" in meta:
                meta.pop("pid", None)
                path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass
