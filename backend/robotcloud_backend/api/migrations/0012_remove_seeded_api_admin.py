from __future__ import annotations

from django.db import migrations


def remove_seeded_api_admin(apps, schema_editor) -> None:
    User = apps.get_model("api", "User")
    User.objects.filter(phone="19900000000", role="admin").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0011_inference_dataset_nullable"),
    ]

    operations = [
        migrations.RunPython(remove_seeded_api_admin, reverse_code=migrations.RunPython.noop),
    ]
