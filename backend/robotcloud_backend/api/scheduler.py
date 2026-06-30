from __future__ import annotations

import json
import logging
import time
from collections import defaultdict
from datetime import timedelta
from typing import Dict, List, Optional, Set, Tuple

import requests
from pathlib import Path
from django.conf import settings
from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from .models import Dataset, InferenceTask, TrainTask, User, WorkerNode


def _normalize_policy_name(model_type: str) -> str:
    """Map UI model_type to training policy identifiers.

    Accepts labels like 'ACT', 'DiffusionPolicy', 'SmolVLA', 'Pi0', 'Pi0.5',
    and GR00T variants, returning one of: act, dp, smolvla, pi0, pi0.5, groot.
    The scheduler later maps these to lerobot-train's hydra key 'policy.type'.
    """
    key = (model_type or "").strip().lower()
    if key in {"act"}:
        return "act"
    if key in {"diffusionpolicy", "diffusion", "dp"}:
        return "dp"
    if key in {"smolvla", "smol vla", "smol-vla"}:
        return "smolvla"
    if key in {"pi0", "pi-0", "pi_0"}:
        return "pi0"
    if key in {"pi0.5", "pi0_5", "pi0-5", "pi05", "pi-0.5", "pi_0_5"}:
        return "pi0.5"
    if "gr00t" in key or "groot" in key:
        return "groot"
    # Fallback to act if unknown, to avoid script failure
    return "act"


class SchedulerService:
    """Background scheduler that assigns queued training tasks to worker nodes."""

    def __init__(
        self,
        loop_interval: float = 1.0,
        heartbeat_timeout: int = 120,
        max_retries: int = 3,
        logger: Optional[logging.Logger] = None,
    ) -> None:
        self.loop_interval = loop_interval
        self.heartbeat_timeout = timedelta(seconds=heartbeat_timeout)
        self.max_retries = max_retries
        self.logger = logger or logging.getLogger(__name__)

    def run_forever(self) -> None:
        self.logger.info("Scheduler loop started (interval=%ss)", self.loop_interval)
        while True:
            try:
                assigned = self.perform_scheduling_cycle()
                if assigned:
                    self.logger.debug("Assigned %s training tasks", assigned)
            except Exception:  # pragma: no cover - defensive guard
                self.logger.exception("Scheduler cycle failed")
            time.sleep(self.loop_interval)

    def perform_scheduling_cycle(self) -> int:
        """Execute a single scheduling cycle and return number of assignments."""
        self.refresh_queue_positions()
        assigned = self.assign_pending_tasks()
        assigned += self.assign_pending_inference_tasks()
        self.cleanup_offline_nodes()
        return assigned

    # -------------------- Core routines --------------------
    def refresh_queue_positions(self) -> None:
        queued_tasks = list(TrainTask.objects.filter(status="queued").order_by("-priority", "created_at"))
        for index, task in enumerate(queued_tasks, start=1):
            if task.queue_position != index:
                TrainTask.objects.filter(pk=task.pk).update(queue_position=index)

    def assign_pending_tasks(self) -> int:
        nodes = list(
            WorkerNode.objects.filter(status=WorkerNode.STATUS_ONLINE, gpu_total__gt=0).order_by("node_name")
        )
        if not nodes:
            return 0
        nodes_by_name = {node.node_name: node for node in nodes}

        node_gpu_usage: Dict[str, Set[int]] = defaultdict(set)
        running_tasks = TrainTask.objects.filter(
            status="running", assigned_node__in=[node.node_name for node in nodes]
        )
        for task in running_tasks:
            if not task.assigned_node:
                continue
            node_gpu_usage[task.assigned_node].update(self._parse_assigned_gpus(task.assigned_gpus))
        running_inference = InferenceTask.objects.filter(
            status="running", assigned_node__in=[node.node_name for node in nodes]
        )
        for task in running_inference:
            if not task.assigned_node:
                continue
            node_gpu_usage[task.assigned_node].update(self._parse_assigned_gpus(task.assigned_gpus))

        running_counts = {
            row["user_id"]: row["count"]
            for row in TrainTask.objects.filter(status="running").values("user_id").annotate(count=Count("id"))
        }

        queued_tasks = list(
            TrainTask.objects.filter(status="queued")
            .select_related("user", "dataset")
            .order_by("-priority", "queue_position", "created_at")
        )

        assignments = 0
        for task in queued_tasks:
            max_concurrent = self._max_concurrent_for_role(task.user.role)
            current_running = running_counts.get(task.user_id, 0)
            if current_running >= max_concurrent:
                continue
            candidate_nodes = nodes
            if task.dataset.storage_backend == Dataset.STORAGE_BACKEND_AGENT:
                node_for_dataset = nodes_by_name.get(task.dataset.storage_node or "")
                if not node_for_dataset:
                    continue
                candidate_nodes = [node_for_dataset]
            node = self._select_node(candidate_nodes, node_gpu_usage)
            if not node:
                continue
            assignment = self._attempt_assignment(task, node, node_gpu_usage, max_concurrent)
            if not assignment:
                continue
            node_ref, task_ref, gpu_index = assignment
            if self._dispatch_task(node_ref, task_ref, gpu_index):
                node_gpu_usage[node_ref.node_name].add(gpu_index)
                running_counts[task_ref.user_id] = running_counts.get(task_ref.user_id, 0) + 1
                assignments += 1
            else:
                self._rollback_assignment(task_ref.id, node_ref.id)

        if assignments:
            self.refresh_queue_positions()
        return assignments

    def assign_pending_inference_tasks(self) -> int:
        nodes = list(
            WorkerNode.objects.filter(status=WorkerNode.STATUS_ONLINE, gpu_total__gt=0).order_by("node_name")
        )
        if not nodes:
            return 0
        nodes_by_name = {node.node_name: node for node in nodes}
        # Global throttle: only allow one inference task running at any time.
        if InferenceTask.objects.filter(status="running").exists():
            return 0

        node_gpu_usage: Dict[str, Set[int]] = defaultdict(set)
        running_train = TrainTask.objects.filter(
            status="running", assigned_node__in=[node.node_name for node in nodes]
        )
        for task in running_train:
            if not task.assigned_node:
                continue
            node_gpu_usage[task.assigned_node].update(self._parse_assigned_gpus(task.assigned_gpus))
        running_inference = InferenceTask.objects.filter(
            status="running", assigned_node__in=[node.node_name for node in nodes]
        )
        for task in running_inference:
            if not task.assigned_node:
                continue
            node_gpu_usage[task.assigned_node].update(self._parse_assigned_gpus(task.assigned_gpus))

        running_counts = {
            row["user_id"]: row["count"]
            for row in InferenceTask.objects.filter(status="running").values("user_id").annotate(count=Count("id"))
        }

        queued_tasks = list(
            InferenceTask.objects.filter(status="queued")
            .select_related("user")
            .order_by("created_at")
        )
        model_nodes = {
            row["id"]: row["assigned_node"]
            for row in TrainTask.objects.filter(id__in=[task.model_id for task in queued_tasks]).values(
                "id", "assigned_node"
            )
        }

        assignments = 0
        for task in queued_tasks:
            max_concurrent = self._max_inference_concurrent_for_role(task.user.role)
            current_running = running_counts.get(task.user_id, 0)
            if current_running >= max_concurrent:
                continue
            candidate_nodes = nodes
            model_node = model_nodes.get(task.model_id)
            if model_node:
                node_for_model = nodes_by_name.get(model_node)
                if not node_for_model:
                    continue
                candidate_nodes = [node_for_model]
            node = self._select_node(candidate_nodes, node_gpu_usage)
            if not node:
                continue
            assignment = self._attempt_inference_assignment(task, node, node_gpu_usage, max_concurrent)
            if not assignment:
                continue
            node_ref, task_ref, gpu_index = assignment
            if self._dispatch_inference_task(node_ref, task_ref, gpu_index):
                node_gpu_usage[node_ref.node_name].add(gpu_index)
                running_counts[task_ref.user_id] = running_counts.get(task_ref.user_id, 0) + 1
                assignments += 1
            else:
                self._rollback_inference_assignment(task_ref.id, node_ref.id)
        return assignments

    def _attempt_inference_assignment(
        self,
        task: InferenceTask,
        node: WorkerNode,
        node_gpu_usage: Dict[str, Set[int]],
        max_concurrent: int,
    ) -> Optional[Tuple[WorkerNode, InferenceTask, int]]:
        with transaction.atomic():
            node_ref = WorkerNode.objects.select_for_update().get(pk=node.pk)
            available_gpu = self._available_gpus(node_ref, node_gpu_usage)
            if not available_gpu:
                return None
            task_ref = InferenceTask.objects.select_for_update().select_related("user").get(pk=task.pk)
            if task_ref.status != "queued":
                return None
            running_for_user = (
                InferenceTask.objects.filter(user_id=task_ref.user_id, status="running")
                .exclude(pk=task_ref.pk)
                .count()
            )
            if running_for_user >= max_concurrent:
                return None
            gpu_index = available_gpu[0]
            task_ref.status = "running"
            task_ref.assigned_node = node_ref.node_name
            task_ref.assigned_gpus = json.dumps([gpu_index])
            task_ref.progress = 0.0
            task_ref.started_at = timezone.now()
            task_ref.save(
                update_fields=["status", "assigned_node", "assigned_gpus", "progress", "started_at"]
            )

            node_ref.gpu_busy = min(node_ref.gpu_busy + 1, node_ref.gpu_total)
            node_ref.gpu_free = max(node_ref.gpu_total - node_ref.gpu_busy, 0)
            node_ref.save(update_fields=["gpu_busy", "gpu_free", "updated_at"])
        return node_ref, task_ref, gpu_index

    def _dispatch_inference_task(self, node: WorkerNode, task: InferenceTask, gpu_index: int) -> bool:
        url = f"http://{node.ip}:{node.api_port}/api/v1/agent/infer"
        payload = {
            "task_id": task.id,
            "gpus": [gpu_index],
            "cmd": "lerobot-infer",
            "params": {"host": "0.0.0.0", "port": 6152},
            "checkpoint_path": task.checkpoint_path,
        }
        headers = {
            "Content-Type": "application/json",
            "X-Agent-Token": node.auth_token,
        }
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=5)
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            self.logger.warning("Failed to dispatch inference task %s to node %s: %s", task.id, node.node_name, exc)
            return False
        if isinstance(data, dict):
            if data.get("status") == "accepted":
                return True
            if isinstance(data.get("data"), dict) and data["data"].get("status") == "accepted":
                return True
        self.logger.warning(
            "Unexpected response when dispatching inference task %s to node %s: %s", task.id, node.node_name, data
        )
        return False

    def _attempt_assignment(
        self,
        task: TrainTask,
        node: WorkerNode,
        node_gpu_usage: Dict[str, Set[int]],
        max_concurrent: int,
    ) -> Optional[Tuple[WorkerNode, TrainTask, int]]:
        with transaction.atomic():
            node_ref = WorkerNode.objects.select_for_update().get(pk=node.pk)
            available_gpu = self._available_gpus(node_ref, node_gpu_usage)
            if not available_gpu:
                return None
            task_ref = (
                TrainTask.objects.select_for_update()
                .select_related("dataset", "user")
                .get(pk=task.pk)
            )
            if task_ref.status != "queued":
                return None
            running_for_user = (
                TrainTask.objects.filter(user_id=task_ref.user_id, status="running")
                .exclude(pk=task_ref.pk)
                .count()
            )
            if running_for_user >= max_concurrent:
                return None
            gpu_index = available_gpu[0]
            task_ref.status = "running"
            task_ref.assigned_node = node_ref.node_name
            task_ref.assigned_gpus = json.dumps([gpu_index])
            task_ref.progress = 0.0
            task_ref.save(update_fields=["status", "assigned_node", "assigned_gpus", "progress"])

            node_ref.gpu_busy = min(node_ref.gpu_busy + 1, node_ref.gpu_total)
            node_ref.gpu_free = max(node_ref.gpu_total - node_ref.gpu_busy, 0)
            node_ref.save(update_fields=["gpu_busy", "gpu_free", "updated_at"])
        return node_ref, task_ref, gpu_index

    def _dispatch_task(self, node: WorkerNode, task: TrainTask, gpu_index: int) -> bool:
        url = f"http://{node.ip}:{node.api_port}/api/v1/agent/run"
        original_params: Dict = dict(task.params or {})
        # Build direct lerobot-train parameters (forwarded by scripts/lerobot-train.sh)
        train_params: Dict[str, object] = {}

        # Policy selection maps to hydra key policy.type
        normalized = _normalize_policy_name(task.model_type)
        policy_type = {"dp": "diffusion", "pi0.5": "pi05"}.get(normalized, normalized)
        train_params["policy.type"] = policy_type

        # Provide a synthetic dataset repo id for traceability; can be overridden
        dataset_repo_id = f"robotcloud/dataset_{task.dataset_id}" if task.dataset_id else "robotcloud/dataset"
        train_params["dataset.repo_id"] = dataset_repo_id

        # Instruct agent to pass local dataset path as --dataset.root=... when available
        train_params["dataset_arg"] = "dataset.root"
        if task.dataset_id:
            train_params["dataset.mode"] = "local"

        # Common tunables
        batch_size = original_params.pop("batch_size", None)
        if isinstance(batch_size, (int, float)):
            train_params["batch_size"] = int(batch_size)

        steps = original_params.pop("steps", None)
        if isinstance(steps, (int, float)):
            train_params["steps"] = int(steps)
        else:
            epochs = original_params.pop("epochs", None)
            if isinstance(epochs, (int, float)):
                train_params["epochs"] = int(epochs)

        # Carry through remaining user params as direct flags
        learning_rate = original_params.pop("learning_rate", None)
        if learning_rate is not None:
            train_params["learning_rate"] = learning_rate
        for key, value in list(original_params.items()):
            if value is None:
                continue
            train_params[key] = value
            original_params.pop(key, None)

        # Upload dataset package to agent first (if available)
        # Default to original storage_path; will be emptied if upload succeeds
        dataset_path = task.dataset.storage_path if task.dataset_id else ""
        if (
            task.dataset_id
            and task.dataset
            and task.dataset.storage_path
            and task.dataset.storage_backend != Dataset.STORAGE_BACKEND_AGENT
        ):
            file_path = self._dataset_file_on_disk(task)
            if file_path and file_path.exists() and file_path.is_file():
                upload_url = f"http://{node.ip}:{node.api_port}/api/v1/agent/upload"
                headers = {"X-Agent-Token": node.auth_token, "Content-Type": "application/octet-stream"}
                md5hex = self._md5_of_file(file_path)
                if md5hex:
                    headers["X-Content-MD5"] = md5hex
                params = {"task_id": task.id, "filename": file_path.name}
                if md5hex:
                    params["md5"] = md5hex
                try:
                    with file_path.open("rb") as fp:
                        resp = requests.post(upload_url, params=params, data=fp, headers=headers, timeout=30)
                        resp.raise_for_status()
                    # Agent will extract and set dataset path itself; leave empty here
                    dataset_path = ""
                except Exception as exc:
                    self.logger.warning(
                        "Failed to upload dataset for task %s to node %s: %s", task.id, node.node_name, exc
                    )
                    # Best-effort: proceed to dispatch; agent may use provided dataset_path

        # Ensure a per-task output directory is provided unless the user already
        # set one explicitly in params.
        if "output_dir" not in train_params:
            train_params["output_dir"] = f"backend/storage/train_runs/task_{task.id}"

        payload = {
            "task_id": task.id,
            # Use alias-resolved script name; agent will map to scripts/lerobot-train.sh
            "cmd": original_params.get("cmd", "lerobot"),
            "gpus": [gpu_index],
            "model_type": task.model_type,
            # Let agent discover extracted path when upload succeeded; otherwise pass original path
            "dataset_path": dataset_path,
            # Provide direct training parameters for the agent wrapper to forward
            "params": train_params,
        }
        headers = {
            "Content-Type": "application/json",
            "X-Agent-Token": node.auth_token,
        }
        try:
            response = requests.post(url, json=payload, headers=headers, timeout=5)
            response.raise_for_status()
            data = response.json()
        except Exception as exc:
            self.logger.warning("Failed to dispatch task %s to node %s: %s", task.id, node.node_name, exc)
            return False
        if isinstance(data, dict):
            if data.get("status") == "accepted":
                return True
            if isinstance(data.get("data"), dict) and data["data"].get("status") == "accepted":
                return True
        self.logger.warning(
            "Unexpected response when dispatching task %s to node %s: %s", task.id, node.node_name, data
        )
        return False

    def _md5_of_file(self, path: Path) -> Optional[str]:
        try:
            import hashlib

            m = hashlib.md5()
            with path.open("rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    if not chunk:
                        break
                    m.update(chunk)
            return m.hexdigest()
        except OSError:
            return None

    def _dataset_file_on_disk(self, task: TrainTask) -> Optional[Path]:
        """Resolve dataset file absolute path on backend host."""
        try:
            raw = (task.dataset.storage_path or "").strip()
        except Exception:
            return None
        if not raw:
            return None
        p = Path(raw)
        if p.is_absolute():
            return p
        base = getattr(settings, "DATASET_STORAGE_DIR", None)
        if not base:
            return p
        return Path(base) / p

    def _rollback_assignment(self, task_id: int, node_id: int) -> None:
        with transaction.atomic():
            try:
                task = TrainTask.objects.select_for_update().get(pk=task_id)
            except TrainTask.DoesNotExist:
                return
            task.status = "queued"
            task.assigned_node = None
            task.assigned_gpus = None
            task.progress = 0.0
            task.save(update_fields=["status", "assigned_node", "assigned_gpus", "progress"])
            try:
                node = WorkerNode.objects.select_for_update().get(pk=node_id)
            except WorkerNode.DoesNotExist:
                return
            node.gpu_busy = max(node.gpu_busy - 1, 0)
            node.gpu_free = max(node.gpu_total - node.gpu_busy, 0)
            node.save(update_fields=["gpu_busy", "gpu_free", "updated_at"])

    def _rollback_inference_assignment(self, task_id: int, node_id: int) -> None:
        with transaction.atomic():
            try:
                task = InferenceTask.objects.select_for_update().get(pk=task_id)
            except InferenceTask.DoesNotExist:
                return
            task.status = "queued"
            task.assigned_node = None
            task.assigned_gpus = None
            task.progress = 0.0
            task.save(update_fields=["status", "assigned_node", "assigned_gpus", "progress"])
            try:
                node = WorkerNode.objects.select_for_update().get(pk=node_id)
            except WorkerNode.DoesNotExist:
                return
            node.gpu_busy = max(node.gpu_busy - 1, 0)
            node.gpu_free = max(node.gpu_total - node.gpu_busy, 0)
            node.save(update_fields=["gpu_busy", "gpu_free", "updated_at"])

    def cleanup_offline_nodes(self) -> None:
        threshold = timezone.now() - self.heartbeat_timeout
        offline_nodes = WorkerNode.objects.filter(
            last_heartbeat__lt=threshold, status=WorkerNode.STATUS_ONLINE
        )
        for node in offline_nodes:
            self.logger.warning("Marking node %s offline due to heartbeat timeout", node.node_name)
            node.status = WorkerNode.STATUS_OFFLINE
            node.gpu_busy = 0
            node.gpu_free = 0
            node.save(update_fields=["status", "gpu_busy", "gpu_free", "updated_at"])
            self._requeue_tasks_for_node(node)

    # -------------------- Helpers --------------------
    def _requeue_tasks_for_node(self, node: WorkerNode) -> None:
        tasks = TrainTask.objects.filter(assigned_node=node.node_name, status="running")
        for task in tasks:
            if task.retry_count >= self.max_retries:
                task.status = "failed"
            else:
                task.status = "queued"
                task.retry_count += 1
                task.progress = 0.0
            task.assigned_node = None
            task.assigned_gpus = None
            task.save(update_fields=["status", "retry_count", "assigned_node", "assigned_gpus", "progress"])
        inference_tasks = InferenceTask.objects.filter(assigned_node=node.node_name, status="running")
        for task in inference_tasks:
            task.status = "queued"
            task.assigned_node = None
            task.assigned_gpus = None
            task.progress = 0.0
            task.save(update_fields=["status", "assigned_node", "assigned_gpus", "progress"])
        if tasks.exists():
            self.refresh_queue_positions()

    def _available_gpus(self, node: WorkerNode, node_gpu_usage: Dict[str, Set[int]]) -> List[int]:
        used = node_gpu_usage[node.node_name]
        return [idx for idx in range(node.gpu_total) if idx not in used]

    def _select_node(self, nodes: List[WorkerNode], node_gpu_usage: Dict[str, Set[int]]) -> Optional[WorkerNode]:
        best_node: Optional[WorkerNode] = None
        best_free = -1
        for node in nodes:
            used = len(node_gpu_usage[node.node_name])
            free = node.gpu_total - used
            if free <= 0:
                continue
            if free > best_free:
                best_node = node
                best_free = free
        return best_node

    def _parse_assigned_gpus(self, assigned_gpus: Optional[str]) -> List[int]:
        if not assigned_gpus:
            return []
        try:
            parsed = json.loads(assigned_gpus)
        except json.JSONDecodeError:
            return []
        if isinstance(parsed, list):
            result: List[int] = []
            for item in parsed:
                try:
                    result.append(int(item))
                except (TypeError, ValueError):
                    continue
            return result
        return []

    def _max_concurrent_for_role(self, role: str) -> int:
        mapping = {
            User.ROLE_PRO: 4,
            User.ROLE_PLUS: 3,
            User.ROLE_FREE: 2,
            User.ROLE_ADMIN: 4,
        }
        return mapping.get(role, 2)

    def _max_inference_concurrent_for_role(self, role: str) -> int:
        mapping = {
            User.ROLE_PRO: 2,
            User.ROLE_PLUS: 1,
            User.ROLE_FREE: 1,
            User.ROLE_ADMIN: 2,
        }
        return mapping.get(role, 1)
