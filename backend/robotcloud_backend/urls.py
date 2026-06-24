"""Root URL configuration for RobotCloud."""
from __future__ import annotations

from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from django.views.static import serve

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("robotcloud_backend.api.urls")),
]

if getattr(settings, "SERVE_STORAGE_FILES", False):
    urlpatterns.append(
        path(
            "storage/<path:path>",
            serve,
            {"document_root": settings.BASE_DIR / "storage"},
            name="robotcloud-storage",
        )
    )
