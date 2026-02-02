"""API routing for RobotCloud endpoints."""
from __future__ import annotations

from django.urls import path

from . import views

urlpatterns = [
    # Authentication
    path("auth/send_code", views.SendCodeView.as_view(), name="auth-send-code"),
    path("auth/register", views.RegisterView.as_view(), name="auth-register"),

    path("auth/login", views.LoginView.as_view(), name="auth-login"),
    path("auth/login_code", views.LoginWithCodeView.as_view(), name="auth-login-code"),
    path("auth/verify_token", views.VerifyTokenView.as_view(), name="auth-verify-token"),
    # User
    path("user/profile", views.ProfileView.as_view(), name="user-profile"),
    path("user/upgrade", views.UpgradeView.as_view(), name="user-upgrade"),
    path("user/usage", views.UsageView.as_view(), name="user-usage"),
    # Payment
    path("payment/create", views.PaymentCreateView.as_view(), name="payment-create"),
    path("payment/callback/mock", views.PaymentMockCallbackView.as_view(), name="payment-callback-mock"),
    path("payment/alipay/notify", views.AlipayNotifyView.as_view(), name="payment-alipay-notify"),
    path("payment/alipay/query/<str:payment_id>", views.AlipayQueryView.as_view(), name="payment-alipay-query"),
    path("payment/<str:payment_id>", views.PaymentStatusView.as_view(), name="payment-status"),
    # Dashboard
    path("dashboard/summary", views.DashboardSummaryView.as_view(), name="dashboard-summary"),
    # Dataset
    path("dataset/upload", views.DatasetUploadView.as_view(), name="dataset-upload"),
    path("dataset/list", views.DatasetListView.as_view(), name="dataset-list"),
    path("dataset/<int:dataset_id>", views.DatasetDetailView.as_view(), name="dataset-detail"),
    path("dataset/<int:dataset_id>/stats", views.DatasetStatsView.as_view(), name="dataset-stats"),
    path("dataset/<int:dataset_id>/preview", views.DatasetPreviewView.as_view(), name="dataset-preview"),
    path("dataset/<int:dataset_id>/delete", views.DatasetDeleteView.as_view(), name="dataset-delete"),
    # Training
    path("training/create", views.TrainingCreateView.as_view(), name="training-create"),
    path("training/list", views.TrainingListView.as_view(), name="training-list"),
    path("training/<int:task_id>/status", views.TrainingStatusView.as_view(), name="training-status"),
    path("training/<int:task_id>/stop", views.TrainingStopView.as_view(), name="training-stop"),
    path("training/<int:task_id>/download", views.TrainingDownloadView.as_view(), name="training-download"),
    path("training/<int:task_id>/logs", views.TrainingLogsView.as_view(), name="training-logs"),
    path("training/<int:task_id>/delete", views.TrainingDeleteView.as_view(), name="training-delete"),
    # Internal Scheduler
    path("internal/agent/register", views.AgentRegisterView.as_view(), name="agent-register"),
    path("internal/agent/heartbeat", views.AgentHeartbeatView.as_view(), name="agent-heartbeat"),
    path("internal/training/update", views.AgentTrainingUpdateView.as_view(), name="agent-training-update"),
    path("internal/inference/update", views.AgentInferenceUpdateView.as_view(), name="agent-inference-update"),
    # Inference
    path("inference/create", views.InferenceCreateView.as_view(), name="inference-create"),
    path("inference/list", views.InferenceListView.as_view(), name="inference-list"),
    path("inference/<int:task_id>/result", views.InferenceResultView.as_view(), name="inference-result"),
    path("inference/<int:task_id>/logs", views.InferenceLogsView.as_view(), name="inference-logs"),
    path("inference/<int:task_id>/delete", views.InferenceDeleteView.as_view(), name="inference-delete"),
    # Simulation
    path("sim/create", views.SimulationCreateView.as_view(), name="simulation-create"),
    path("sim/<int:task_id>/status", views.SimulationStatusView.as_view(), name="simulation-status"),
    path("sim/list", views.SimulationListView.as_view(), name="simulation-list"),
    path("sim/bind_device", views.BindDeviceView.as_view(), name="bind-device"),
    # Admin
    path("admin/users", views.AdminUsersView.as_view(), name="admin-users"),
    path("admin/dataset/<int:dataset_id>/review", views.AdminDatasetReviewView.as_view(), name="admin-dataset-review"),
    path("admin/overview", views.AdminOverviewView.as_view(), name="admin-overview"),
    # Model
    path("model/list", views.ModelListView.as_view(), name="model-list"),
    path("model/<int:model_id>", views.ModelDetailView.as_view(), name="model-detail"),
    path("model/<int:model_id>/delete", views.ModelDeleteView.as_view(), name="model-delete"),
]
