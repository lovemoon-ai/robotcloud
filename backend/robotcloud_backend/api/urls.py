"""API routing for RobotCloud endpoints."""
from __future__ import annotations

from django.urls import path

from . import views

urlpatterns = [
    # Authentication
    path("auth/send_code", views.SendCodeView.as_view(), name="auth-send-code"),
    path("auth/register", views.RegisterView.as_view(), name="auth-register"),
    path("auth/register_invite", views.RegisterInviteView.as_view(), name="auth-register-invite"),
    path("auth/login", views.LoginView.as_view(), name="auth-login"),
    path("auth/verify_token", views.VerifyTokenView.as_view(), name="auth-verify-token"),
    # User
    path("user/profile", views.ProfileView.as_view(), name="user-profile"),
    path("user/upgrade", views.UpgradeView.as_view(), name="user-upgrade"),
    path("user/usage", views.UsageView.as_view(), name="user-usage"),
    # Dashboard
    path("dashboard/summary", views.DashboardSummaryView.as_view(), name="dashboard-summary"),
    # Dataset
    path("dataset/upload", views.DatasetUploadView.as_view(), name="dataset-upload"),
    path("dataset/list", views.DatasetListView.as_view(), name="dataset-list"),
    path("dataset/<int:dataset_id>", views.DatasetDetailView.as_view(), name="dataset-detail"),
    path("dataset/<int:dataset_id>/stats", views.DatasetStatsView.as_view(), name="dataset-stats"),
    path("dataset/<int:dataset_id>/preview", views.DatasetPreviewView.as_view(), name="dataset-preview"),
    # Training
    path("training/create", views.TrainingCreateView.as_view(), name="training-create"),
    path("training/list", views.TrainingListView.as_view(), name="training-list"),
    path("training/<int:task_id>/status", views.TrainingStatusView.as_view(), name="training-status"),
    path("training/<int:task_id>/stop", views.TrainingStopView.as_view(), name="training-stop"),
    path("training/<int:task_id>/download", views.TrainingDownloadView.as_view(), name="training-download"),
    # Inference
    path("inference/create", views.InferenceCreateView.as_view(), name="inference-create"),
    path("inference/list", views.InferenceListView.as_view(), name="inference-list"),
    path("inference/<int:task_id>/result", views.InferenceResultView.as_view(), name="inference-result"),
    # Simulation
    path("sim/create", views.SimulationCreateView.as_view(), name="simulation-create"),
    path("sim/<int:task_id>/status", views.SimulationStatusView.as_view(), name="simulation-status"),
    path("sim/list", views.SimulationListView.as_view(), name="simulation-list"),
    path("sim/bind_device", views.BindDeviceView.as_view(), name="bind-device"),
    # Admin
    path("admin/users", views.AdminUsersView.as_view(), name="admin-users"),
    path("admin/dataset/<int:dataset_id>/review", views.AdminDatasetReviewView.as_view(), name="admin-dataset-review"),
    path("admin/overview", views.AdminOverviewView.as_view(), name="admin-overview"),
]
