"""Database models for RobotCloud API."""
from __future__ import annotations

from django.core.validators import RegexValidator
from django.db import models

PHONE_VALIDATOR = RegexValidator(regex=r"^1\d{10}$", message="Invalid phone number.")


class User(models.Model):
    ROLE_FREE = "free"
    ROLE_PLUS = "plus"
    ROLE_PRO = "pro"
    ROLE_ADMIN = "admin"

    ROLE_CHOICES = [
        (ROLE_FREE, "Free"),
        (ROLE_PLUS, "Plus"),
        (ROLE_PRO, "Pro"),
        (ROLE_ADMIN, "Admin"),
    ]

    phone = models.CharField(max_length=11, unique=True, validators=[PHONE_VALIDATOR])
    password_hash = models.CharField(max_length=128)
    role = models.CharField(max_length=16, choices=ROLE_CHOICES, default=ROLE_FREE)
    expire_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.phone} ({self.role})"


class Dataset(models.Model):
    VISIBILITY_PRIVATE = "private"
    VISIBILITY_PUBLIC = "public"

    VISIBILITY_CHOICES = [
        (VISIBILITY_PRIVATE, "Private"),
        (VISIBILITY_PUBLIC, "Public"),
    ]

    STATUS_PROCESSING = "processing"
    STATUS_READY = "ready"
    STATUS_FAILED = "failed"

    STATUS_CHOICES = [
        (STATUS_PROCESSING, "Processing"),
        (STATUS_READY, "Ready"),
        (STATUS_FAILED, "Failed"),
    ]

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="datasets")
    storage_path = models.CharField(max_length=512)
    visibility = models.CharField(max_length=16, choices=VISIBILITY_CHOICES, default=VISIBILITY_PRIVATE)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PROCESSING)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.visibility})"


class TrainTask(models.Model):
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ]

    dataset = models.ForeignKey(Dataset, on_delete=models.CASCADE, related_name="train_tasks")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="train_tasks")
    model_type = models.CharField(max_length=128)
    params = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="queued")
    progress = models.FloatField(default=0.0)
    logs_url = models.CharField(max_length=512)
    model_path = models.CharField(max_length=512, null=True, blank=True)
    assigned_node = models.CharField(max_length=64, null=True, blank=True)
    assigned_gpus = models.CharField(max_length=64, null=True, blank=True)
    priority = models.IntegerField(default=0)
    queue_position = models.IntegerField(default=0)
    retry_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"TrainTask#{self.pk} ({self.status})"


class InferenceTask(models.Model):
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ]

    model_id = models.IntegerField()
    dataset = models.ForeignKey(Dataset, on_delete=models.CASCADE, related_name="inference_tasks")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="inference_tasks")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="queued")
    result_path = models.CharField(max_length=512, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"InferenceTask#{self.pk} ({self.status})"


class SimulationTask(models.Model):
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="simulation_tasks")
    scene_file = models.CharField(max_length=255)
    model_id = models.IntegerField()
    robot_type = models.CharField(max_length=128)
    training_mode = models.CharField(max_length=128)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="queued")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"SimulationTask#{self.pk} ({self.status})"


class Device(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="devices")
    sn = models.CharField(max_length=64, unique=True)
    model_id = models.IntegerField(null=True, blank=True)
    bind_time = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-bind_time"]

    def __str__(self) -> str:
        return f"{self.sn}"


class AdminLog(models.Model):
    admin = models.ForeignKey(User, on_delete=models.CASCADE, related_name="admin_logs")
    action = models.CharField(max_length=255)
    target_type = models.CharField(max_length=64)
    target_id = models.IntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.action} ({self.target_type}#{self.target_id})"


class InvitationCode(models.Model):
    code = models.CharField(max_length=32, unique=True)
    used = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=255, null=True, blank=True)
    assigned_user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="invitation_codes",
        null=True,
        blank=True,
    )
    assigned_phone = models.CharField(max_length=11, null=True, blank=True, validators=[PHONE_VALIDATOR])

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return f"Invitation {self.code} ({'used' if self.used else 'available'})"


class WorkerNode(models.Model):
    STATUS_ONLINE = "online"
    STATUS_OFFLINE = "offline"

    STATUS_CHOICES = [
        (STATUS_ONLINE, "Online"),
        (STATUS_OFFLINE, "Offline"),
    ]

    node_name = models.CharField(max_length=64, unique=True)
    ip = models.CharField(max_length=64)
    gpu_total = models.IntegerField(default=0)
    gpu_free = models.IntegerField(default=0)
    gpu_busy = models.IntegerField(default=0)
    last_heartbeat = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_OFFLINE)
    version = models.CharField(max_length=20, blank=True)
    auth_token = models.CharField(max_length=64, unique=True)
    api_port = models.IntegerField(default=5000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["node_name"]

    def __str__(self) -> str:
        return f"{self.node_name} ({self.status})"
