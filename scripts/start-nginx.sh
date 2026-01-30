#!/usr/bin/env bash
set -euo pipefail

if command -v nginx >/dev/null 2>&1; then
  echo "nginx already installed"
else
  echo "nginx not found; attempting install"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      brew install nginx
    else
      echo "Homebrew not found; install nginx manually" >&2
      exit 1
    fi
  elif [[ -f /etc/os-release ]]; then
    . /etc/os-release
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update
      sudo apt-get install -y nginx
    elif command -v dnf >/dev/null 2>&1; then
      sudo dnf install -y nginx
    elif command -v yum >/dev/null 2>&1; then
      sudo yum install -y nginx
    elif command -v apk >/dev/null 2>&1; then
      sudo apk add --no-cache nginx
    else
      echo "No supported package manager found; install nginx manually" >&2
      exit 1
    fi
  else
    echo "Unsupported OS; install nginx manually" >&2
    exit 1
  fi
fi

if command -v nginx >/dev/null 2>&1; then
  if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl enable nginx || true
    sudo systemctl start nginx
  elif command -v service >/dev/null 2>&1; then
    sudo service nginx start
  elif [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    brew services start nginx
  else
    sudo nginx
  fi

  sudo nginx -t
  echo "nginx started"
fi
