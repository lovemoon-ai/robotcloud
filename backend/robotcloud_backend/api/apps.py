from __future__ import annotations

from django.apps import AppConfig


class ApiConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "robotcloud_backend.api"
    verbose_name = "RobotCloud API"
