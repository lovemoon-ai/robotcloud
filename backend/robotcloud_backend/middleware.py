"""Custom middleware for RobotCloud."""
from __future__ import annotations

from whitenoise.middleware import WhiteNoiseMiddleware


class AdminWhiteNoiseMiddleware(WhiteNoiseMiddleware):
    """Bypass WhiteNoise for Django admin routes."""

    def __call__(self, request):
        path = request.path_info or ""
        if path == "/admin" or path.startswith("/admin/"):
            return self.get_response(request)
        return super().__call__(request)
