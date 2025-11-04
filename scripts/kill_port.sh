#!/usr/bin/env bash
set -euo pipefail

force=0
port=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -f|--force)
            force=1
            shift
            ;;
        -*)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
        *)
            if [[ -n "$port" ]]; then
                echo "Multiple ports specified: $port and $1" >&2
                exit 1
            fi
            port="$1"
            shift
            ;;
    esac
done

if [[ -z "$port" ]]; then
    echo "Usage: $0 [-f|--force] PORT" >&2
    exit 1
fi

if ! command -v lsof >/dev/null 2>&1; then
    echo "Error: lsof is required but not available on PATH." >&2
    exit 1
fi

pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)

if [[ -z "${pids}" ]]; then
    echo "No process is listening on port ${port}."
    exit 0
fi

echo "Processes listening on port ${port}:"
lsof -nP -iTCP:"${port}" -sTCP:LISTEN

if [[ "${force}" -eq 0 ]]; then
    read -r -p "Kill these processes? [y/N] " response
    case "${response}" in
        [yY][eE][sS]|[yY])
            force=1
            ;;
        *)
            echo "Abort."
            exit 0
            ;;
    esac
fi

if [[ "${force}" -eq 1 ]]; then
    for pid in ${pids}; do
        if kill "${pid}"; then
            echo "Killed PID ${pid}."
        else
            echo "Failed to kill PID ${pid}." >&2
        fi
    done
fi
