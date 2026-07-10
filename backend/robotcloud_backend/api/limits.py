"""Shared account limit helpers."""
from __future__ import annotations

from typing import Any

from django.conf import settings


def _settings_phone_set(name: str) -> set[str]:
    values = getattr(settings, name, [])
    if isinstance(values, str):
        values = values.split(",")
    return {str(item).strip() for item in values if str(item).strip()}


def phone_has_no_limits(phone: str) -> bool:
    return str(phone or "").strip() in _settings_phone_set("AUTH_NO_LIMITS_WHITELIST_PHONES")


def phone_defaults_to_plus(phone: str) -> bool:
    normalized = str(phone or "").strip()
    return normalized in _settings_phone_set("AUTH_PLUS_WHITELIST_PHONES") or phone_has_no_limits(normalized)


def user_has_no_limits(user: Any) -> bool:
    return phone_has_no_limits(getattr(user, "phone", ""))
