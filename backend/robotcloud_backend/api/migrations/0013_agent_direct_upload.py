from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0012_remove_seeded_api_admin"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="default_agent_node",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="dataset",
            name="storage_backend",
            field=models.CharField(
                choices=[("local", "Local"), ("agent", "Agent")],
                default="local",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="dataset",
            name="storage_node",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="dataset",
            name="content_md5",
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name="dataset",
            name="file_size",
            field=models.BigIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="dataset",
            name="original_filename",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="workernode",
            name="public_base_url",
            field=models.CharField(blank=True, max_length=512),
        ),
        migrations.AddField(
            model_name="workernode",
            name="upload_enabled",
            field=models.BooleanField(default=True),
        ),
    ]
