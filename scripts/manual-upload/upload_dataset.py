#!/usr/bin/env python3
"""Upload a RobotCloud dataset archive from the command line."""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict

import requests


DEFAULT_API_BASE = "https://h20.conductor-ai.top:6150/api/v1"
DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024


class UploadError(RuntimeError):
    pass


def api_url(api_base: str, path: str) -> str:
    return f"{api_base.rstrip('/')}/{path.lstrip('/')}"


def load_json_response(response: requests.Response) -> Dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise UploadError(response.text.strip() or f"HTTP {response.status_code}") from exc
    if not isinstance(payload, dict):
        raise UploadError("Invalid JSON response")
    return payload


def response_data(response: requests.Response) -> Dict[str, Any]:
    payload = load_json_response(response)
    if response.status_code >= 400:
        raise UploadError(str(payload.get("detail") or payload.get("message") or f"HTTP {response.status_code}"))
    if isinstance(payload.get("code"), int):
        if payload.get("code") != 0:
            raise UploadError(str(payload.get("detail") or payload.get("message") or "Request failed"))
        data = payload.get("data")
        return data if isinstance(data, dict) else {}
    return payload


def api_request(
    http: requests.Session,
    method: str,
    api_base: str,
    path: str,
    token: str | None = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    headers = dict(kwargs.pop("headers", {}) or {})
    if token:
        headers.setdefault("Authorization", f"Bearer {token}")
    response = http.request(method, api_url(api_base, path), headers=headers, **kwargs)
    return response_data(response)


def login(http: requests.Session, api_base: str, phone: str, password: str, timeout: int) -> str:
    data = api_request(
        http,
        "POST",
        api_base,
        "/auth/login",
        json={
            "phone": phone,
            "password": password,
            "device_id": "robotcloud-cli",
            "device_type": "desktop",
            "replace_existing_device": True,
        },
        timeout=timeout,
    )
    token = str(data.get("token") or "")
    if not token:
        raise UploadError("Login response did not include a token")
    return token


def content_type(path: Path) -> str:
    suffixes = [suffix.lower() for suffix in path.suffixes]
    if suffixes and suffixes[-1] == ".zip":
        return "application/zip"
    if ".tar" in suffixes or (suffixes and suffixes[-1] in {".gz", ".tgz"}):
        return "application/gzip"
    return "application/octet-stream"


def print_progress(uploaded: int, total: int) -> None:
    percent = int((uploaded / total) * 100) if total else 100
    sys.stderr.write(f"\rUploaded {uploaded}/{total} bytes ({percent}%)")
    sys.stderr.flush()


def agent_endpoint(session: Dict[str, Any], kind: str) -> str:
    explicit = session.get(f"{kind}_url")
    if explicit:
        return str(explicit)
    return f"{str(session['upload_url']).rstrip('/')}/{kind}"


def agent_headers(session: Dict[str, Any]) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {session['upload_token']}",
        "X-Dataset-Id": str(session["dataset_id"]),
        "X-Filename": str(session["file_name"]),
    }


def load_session_file(path: Path, archive: Path, args: argparse.Namespace) -> Dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    expected = {
        "archive": str(archive.resolve()),
        "size": archive.stat().st_size,
        "mtime_ns": archive.stat().st_mtime_ns,
        "name": args.name,
        "description": args.description,
        "visibility": args.visibility,
        "target_node": args.target_node or "",
        "api_base": args.api_base.rstrip("/"),
    }
    if state.get("input") == expected and isinstance(state.get("session"), dict):
        return state["session"]
    return None


def write_session_file(path: Path, archive: Path, args: argparse.Namespace, session: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    state = {
        "input": {
            "archive": str(archive.resolve()),
            "size": archive.stat().st_size,
            "mtime_ns": archive.stat().st_mtime_ns,
            "name": args.name,
            "description": args.description,
            "visibility": args.visibility,
            "target_node": args.target_node or "",
            "api_base": args.api_base.rstrip("/"),
        },
        "session": session,
    }
    path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def upload_via_agent(http: requests.Session, args: argparse.Namespace, token: str, archive: Path) -> Dict[str, Any]:
    session_file = Path(args.session_file).expanduser() if args.session_file else None
    session = load_session_file(session_file, archive, args) if session_file else None
    if not session:
        session = api_request(
            http,
            "POST",
            args.api_base,
            "/dataset/upload_session",
            token=token,
            json={
                "name": args.name,
                "description": args.description,
                "visibility": args.visibility,
                "filename": archive.name,
                "target_node": args.target_node or "",
            },
            timeout=args.timeout,
        )
        if session_file:
            write_session_file(session_file, archive, args, session)

    total_size = archive.stat().st_size
    headers = agent_headers(session)
    status = response_data(
        http.get(agent_endpoint(session, "status"), headers=headers, timeout=args.timeout)
    )
    uploaded = min(max(int(status.get("uploaded_bytes") or 0), 0), total_size)
    chunk_size = max(int(args.chunk_size or session.get("chunk_size") or DEFAULT_CHUNK_SIZE), 1024 * 1024)

    with archive.open("rb") as source:
        source.seek(uploaded)
        print_progress(uploaded, total_size)
        while uploaded < total_size:
            start = uploaded
            chunk = source.read(min(chunk_size, total_size - uploaded))
            if not chunk:
                raise UploadError("Archive ended before expected size")
            end = start + len(chunk) - 1
            chunk_headers = {
                **headers,
                "Content-Type": content_type(archive),
                "Content-Range": f"bytes {start}-{end}/{total_size}",
                "X-File-Size": str(total_size),
            }
            last_error: Exception | None = None
            for attempt in range(1, args.retries + 1):
                try:
                    result = response_data(
                        http.put(
                            agent_endpoint(session, "chunk"),
                            headers=chunk_headers,
                            data=chunk,
                            timeout=args.timeout,
                        )
                    )
                    uploaded = max(int(result.get("uploaded_bytes") or end + 1), end + 1)
                    source.seek(uploaded)
                    print_progress(uploaded, total_size)
                    break
                except Exception as exc:  # noqa: BLE001 - surface the final HTTP error with context
                    last_error = exc
                    time.sleep(min(attempt, 5))
                    status = response_data(
                        http.get(agent_endpoint(session, "status"), headers=headers, timeout=args.timeout)
                    )
                    remote_uploaded = min(max(int(status.get("uploaded_bytes") or 0), 0), total_size)
                    if remote_uploaded > start:
                        uploaded = remote_uploaded
                        source.seek(uploaded)
                        print_progress(uploaded, total_size)
                        break
            else:
                raise UploadError(f"Chunk upload failed after {args.retries} attempts: {last_error}")

    completed = response_data(
        http.post(
            agent_endpoint(session, "complete"),
            headers={**headers, "X-File-Size": str(total_size)},
            timeout=args.timeout,
        )
    )
    sys.stderr.write("\n")
    if session_file:
        try:
            session_file.unlink()
        except OSError:
            pass
    return completed


def upload_via_backend(http: requests.Session, args: argparse.Namespace, token: str, archive: Path) -> Dict[str, Any]:
    with archive.open("rb") as source:
        response = http.post(
            api_url(args.api_base, "/dataset/upload"),
            headers={"Authorization": f"Bearer {token}"},
            data={
                "name": args.name,
                "description": args.description,
                "visibility": args.visibility,
            },
            files={"file": (archive.name, source, content_type(archive))},
            timeout=args.timeout,
        )
    return response_data(response)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Upload a local zip/tar dataset to RobotCloud.")
    parser.add_argument("archive", help="Path to the local dataset archive, for example dataset.zip")
    parser.add_argument("--api-base", default=os.getenv("ROBOTCLOUD_API_BASE") or os.getenv("PUBLIC_API_BASE_URL") or DEFAULT_API_BASE)
    parser.add_argument("--token", default=os.getenv("ROBOTCLOUD_TOKEN"), help="RobotCloud bearer token")
    parser.add_argument("--phone", default=os.getenv("ROBOTCLOUD_PHONE"), help="Login phone, used when --token is omitted")
    parser.add_argument("--password", default=os.getenv("ROBOTCLOUD_PASSWORD"), help="Login password, used when --token is omitted")
    parser.add_argument("--name", help="Dataset name, default: archive file stem")
    parser.add_argument("--description", default="")
    parser.add_argument("--visibility", choices=["private", "public"], default="private")
    parser.add_argument("--target-node", default="", help="GPU agent node name for agent uploads")
    parser.add_argument("--mode", choices=["agent", "backend"], default="agent")
    parser.add_argument("--chunk-size", type=int, default=0, help="Override agent chunk size in bytes")
    parser.add_argument("--session-file", default="", help="Optional JSON file for resuming the same agent upload session")
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args(argv)
    archive = Path(args.archive).expanduser()
    if not archive.exists() or not archive.is_file():
        parser.error(f"archive not found: {archive}")
    args.archive = str(archive)
    args.name = args.name or archive.stem
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    archive = Path(args.archive).expanduser()
    http = requests.Session()
    token = args.token
    try:
        if not token:
            if not args.phone or not args.password:
                raise UploadError("Provide --token or both --phone and --password")
            token = login(http, args.api_base, args.phone, args.password, args.timeout)
        if args.mode == "agent":
            result = upload_via_agent(http, args, token, archive)
        else:
            result = upload_via_backend(http, args, token, archive)
    except UploadError as exc:
        print(f"Upload failed: {exc}", file=sys.stderr)
        return 1
    except requests.RequestException as exc:
        print(f"Upload failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
