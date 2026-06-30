#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  sudo ./scripts/configure_domain_proxy.sh \
    --domain app.example.com \
    --service-port 6151 \
    [--service-host 127.0.0.1] \
    [--listen-port 80] \
    [--email admin@example.com]

Options:
  --domain        Public domain that already points to this server (required)
  --service-port  Local port where your app listens (required)
  --service-host  Local upstream hostname/IP (default: 127.0.0.1)
  --listen-port   Public port to expose via the domain (default: 80)
  --email         Request/renew Let's Encrypt TLS via certbot with this email
  -h, --help      Show this message

Example:
  sudo ./scripts/configure_domain_proxy.sh \
    --domain portal.robotcloud.ai \
    --service-port 6151 \
    --email ops@robotcloud.ai
EOF
}

require_root() {
  if [[ $(id -u) -ne 0 ]]; then
    echo "[error] Run this script as root (hint: sudo $0 ...)" >&2
    exit 1
  fi
}

ensure_package() {
  local pkg="$1"
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    echo "[info] Installing $pkg..."
    apt-get update -y
    DEBIAN_FRONTEND=noninteractive apt-get install -y "$pkg"
  fi
}

ensure_nginx() {
  if ! command -v nginx >/dev/null 2>&1; then
    ensure_package nginx
  fi
}

ensure_certbot() {
  ensure_package certbot
  ensure_package python3-certbot-nginx
}

resolve_domain_ip() {
  local domain="$1"
  getent ahostsv4 "$domain" | awk 'NR==1 {print $1; exit 0}'
}

primary_server_ip() {
  hostname -I | awk '{print $1}'
}

create_server_block() {
  local domain="$1"
  local listen_port="$2"
  local upstream_host="$3"
  local upstream_port="$4"

  local config_path="/etc/nginx/sites-available/${domain}_${listen_port}.conf"
  local enabled_path="/etc/nginx/sites-enabled/${domain}_${listen_port}.conf"

  cat >"$config_path" <<EOF
server {
    listen ${listen_port};
    server_name ${domain};

    access_log /var/log/nginx/${domain}_${listen_port}_access.log;
    error_log  /var/log/nginx/${domain}_${listen_port}_error.log;

    location / {
        proxy_pass http://${upstream_host}:${upstream_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
    }
}
EOF

  ln -sf "$config_path" "$enabled_path"
  echo "[info] Wrote $config_path"
}

reload_nginx() {
  echo "[info] Validating nginx configuration"
  nginx -t
  echo "[info] Reloading nginx"
  if command -v systemctl >/dev/null 2>&1; then
    systemctl reload nginx
  elif command -v service >/dev/null 2>&1; then
    service nginx reload
  else
    nginx -s reload
  fi
}

request_certificate() {
  local domain="$1"
  local email="$2"
  echo "[info] Requesting/renewing TLS certificate for ${domain}"
  certbot --nginx --non-interactive --agree-tos --redirect --email "$email" -d "$domain"
}

main() {
  local domain=""
  local service_port=""
  local service_host="127.0.0.1"
  local listen_port="80"
  local email=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain)
        domain="$2"
        shift 2
        ;;
      --service-port)
        service_port="$2"
        shift 2
        ;;
      --service-host)
        service_host="$2"
        shift 2
        ;;
      --listen-port)
        listen_port="$2"
        shift 2
        ;;
      --email)
        email="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        echo "[error] Unknown option: $1" >&2
        usage
        exit 1
        ;;
    esac
  done

  if [[ -z "$domain" || -z "$service_port" ]]; then
    usage
    exit 1
  fi

  require_root
  ensure_nginx

  local domain_ip
  domain_ip=$(resolve_domain_ip "$domain" || true)
  local server_ip
  server_ip=$(primary_server_ip || true)
  if [[ -n "$domain_ip" && -n "$server_ip" && "$domain_ip" != "$server_ip" ]]; then
    echo "[warn] ${domain} resolves to ${domain_ip}, but this host reports ${server_ip}." >&2
    echo "[warn] Make sure DNS is pointing to this machine before continuing." >&2
  fi

  create_server_block "$domain" "$listen_port" "$service_host" "$service_port"
  reload_nginx

  if [[ -n "$email" ]]; then
    ensure_certbot
    request_certificate "$domain" "$email"
  fi

  echo "[done] ${domain}:${listen_port} now proxies to http://${service_host}:${service_port}"
}

main "$@"
