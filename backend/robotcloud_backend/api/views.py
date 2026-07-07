"""Django REST views implementing the RobotCloud API."""
from __future__ import annotations

from typing import Callable, Dict

from rest_framework import status
from rest_framework.parsers import JSONParser, MultiPartParser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from ..build_info import get_backend_build_info
from ..sms import SmsGateway, get_default_sms_gateway
from .services import RobotCloudService


_sms_gateway: SmsGateway = get_default_sms_gateway()
_service: RobotCloudService | None = None


def set_sms_gateway_for_tests(gateway: SmsGateway) -> None:
    """Allow tests to override the SMS gateway and reset the service cache."""
    global _sms_gateway, _service
    _sms_gateway = gateway
    _service = None


def reset_service_cache() -> None:
    global _service
    _service = None


def get_service() -> RobotCloudService:
    global _service
    if _service is None:
        _service = RobotCloudService(sms_gateway=_sms_gateway)
    return _service


class RobotCloudAPIView(APIView):
    """Base APIView with shared helpers."""

    def _service(self) -> RobotCloudService:
        return get_service()

    def _execute(self, action: Callable[[], Dict]) -> Response:
        try:
            payload = action()
            return Response(payload, status=status.HTTP_200_OK)
        except ValueError as exc:
            return Response(self._error_payload(str(exc)), status=status.HTTP_400_BAD_REQUEST)
        except PermissionError as exc:
            return Response(self._error_payload(str(exc)), status=status.HTTP_403_FORBIDDEN)

    def _error_payload(self, message: str) -> Dict[str, object]:
        return {"code": 1, "message": message, "detail": message}

    def _get_token(self, request: Request) -> str:
        header = request.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise ValueError("Invalid Authorization header")
        return token

    def _execute_with_token(self, request: Request, handler: Callable[[str], Dict]) -> Response:
        return self._execute(lambda: handler(self._get_token(request)))

    def _query_int(self, request: Request, name: str, default: int, minimum: int = 1, maximum: int = 1000) -> int:
        raw = request.query_params.get(name, default)
        try:
            value = int(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{name} must be an integer") from exc
        if value < minimum:
            raise ValueError(f"{name} must be at least {minimum}")
        if value > maximum:
            raise ValueError(f"{name} must be at most {maximum}")
        return value

    def _get_agent_token(self, request: Request) -> str:
        token = request.headers.get("X-Agent-Token", "")
        if not token:
            header = request.headers.get("Authorization", "")
            _, _, value = header.partition(" ")
            token = value
        if not token:
            raise ValueError("Agent token required")
        return token

    def _bool_value(self, value: object, default: bool = False) -> bool:
        if value is None:
            return default
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() not in {"0", "false", "no", "off"}
        return bool(value)


class VersionView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute(lambda: {"code": 0, "message": "success", "data": get_backend_build_info()})


class SendCodeView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        phone = request.data.get("phone", "")
        return self._execute(lambda: self._service().send_code(phone))


class RegisterView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute(
            lambda: self._service().register(
                payload.get("phone", ""),
                payload.get("password", ""),
                payload.get("code", ""),
            )
        )


class LoginView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute(
            lambda: self._service().login(
                payload.get("phone", ""),
                payload.get("password", ""),
                payload.get("device_id", ""),
                payload.get("device_type", ""),
                request.headers.get("User-Agent", ""),
                self._bool_value(payload.get("replace_existing_device")),
            )
        )


class LoginWithCodeView(RobotCloudAPIView):
    """Login or register with SMS verification code."""
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute(
            lambda: self._service().login_with_code(
                payload.get("phone", ""),
                payload.get("code", ""),
                payload.get("device_id", ""),
                payload.get("device_type", ""),
                request.headers.get("User-Agent", ""),
                self._bool_value(payload.get("replace_existing_device")),
            )
        )


class LogoutView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        return self._execute_with_token(request, lambda token: self._service().logout(token))


class VerifyTokenView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute_with_token(request, lambda token: self._service().verify_token(token))


class ProfileView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute_with_token(request, lambda token: self._service().profile(token))


class UpgradeView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute_with_token(
            request,
            lambda token: self._service().upgrade(token, payload.get("target_role", ""), payload.get("payment_id", "")),
        )


class PaymentCreateView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        base_url = request.build_absolute_uri("/").rstrip("/")
        return self._execute_with_token(
            request,
            lambda token: self._service().create_payment(
                token, payload.get("target_role", ""), payload.get("provider", "alipay"), base_url
            ),
        )


class PaymentStatusView(RobotCloudAPIView):
    def get(self, request: Request, payment_id: str) -> Response:
        return self._execute_with_token(request, lambda token: self._service().payment_status(token, payment_id))


class PaymentMockCallbackView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute_with_token(
            request,
            lambda token: self._service().mock_payment_callback(
                token,
                payload.get("payment_id", ""),
                payload.get("status", "succeeded"),
            ),
        )


class AlipayNotifyView(RobotCloudAPIView):
    """Handle Alipay async notification callback."""
    parser_classes = [JSONParser, MultiPartParser]

    def post(self, request: Request) -> Response:
        data = {}
        if hasattr(request.data, "items"):
            for key, value in request.data.items():
                data[key] = str(value) if value else ""
        else:
            data = dict(request.data)

        success = self._service().alipay_notify(data)
        from django.http import HttpResponse
        return HttpResponse("success" if success else "failure", content_type="text/plain")


class AlipayQueryView(RobotCloudAPIView):
    """Query Alipay order status."""

    def get(self, request: Request, payment_id: str) -> Response:
        return self._execute_with_token(request, lambda token: self._service().alipay_query(token, payment_id))


class UsageView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute_with_token(request, lambda token: self._service().usage(token))


class UserSettingsView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def get(self, request: Request) -> Response:
        return self._execute_with_token(request, lambda token: self._service().user_settings(token))

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute_with_token(
            request,
            lambda token: self._service().update_user_settings(token, payload.get("default_agent_node", "")),
        )


class DashboardSummaryView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute_with_token(request, lambda token: self._service().dashboard_summary(token))


class AgentsActiveView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute_with_token(request, lambda token: self._service().list_active_agents(token))


class DatasetUploadView(RobotCloudAPIView):
    parser_classes = [MultiPartParser]

    def post(self, request: Request) -> Response:
        name = request.data.get("name", "")
        description = request.data.get("description", "")
        visibility = request.data.get("visibility", "private")
        uploaded = request.data.get("file")
        return self._execute_with_token(
            request,
            lambda token: self._service().upload_dataset(token, uploaded, name, description, visibility),
        )


class DatasetUploadSessionView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute_with_token(
            request,
            lambda token: self._service().create_dataset_upload_session(
                token,
                payload.get("name", ""),
                payload.get("description", ""),
                payload.get("visibility", "private"),
                payload.get("filename", ""),
                payload.get("target_node", "") or "",
            ),
        )


class DatasetListView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        visibility = request.query_params.get("visibility")
        return self._execute_with_token(
            request,
            lambda token: self._service().list_datasets(
                token,
                visibility,
                self._query_int(request, "page", 1),
                self._query_int(request, "size", 20, maximum=100),
            ),
        )


class DatasetDetailView(RobotCloudAPIView):
    def get(self, request: Request, dataset_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().get_dataset(token, dataset_id))


class DatasetStatsView(RobotCloudAPIView):
    def get(self, request: Request, dataset_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().dataset_stats(token, dataset_id))


class DatasetPreviewView(RobotCloudAPIView):
    def get(self, request: Request, dataset_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().dataset_preview(token, dataset_id))


class DatasetDeleteView(RobotCloudAPIView):
    def post(self, request: Request, dataset_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().delete_dataset(token, dataset_id))


class TrainingCreateView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute_with_token(
            request,
            lambda token: self._service().create_training_task(
                token,
                payload.get("dataset_id"),
                payload.get("model_type", ""),
                payload.get("params", {}) or {},
            ),
        )


class TrainingListView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute_with_token(
            request,
            lambda token: self._service().list_training_tasks(
                token,
                self._query_int(request, "page", 1),
                self._query_int(request, "size", 20, maximum=100),
            ),
        )


class TrainingStatusView(RobotCloudAPIView):
    def get(self, request: Request, task_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().training_status(token, task_id))


class TrainingStopView(RobotCloudAPIView):
    def post(self, request: Request, task_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().stop_training(token, task_id))


class TrainingDownloadView(RobotCloudAPIView):
    def get(self, request: Request, task_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().download_model(token, task_id))


class TrainingLogsView(RobotCloudAPIView):
    def get(self, request: Request, task_id: int) -> Response:
        return self._execute_with_token(
            request,
            lambda token: self._service().training_logs(
                token,
                task_id,
                self._query_int(request, "offset", 0, minimum=0),
                self._query_int(request, "limit", 65536, minimum=1, maximum=1048576),
            ),
        )


class TrainingDeleteView(RobotCloudAPIView):
    def post(self, request: Request, task_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().delete_training_task(token, task_id))


class AgentRegisterView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute(
            lambda: self._service().register_agent(
                payload.get("node_name", ""),
                payload.get("ip", ""),
                int(payload.get("gpu_total", 0) or 0),
                payload.get("version", "") or "",
                int(payload.get("port", 5000) or 5000),
                payload.get("public_base_url", "") or "",
                self._bool_value(payload.get("upload_enabled"), True),
            )
        )


class InternalDatasetUploadVerifyView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        token = self._get_agent_token(request)
        return self._execute(
            lambda: self._service().verify_dataset_upload(
                token,
                int(payload.get("dataset_id", 0) or 0),
                payload.get("upload_token", ""),
            )
        )


class InternalDatasetUploadCompleteView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        token = self._get_agent_token(request)
        return self._execute(
            lambda: self._service().complete_dataset_upload(
                token,
                int(payload.get("dataset_id", 0) or 0),
                payload.get("upload_token", ""),
                payload.get("storage_path", ""),
                payload.get("content_md5", ""),
                int(payload.get("file_size", 0) or 0),
                payload.get("metadata") or {},
            )
        )


class AgentHeartbeatView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        token = self._get_agent_token(request)
        return self._execute(
            lambda: self._service().agent_heartbeat(
                token,
                int(payload.get("gpu_total", 0) or 0),
                payload.get("gpu_free"),
                payload.get("gpu_busy"),
                payload.get("version"),
            )
        )


class AgentTrainingUpdateView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        token = self._get_agent_token(request)

        def action() -> Dict:
            task_id = payload.get("task_id")
            if task_id is None:
                raise ValueError("task_id required")
            return self._service().agent_update_training(
                token,
                int(task_id),
                payload.get("status", ""),
                payload.get("progress"),
                payload.get("metrics") or {},
            )

        return self._execute(action)


class AgentInferenceUpdateView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        token = self._get_agent_token(request)

        def action() -> Dict:
            task_id = payload.get("task_id")
            if task_id is None:
                raise ValueError("task_id required")
            return self._service().agent_update_inference(
                token,
                int(task_id),
                payload.get("status", ""),
                payload.get("progress"),
                payload.get("server_host"),
                payload.get("server_port"),
                payload.get("error_message"),
            )

        return self._execute(action)


class InferenceCreateView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute_with_token(
            request,
            lambda token: self._service().create_inference_task(
                token,
                payload.get("model_id"),
                payload.get("dataset_id"),
            ),
        )


class InferenceListView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute_with_token(
            request,
            lambda token: self._service().list_inference_tasks(
                token,
                self._query_int(request, "page", 1),
                self._query_int(request, "size", 20, maximum=100),
            ),
        )


class InferenceResultView(RobotCloudAPIView):
    def get(self, request: Request, task_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().inference_result(token, task_id))


class InferenceLogsView(RobotCloudAPIView):
    def get(self, request: Request, task_id: int) -> Response:
        return self._execute_with_token(
            request,
            lambda token: self._service().inference_logs(
                token,
                task_id,
                self._query_int(request, "offset", 0, minimum=0),
                self._query_int(request, "limit", 65536, minimum=1, maximum=1048576),
            ),
        )


class InferenceCloseView(RobotCloudAPIView):
    def post(self, request: Request, task_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().close_inference_task(token, task_id))


class InferenceDeleteView(RobotCloudAPIView):
    def post(self, request: Request, task_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().delete_inference_task(token, task_id))


class SimulationCreateView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute_with_token(
            request,
            lambda token: self._service().create_simulation_task(
                token,
                payload.get("scene_file", ""),
                payload.get("model_id"),
                payload.get("robot_type", ""),
                payload.get("training_mode", ""),
            ),
        )


class SimulationStatusView(RobotCloudAPIView):
    def get(self, request: Request, task_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().simulation_status(token, task_id))


class SimulationListView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute_with_token(
            request,
            lambda token: self._service().list_simulation_tasks(
                token,
                self._query_int(request, "page", 1),
                self._query_int(request, "size", 20, maximum=100),
            ),
        )


class BindDeviceView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request) -> Response:
        payload = request.data
        return self._execute_with_token(
            request,
            lambda token: self._service().bind_device(token, payload.get("device_sn", ""), payload.get("model_id")),
        )


class AdminUsersView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        role = request.query_params.get("role")
        return self._execute_with_token(
            request,
            lambda token: self._service().admin_users(token, self._query_int(request, "page", 1), role),
        )


class AdminDatasetReviewView(RobotCloudAPIView):
    parser_classes = [JSONParser]

    def post(self, request: Request, dataset_id: int) -> Response:
        payload = request.data
        return self._execute_with_token(
            request,
            lambda token: self._service().admin_review_dataset(token, dataset_id, payload.get("status", "")),
        )


class AdminOverviewView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute_with_token(request, lambda token: self._service().admin_overview(token))


class ModelListView(RobotCloudAPIView):
    def get(self, request: Request) -> Response:
        return self._execute_with_token(
            request,
            lambda token: self._service().list_models(
                token,
                self._query_int(request, "page", 1),
                self._query_int(request, "size", 20, maximum=100),
            ),
        )


class ModelDetailView(RobotCloudAPIView):
    def get(self, request: Request, model_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().get_model(token, model_id))


class ModelDeleteView(RobotCloudAPIView):
    def post(self, request: Request, model_id: int) -> Response:
        return self._execute_with_token(request, lambda token: self._service().delete_model(token, model_id))
