#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: setup_nginx.sh -d <domain> -i <upstream_ip> -p <upstream_port> [-l <listen_port>]

Installs and configures Nginx as a reverse proxy in front of your app.

Required arguments:
  -d    Public domain (e.g. app.example.com)
  -i    Upstream application IP or hostname (e.g. 127.0.0.1)
  -p    Upstream application port (e.g. 3000)

Optional arguments:
  -l    Public listen port for Nginx (default: 80)

Example:
  sudo ./setup_nginx.sh -d app.example.com -i 127.0.0.1 -p 3000 -l 80
EOF
}

require_root() {
  if [[ $(id -u) -ne 0 ]]; then
    echo "[error] Run this script as root (try: sudo $0 ...)" >&2
    exit 1
  fi
}

install_nginx() {
  if ! command -v nginx >/dev/null 2>&1; then
    echo "[info] Installing Nginx..."
    apt-get update -y
    apt-get install -y nginx
  else
    echo "[info] Nginx already installed"
  fi
}

create_server_block() {
  local domain="$1"
  local listen_port="$2"
  local upstream_ip="$3"
  local upstream_port="$4"

  local config_path="/etc/nginx/sites-available/${domain}.conf"
  local enabled_path="/etc/nginx/sites-enabled/${domain}.conf"

  cat >"${config_path}" <<EOF
server {
    listen ${listen_port};
    server_name ${domain};

    access_log /var/log/nginx/${domain}_access.log;
    error_log /var/log/nginx/${domain}_error.log;

    location / {
        proxy_pass http://${upstream_ip}:${upstream_port};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "upgrade";
    }
}
EOF

  ln -sf "${config_path}" "${enabled_path}"
}

reload_nginx() {
  echo "[info] Validating config"
  nginx -t
  echo "[info] Reloading Nginx"
  systemctl reload nginx
}

main() {
  local domain=""
  local upstream_ip=""
  local upstream_port=""
  local listen_port="80"

  while getopts ":d:i:p:l:h" opt; do
    case "${opt}" in
      d) domain="${OPTARG}" ;;
      i) upstream_ip="${OPTARG}" ;;
      p) upstream_port="${OPTARG}" ;;
      l) listen_port="${OPTARG}" ;;
      h) usage; exit 0 ;;
      *) usage; exit 1 ;;
    esac
  done

  if [[ -z "${domain}" || -z "${upstream_ip}" || -z "${upstream_port}" ]]; then
    usage
    exit 1
  fi

  require_root
  install_nginx
  create_server_block "${domain}" "${listen_port}" "${upstream_ip}" "${upstream_port}"
  reload_nginx

  echo "[done] Nginx now proxies ${domain}:${listen_port} -> http://${upstream_ip}:${upstream_port}"
}

main "$@"
