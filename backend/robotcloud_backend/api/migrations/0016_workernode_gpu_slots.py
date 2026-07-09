from __future__ import annotations

from django.db import migrations, models


def initialize_gpu_slots(apps, schema_editor) -> None:
    WorkerNode = apps.get_model("api", "WorkerNode")
    for node in WorkerNode.objects.all():
        gpu_total = max(int(node.gpu_total or 0), 0)
        gpu_busy = max(int(node.gpu_busy or 0), 0)
        node.gpu_slot_total = gpu_total
        node.gpu_slot_busy = min(gpu_busy, gpu_total)
        node.gpu_slot_free = max(gpu_total - node.gpu_slot_busy, 0)
        node.save(update_fields=["gpu_slot_total", "gpu_slot_busy", "gpu_slot_free"])


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0015_usersession_api_userses_token_h_226657_idx"),
    ]

    operations = [
        migrations.AddField(
            model_name="workernode",
            name="gpu_slot_total",
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name="workernode",
            name="gpu_slot_free",
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name="workernode",
            name="gpu_slot_busy",
            field=models.IntegerField(default=0),
        ),
        migrations.RunPython(initialize_gpu_slots, migrations.RunPython.noop),
    ]
