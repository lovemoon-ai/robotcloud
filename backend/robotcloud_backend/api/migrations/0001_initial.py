from __future__ import annotations

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="User",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("phone", models.CharField(max_length=11, unique=True)),
                ("password_hash", models.CharField(max_length=128)),
                ("role", models.CharField(choices=[("free", "Free"), ("plus", "Plus"), ("pro", "Pro"), ("admin", "Admin")], default="free", max_length=16)),
                ("expire_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["id"],
            },
        ),
        migrations.CreateModel(
            name="Dataset",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("description", models.TextField(blank=True)),
                ("storage_path", models.CharField(max_length=512)),
                ("visibility", models.CharField(choices=[("private", "Private"), ("public", "Public")], default="private", max_length=16)),
                ("status", models.CharField(choices=[("processing", "Processing"), ("ready", "Ready"), ("failed", "Failed")], default="processing", max_length=16)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="datasets", to="api.user")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="TrainTask",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("model_type", models.CharField(max_length=128)),
                ("params", models.JSONField(blank=True, default=dict)),
                ("status", models.CharField(choices=[("queued", "Queued"), ("running", "Running"), ("completed", "Completed"), ("failed", "Failed")], default="queued", max_length=16)),
                ("progress", models.FloatField(default=0.0)),
                ("logs_url", models.CharField(max_length=512)),
                ("model_path", models.CharField(blank=True, max_length=512, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("dataset", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="train_tasks", to="api.dataset")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="train_tasks", to="api.user")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="SimulationTask",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("scene_file", models.CharField(max_length=255)),
                ("model_id", models.IntegerField()),
                ("robot_type", models.CharField(max_length=128)),
                ("training_mode", models.CharField(max_length=128)),
                ("status", models.CharField(choices=[("queued", "Queued"), ("running", "Running"), ("completed", "Completed"), ("failed", "Failed")], default="queued", max_length=16)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="simulation_tasks", to="api.user")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="InvitationCode",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.CharField(max_length=32, unique=True)),
                ("used", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("used_at", models.DateTimeField(blank=True, null=True)),
                ("note", models.CharField(blank=True, max_length=255, null=True)),
                ("assigned_phone", models.CharField(blank=True, max_length=11, null=True)),
                ("assigned_user", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="invitation_codes", to="api.user")),
            ],
            options={
                "ordering": ["code"],
            },
        ),
        migrations.CreateModel(
            name="InferenceTask",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("model_id", models.IntegerField()),
                ("status", models.CharField(choices=[("queued", "Queued"), ("running", "Running"), ("completed", "Completed"), ("failed", "Failed")], default="queued", max_length=16)),
                ("result_path", models.CharField(blank=True, max_length=512, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("dataset", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inference_tasks", to="api.dataset")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="inference_tasks", to="api.user")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="Device",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("sn", models.CharField(max_length=64, unique=True)),
                ("model_id", models.IntegerField(blank=True, null=True)),
                ("bind_time", models.DateTimeField(auto_now_add=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="devices", to="api.user")),
            ],
            options={
                "ordering": ["-bind_time"],
            },
        ),
        migrations.CreateModel(
            name="AdminLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("action", models.CharField(max_length=255)),
                ("target_type", models.CharField(max_length=64)),
                ("target_id", models.IntegerField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("admin", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="admin_logs", to="api.user")),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
    ]
