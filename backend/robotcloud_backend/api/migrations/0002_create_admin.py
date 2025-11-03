from __future__ import annotations

import hashlib

from django.db import migrations


def create_admin(apps, schema_editor) -> None:
    User = apps.get_model("api", "User")
    if not User.objects.filter(phone="19900000000").exists():
        User.objects.create(
            phone="19900000000",
            password_hash=hashlib.sha256("admin".encode("utf-8")).hexdigest(),
            role="admin",
        )


def drop_admin(apps, schema_editor) -> None:
    User = apps.get_model("api", "User")
    User.objects.filter(phone="19900000000").delete()


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(create_admin, reverse_code=drop_admin),
    ]
