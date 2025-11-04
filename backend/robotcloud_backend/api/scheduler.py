from __future__ import annotations

import json
import logging
import time
from collections import defaultdict
from datetime import timedelta
from typing import Dict, List, Optional, Set, Tuple

import requests
from django.db import transaction
from django.db.models import Count
from django.utils import timezone

from .models import TrainTask, User, WorkerNode


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

        node_gpu_usage: Dict[str, Set[int]] = defaultdict(set)
        running_tasks = TrainTask.objects.filter(
            status="running", assigned_node__in=[node.node_name for node in nodes]
        )
        for task in running_tasks:
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
            node = self._select_node(nodes, node_gpu_usage)
            if not node:
                break
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
        params = task.params or {}
        payload = {
            "task_id": task.id,
            "cmd": params.get("cmd", "python train.py"),
            "gpus": [gpu_index],
            "model_type": task.model_type,
            "dataset_path": task.dataset.storage_path if task.dataset_id else "",
            "params": params,
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
