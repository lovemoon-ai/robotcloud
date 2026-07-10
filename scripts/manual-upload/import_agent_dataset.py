#!/usr/bin/env python3
"""Register a dataset archive that already exists on a GPU agent machine."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Dict

import requests


DEFAULT_API_BASE = "https://h20.conductor-ai.top:6150/api/v1"


class DatasetImportError(RuntimeError):
    pass


def api_url(api_base: str, path: str) -> str:
    return f"{api_base.rstrip('/')}/{path.lstrip('/')}"


def load_json_response(response: requests.Response) -> Dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise DatasetImportError(response.text.strip() or f"HTTP {response.status_code}") from exc
    if not isinstance(payload, dict):
        raise DatasetImportError("Invalid JSON response")
    return payload


def response_data(response: requests.Response) -> Dict[str, Any]:
    payload = load_json_response(response)
    if response.status_code >= 400:
        raise DatasetImportError(str(payload.get("detail") or payload.get("message") or f"HTTP {response.status_code}"))
    if isinstance(payload.get("code"), int):
        if payload.get("code") != 0:
            raise DatasetImportError(str(payload.get("detail") or payload.get("message") or "Request failed"))
        data = payload.get("data")
        return data if isinstance(data, dict) else {}
    return payload


def api_request(
    http: requests.Session,
    method: str,
    api_base: str,
    path: str,
    token: str,
    **kwargs: Any,
) -> Dict[str, Any]:
    headers = dict(kwargs.pop("headers", {}) or {})
    headers.setdefault("Authorization", f"Bearer {token}")
    response = http.request(method, api_url(api_base, path), headers=headers, **kwargs)
    return response_data(response)


def remote_basename(path: str) -> str:
    stripped = path.strip().rstrip("/\\")
    return PurePosixPath(stripped).name or PureWindowsPath(stripped).name


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


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import a dataset zip/tar already present on the selected GPU agent."
    )
    parser.add_argument("agent_path", help="Absolute path on the GPU agent machine, for example /data/dataset.zip")
    parser.add_argument(
        "--api-base",
        default=os.getenv("ROBOTCLOUD_API_BASE") or os.getenv("PUBLIC_API_BASE_URL") or DEFAULT_API_BASE,
    )
    parser.add_argument("--token", default=os.getenv("ROBOTCLOUD_TOKEN"), help="RobotCloud bearer token")
    parser.add_argument("--name", help="Dataset name, default: remote archive file stem")
    parser.add_argument("--description", default="")
    parser.add_argument("--visibility", choices=["private", "public"], default="private")
    parser.add_argument("--target-node", default="", help="GPU agent node name that can read agent_path")
    parser.add_argument("--filename", help="Dataset archive filename stored in RobotCloud, default: basename of agent_path")
    parser.add_argument("--file-size", type=int, default=0, help="Optional expected byte size checked by the agent")
    parser.add_argument("--timeout", type=int, default=120)
    args = parser.parse_args(argv)
    if not args.token:
        parser.error("Provide --token or export ROBOTCLOUD_TOKEN")
    if not args.agent_path.strip():
        parser.error("agent_path is required")
    filename = args.filename or remote_basename(args.agent_path)
    if not filename:
        parser.error("Could not infer filename from agent_path; pass --filename")
    args.filename = filename
    args.name = args.name or Path(filename).stem
    return args


def import_agent_dataset(http: requests.Session, args: argparse.Namespace) -> Dict[str, Any]:
    session = api_request(
        http,
        "POST",
        args.api_base,
        "/dataset/upload_session",
        token=args.token,
        json={
            "name": args.name,
            "description": args.description,
            "visibility": args.visibility,
            "filename": args.filename,
            "target_node": args.target_node or "",
        },
        timeout=args.timeout,
    )
    payload: Dict[str, Any] = {"source_path": args.agent_path}
    if args.file_size > 0:
        payload["file_size"] = args.file_size
    return response_data(
        http.post(
            agent_endpoint(session, "import"),
            headers={**agent_headers(session), "Content-Type": "application/json"},
            json=payload,
            timeout=args.timeout,
        )
    )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    http = requests.Session()
    try:
        result = import_agent_dataset(http, args)
    except DatasetImportError as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        return 1
    except requests.RequestException as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
