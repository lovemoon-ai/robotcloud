#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 PORT" >&2
    exit 1
fi

port="$1"

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

read -r -p "Kill these processes? [y/N] " response
case "${response}" in
    [yY][eE][sS]|[yY])
        for pid in ${pids}; do
            if kill "${pid}"; then
                echo "Killed PID ${pid}."
            else
                echo "Failed to kill PID ${pid}." >&2
            fi
        done
        ;;
    *)
        echo "Abort."
        ;;
esac
