from __future__ import annotations

import os

from django.contrib.auth.hashers import make_password
from django.db import migrations


def create_django_superuser(apps, schema_editor) -> None:
    User = apps.get_model("auth", "User")

    debug_enabled = os.getenv("DJANGO_DEBUG", "false").lower() in {"1", "true", "yes"}
    username = os.getenv("DJANGO_ADMIN_USERNAME") or ("admin" if debug_enabled else "")
    password = os.getenv("DJANGO_ADMIN_PASSWORD") or ("admin" if debug_enabled else "")
    email = os.getenv("DJANGO_ADMIN_EMAIL") or "admin@robotcloud.local"

    if not username or not password:
        return

    if User.objects.filter(username=username).exists():
        return

    User.objects.create(
        username=username,
        email=email,
        password=make_password(password),
        is_staff=True,
        is_superuser=True,
        is_active=True,
    )


def drop_django_superuser(apps, schema_editor) -> None:
    User = apps.get_model("auth", "User")
    username = os.getenv("DJANGO_ADMIN_USERNAME") or "admin"
    User.objects.filter(username=username).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0007_payment"),
    ]

    operations = [
        migrations.RunPython(create_django_superuser, reverse_code=drop_django_superuser),
    ]
