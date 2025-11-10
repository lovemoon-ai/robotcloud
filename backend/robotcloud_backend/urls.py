"""Root URL configuration for RobotCloud."""
from __future__ import annotations

from django.contrib import admin
from django.urls import include, path
from django.conf import settings
from django.views.static import serve

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("robotcloud_backend.api.urls")),
    # Expose local storage (datasets, train logs) for development and simple setups.
    # This serves files under `<BASE_DIR>/storage` at `/storage/...` URLs, e.g.
    #   /storage/train_logs/<task_id>.log
    #   /storage/datasets/<...>
    path(
        "storage/<path:path>",
        serve,
        {"document_root": settings.BASE_DIR / "storage"},
        name="robotcloud-storage",
    ),
]
