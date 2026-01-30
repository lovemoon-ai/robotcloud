"""Django settings for RobotCloud project."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Load environment variables from .env if present (in project root)
load_dotenv(BASE_DIR.parent / ".env")

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "robotcloud-development-secret-key")

DEBUG = os.getenv("DJANGO_DEBUG", "true").lower() in {"1", "true", "yes"}

# TODO: add ALLOWED_HOSTS for production server
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")


def _env_flag(name: str) -> bool:
    value = os.getenv(name)
    return value is not None and value.lower() in {"1", "true", "yes"}


def _split_env_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "robotcloud_backend.api",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "robotcloud_backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "robotcloud_backend.wsgi.application"
ASGI_APPLICATION = "robotcloud_backend.asgi.application"


DEFAULT_SQLITE_DB = {
    "ENGINE": "django.db.backends.sqlite3",
    "NAME": os.getenv("SQLITE_PATH", str(BASE_DIR / "db.sqlite3")),
}

DATABASES = {"default": DEFAULT_SQLITE_DB}

if _env_flag("USE_POSTGRES") and not _env_flag("USE_SQLITE"):
    DATABASES["default"] = {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB", "robotcloud"),
        "USER": os.getenv("POSTGRES_USER", "robotcloud"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD", "robotcloud"),
        "HOST": os.getenv("POSTGRES_HOST", "127.0.0.1"),
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
    }


CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0"),
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
        },
    },
    "tokens": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": os.getenv("REDIS_TOKENS_URL", os.getenv("REDIS_URL", "redis://127.0.0.1:6379/1")),
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
        },
    },
}

if _env_flag("USE_SQLITE_FOR_TESTS") or _env_flag("USE_SQLITE"):
    DATABASES["default"] = DEFAULT_SQLITE_DB

if _env_flag("USE_IN_MEMORY_CACHE"):
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "robotcloud-default",
        },
        "tokens": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "robotcloud-tokens",
        },
    }

SESSION_ENGINE = "django.contrib.sessions.backends.cache"
SESSION_CACHE_ALIAS = "default"

if _env_flag("DJANGO_CORS_ALLOW_ALL"):
    CORS_ALLOW_ALL_ORIGINS = True
else:
    CORS_ALLOWED_ORIGINS = _split_env_list(os.getenv("DJANGO_CORS_ALLOWED_ORIGINS")) or [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

CORS_ALLOW_CREDENTIALS = True


AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Frontend static files (Next.js export output)
STATICFILES_DIRS = [
    BASE_DIR / "public",
]

# WhiteNoise configuration for serving static files
WHITENOISE_ROOT = BASE_DIR / "public"
WHITENOISE_INDEX_FILE = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.FormParser",
        "rest_framework.parsers.MultiPartParser",
    ],
}

DATASET_STORAGE_DIR = Path(os.getenv("DATASET_STORAGE_DIR", BASE_DIR / "storage" / "datasets")).resolve()

# SMS Configuration (Volcengine)
VOLC_ACCESS_KEY_ID = os.getenv("VOLC_ACCESS_KEY_ID", "")
VOLC_SECRET_ACCESS_KEY = os.getenv("VOLC_SECRET_ACCESS_KEY", "")
VOLC_SMS_ACCOUNT = os.getenv("VOLC_SMS_ACCOUNT", "")
VOLC_SMS_SIGN_NAME = os.getenv("VOLC_SMS_SIGN_NAME", "")
VOLC_SMS_TEMPLATE_ID = os.getenv("VOLC_SMS_TEMPLATE_ID", "")

# Auth Configuration
# In development mode, use this fixed code instead of sending real SMS
AUTH_DEV_CODE = os.getenv("AUTH_DEV_CODE", "000000" if DEBUG else "")

# Alipay Configuration
ALIPAY_APP_ID = os.getenv("ALIPAY_APP_ID", "")
ALIPAY_PRIVATE_KEY = os.getenv("ALIPAY_PRIVATE_KEY", "")
ALIPAY_PUBLIC_KEY = os.getenv("ALIPAY_PUBLIC_KEY", "")
ALIPAY_GATEWAY = os.getenv("ALIPAY_GATEWAY", "https://openapi.alipay.com/gateway.do")

# Payment Configuration
# In development mode, use 1 cent (0.01 RMB) for testing
PAYMENT_DEV_AMOUNT_CENTS = 1  # 0.01 RMB

# Plus subscription price: 200 RMB/month (20000 cents)
PLUS_PRICE_CNY = 20000
