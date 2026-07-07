from __future__ import annotations

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0013_agent_direct_upload"),
    ]

    operations = [
        migrations.CreateModel(
            name="UserSession",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("device_type", models.CharField(choices=[("mobile", "Mobile"), ("desktop", "Desktop")], max_length=16)),
                ("device_id", models.CharField(max_length=128)),
                ("token_hash", models.CharField(max_length=64)),
                ("user_agent", models.TextField(blank=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("active", "Active"), ("revoked", "Revoked"), ("expired", "Expired")],
                        default="active",
                        max_length=16,
                    ),
                ),
                ("last_seen_at", models.DateTimeField()),
                ("expires_at", models.DateTimeField()),
                ("revoked_at", models.DateTimeField(blank=True, null=True)),
                ("revoke_reason", models.CharField(blank=True, max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "user",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sessions", to="api.user"),
                ),
            ],
            options={
                "ordering": ["-last_seen_at"],
            },
        ),
        migrations.AddIndex(
            model_name="usersession",
            index=models.Index(fields=["user", "device_type", "status"], name="api_userses_user_id_2f8298_idx"),
        ),
        migrations.AddIndex(
            model_name="usersession",
            index=models.Index(fields=["expires_at"], name="api_userses_expires_79fc5a_idx"),
        ),
    ]
