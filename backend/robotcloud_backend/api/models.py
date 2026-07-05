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
    default_agent_node = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.phone} ({self.role})"


class AuthToken(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="auth_tokens")
    token_hash = models.CharField(max_length=64, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"AuthToken(user={self.user_id}, expires_at={self.expires_at.isoformat()})"


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

    STORAGE_BACKEND_LOCAL = "local"
    STORAGE_BACKEND_AGENT = "agent"

    STORAGE_BACKEND_CHOICES = [
        (STORAGE_BACKEND_LOCAL, "Local"),
        (STORAGE_BACKEND_AGENT, "Agent"),
    ]

    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="datasets")
    storage_path = models.CharField(max_length=512)
    storage_backend = models.CharField(max_length=16, choices=STORAGE_BACKEND_CHOICES, default=STORAGE_BACKEND_LOCAL)
    storage_node = models.CharField(max_length=64, blank=True)
    content_md5 = models.CharField(max_length=32, blank=True)
    file_size = models.BigIntegerField(default=0)
    original_filename = models.CharField(max_length=255, blank=True)
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
    checkpoint_path = models.CharField(max_length=512, null=True, blank=True)
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
    dataset = models.ForeignKey(
        Dataset,
        on_delete=models.CASCADE,
        related_name="inference_tasks",
        null=True,
        blank=True,
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="inference_tasks")
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="queued")
    progress = models.FloatField(default=0.0)
    assigned_node = models.CharField(max_length=64, null=True, blank=True)
    assigned_gpus = models.CharField(max_length=64, null=True, blank=True)
    server_host = models.CharField(max_length=128, null=True, blank=True)
    server_port = models.IntegerField(null=True, blank=True)
    checkpoint_path = models.CharField(max_length=512, null=True, blank=True)
    result_path = models.CharField(max_length=512, null=True, blank=True)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)
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
    public_base_url = models.CharField(max_length=512, blank=True)
    upload_enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["node_name"]

    def __str__(self) -> str:
        return f"{self.node_name} ({self.status})"


class Payment(models.Model):
    STATUS_PENDING = "pending"
    STATUS_SUCCEEDED = "succeeded"
    STATUS_FAILED = "failed"
    STATUS_CANCELED = "canceled"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_SUCCEEDED, "Succeeded"),
        (STATUS_FAILED, "Failed"),
        (STATUS_CANCELED, "Canceled"),
    ]

    payment_id = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="payments")
    target_role = models.CharField(max_length=16, choices=User.ROLE_CHOICES)
    amount_cents = models.IntegerField()
    currency = models.CharField(max_length=8, default="CNY")
    provider = models.CharField(max_length=32, default="mock")
    provider_reference = models.CharField(max_length=128, blank=True)
    description = models.CharField(max_length=255, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_PENDING)
    applied_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.payment_id} ({self.status})"
