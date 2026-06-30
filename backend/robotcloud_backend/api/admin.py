"""Admin registrations for RobotCloud API models."""
from __future__ import annotations

from django.contrib import admin

from . import models


@admin.register(models.User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("id", "phone", "role", "expire_at", "created_at")
    list_filter = ("role",)
    search_fields = ("phone",)
    readonly_fields = ("created_at",)
    ordering = ("id",)


@admin.register(models.Dataset)
class DatasetAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "owner", "visibility", "status", "created_at")
    list_filter = ("visibility", "status")
    search_fields = ("name", "owner__phone")
    readonly_fields = ("created_at",)
    list_select_related = ("owner",)


@admin.register(models.TrainTask)
class TrainTaskAdmin(admin.ModelAdmin):
    list_display = ("id", "dataset", "user", "model_type", "status", "progress", "created_at")
    list_filter = ("status", "model_type")
    search_fields = ("dataset__name", "user__phone", "model_type")
    readonly_fields = ("created_at",)
    list_select_related = ("dataset", "user")


@admin.register(models.InferenceTask)
class InferenceTaskAdmin(admin.ModelAdmin):
    list_display = ("id", "model_id", "dataset", "user", "status", "created_at")
    list_filter = ("status",)
    search_fields = ("dataset__name", "user__phone")
    readonly_fields = ("created_at",)
    list_select_related = ("dataset", "user")


@admin.register(models.SimulationTask)
class SimulationTaskAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "scene_file", "robot_type", "training_mode", "status", "created_at")
    list_filter = ("status", "robot_type", "training_mode")
    search_fields = ("user__phone", "scene_file")
    readonly_fields = ("created_at",)
    list_select_related = ("user",)


@admin.register(models.Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = ("id", "sn", "user", "model_id", "bind_time")
    list_filter = ("model_id",)
    search_fields = ("sn", "user__phone")
    readonly_fields = ("bind_time",)
    list_select_related = ("user",)


@admin.register(models.AdminLog)
class AdminLogAdmin(admin.ModelAdmin):
    list_display = ("id", "admin", "action", "target_type", "target_id", "created_at")
    search_fields = ("admin__phone", "action", "target_type", "target_id")
    readonly_fields = ("created_at",)
    list_select_related = ("admin",)



