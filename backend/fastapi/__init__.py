from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple


class HTTPException(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class Depends:
    def __init__(self, dependency: Callable[..., Any]) -> None:
        self.dependency = dependency


_REQUIRED = object()


class Form:
    def __init__(self, default: Any = _REQUIRED) -> None:
        self.default = default

    @property
    def required(self) -> bool:
        return self.default is _REQUIRED or self.default is ...


class File:
    def __init__(self, default: Any = _REQUIRED) -> None:
        self.default = default

    @property
    def required(self) -> bool:
        return self.default is _REQUIRED or self.default is ...


class Header:
    def __init__(self, default: Any = _REQUIRED, *, alias: Optional[str] = None) -> None:
        self.default = default
        self.alias = alias

    @property
    def required(self) -> bool:
        return self.default is _REQUIRED or self.default is ...


class UploadFile:
    def __init__(self, filename: str, content: bytes) -> None:
        self.filename = filename
        self.content = content

    def read(self) -> bytes:
        return self.content


@dataclass
class Request:
    method: str
    path: str
    headers: Dict[str, str]
    query_params: Dict[str, Any]
    json: Optional[Dict[str, Any]]
    form: Dict[str, Any]
    files: Dict[str, UploadFile]
    path_params: Dict[str, Any]


class Route:
    def __init__(self, method: str, path: str, endpoint: Callable[..., Any]) -> None:
        self.method = method
        self.path = path
        self.endpoint = endpoint
        self.segments = self._compile(path)

    @staticmethod
    def _compile(path: str) -> List[Tuple[str, Optional[str]]]:
        segments: List[Tuple[str, Optional[str]]] = []
        for segment in [s for s in path.strip("/").split("/") if s]:
            if segment.startswith("{") and segment.endswith("}"):
                segments.append(("{param}", segment[1:-1]))
            else:
                segments.append((segment, None))
        return segments

    def match(self, path: str) -> Optional[Dict[str, str]]:
        parts = [p for p in path.strip("/").split("/") if p]
        if len(parts) != len(self.segments):
            return None
        params: Dict[str, str] = {}
        for (expected, name), actual in zip(self.segments, parts):
            if name is None:
                if expected != actual:
                    return None
            else:
                params[name] = actual
        return params


class FastAPI:
    def __init__(self, title: str = "", version: str = "") -> None:
        self.title = title
        self.version = version
        self._routes: List[Route] = []

    def _add_route(self, method: str, path: str, endpoint: Callable[..., Any]) -> Callable[..., Any]:
        self._routes.append(Route(method, path, endpoint))
        return endpoint

    def get(self, path: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            return self._add_route("GET", path, func)

        return decorator

    def post(self, path: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            return self._add_route("POST", path, func)

        return decorator

    def _handle(self, method: str, path: str, request: Request) -> Any:
        for route in self._routes:
            if route.method != method:
                continue
            path_params = route.match(path)
            if path_params is None:
                continue
            request.path_params = path_params
            return self._call_endpoint(route.endpoint, request)
        raise HTTPException(404, "Not Found")

    def _call_endpoint(self, endpoint: Callable[..., Any], request: Request) -> Any:
        return self._resolve(endpoint, request)

    def _resolve(self, func: Callable[..., Any], request: Request) -> Any:
        signature = inspect.signature(func)
        kwargs: Dict[str, Any] = {}
        for name, parameter in signature.parameters.items():
            default = parameter.default
            annotation = self._normalize_annotation(parameter.annotation)
            if isinstance(default, Depends):
                value = self._resolve(default.dependency, request)
            elif isinstance(default, Header):
                header_name = (default.alias or name).replace("_", "-").lower()
                value = request.headers.get(header_name)
                if value is None:
                    if default.required:
                        raise HTTPException(401, f"Missing header: {header_name}")
                    value = default.default
                value = self._convert(value, annotation)
            elif isinstance(default, Form):
                if name in request.form:
                    value = request.form[name]
                elif default.required:
                    raise HTTPException(400, f"Missing form field: {name}")
                else:
                    value = default.default
                value = self._convert(value, annotation)
            elif isinstance(default, File):
                if name in request.files:
                    value = request.files[name]
                elif default.required:
                    raise HTTPException(400, f"Missing file: {name}")
                else:
                    value = default.default
            else:
                value = self._extract_value(name, parameter, request)
            kwargs[name] = value
        return func(**kwargs)

    def _extract_value(self, name: str, parameter: inspect.Parameter, request: Request) -> Any:
        annotation = self._normalize_annotation(parameter.annotation)
        if name in request.path_params:
            return self._convert(request.path_params[name], annotation)
        if request.method == "GET":
            if name in request.query_params:
                return self._convert(request.query_params[name], annotation)
            if parameter.default is not inspect._empty:
                return parameter.default
            raise HTTPException(400, f"Missing query parameter: {name}")
        if request.json and name in request.json:
            return self._convert(request.json[name], annotation)
        if name in request.form:
            return self._convert(request.form[name], annotation)
        if parameter.default is not inspect._empty:
            return parameter.default
        raise HTTPException(400, f"Missing body field: {name}")

    @staticmethod
    def _normalize_annotation(annotation: Any) -> Any:
        if isinstance(annotation, str):
            if annotation == "int":
                return int
            if annotation == "float":
                return float
        return annotation

    @staticmethod
    def _convert(value: Any, annotation: Any) -> Any:
        if annotation in (inspect._empty, Any) or value is None:
            return value
        if annotation is int:
            return int(value)
        if annotation is float:
            return float(value)
        return value


class Response:
    def __init__(self, status_code: int, data: Any) -> None:
        self.status_code = status_code
        self._data = data

    def json(self) -> Any:
        return self._data


class TestClient:
    __test__ = False
    def __init__(self, app: FastAPI) -> None:
        self.app = app

    def get(self, path: str, params: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None) -> Response:
        return self._request("GET", path, params=params or {}, headers=headers or {})

    def post(
        self,
        path: str,
        json: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Tuple[str, bytes, Optional[str]]]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Response:
        upload_files: Dict[str, UploadFile] = {}
        if files:
            for key, value in files.items():
                filename, content, *_ = value
                upload_files[key] = UploadFile(filename, content)
        form_data = data or {}
        return self._request(
            "POST",
            path,
            json=json,
            headers=headers or {},
            files=upload_files,
            form=form_data,
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
        files: Optional[Dict[str, UploadFile]] = None,
        form: Optional[Dict[str, Any]] = None,
    ) -> Response:
        headers = {k.lower(): v for k, v in (headers or {}).items()}
        request = Request(
            method=method,
            path=path,
            headers=headers,
            query_params=params or {},
            json=json,
            form=form or {},
            files=files or {},
            path_params={},
        )
        try:
            result = self.app._handle(method, path, request)
            return Response(200, result)
        except HTTPException as exc:
            return Response(exc.status_code, {"detail": exc.detail})

    def __enter__(self) -> "TestClient":
        return self

    def __exit__(self, *exc_info: object) -> None:
        return None
