#!/usr/bin/env bash
# RoboCloud —— volc 侧一键配置：建 rc-tunnel 账号 / 放凭据 / 固定 AMD 指纹 / 装并起 systemd 隧道
#
# 用法（root 运行）：
#   sudo AMD_HOST=36.150.116.206 AMD_PORT=31081 AMD_TUNNEL_USER=tunnel \
#        TUNNEL_KEY_SRC=/root/id_amd_tunnel \
#        AGENT_PORT=6152 \
#        bash setup_volc.sh
#
# TUNNEL_KEY_SRC 指向私钥文件（同目录需有对应 .pub）。脚本会把它搬进 rc-tunnel 的 .ssh 后
# 建议删除源文件。幂等：可重复执行。
set -euo pipefail

AMD_HOST="${AMD_HOST:?必须设置 AMD_HOST}"
AMD_PORT="${AMD_PORT:-31081}"
AMD_TUNNEL_USER="${AMD_TUNNEL_USER:-tunnel}"
AGENT_PORT="${AGENT_PORT:-6152}"
TUNNEL_KEY_SRC="${TUNNEL_KEY_SRC:?必须设置 TUNNEL_KEY_SRC（AMD 隧道私钥路径）}"

SVC_USER="rc-tunnel"
SVC_HOME="/var/lib/rc-tunnel"
SSH_DIR="$SVC_HOME/.ssh"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DEST="/etc/systemd/system/amd-agent-tunnel.service"

log() { printf '\033[1;32m[setup_volc]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[setup_volc] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "必须以 root 运行"
[ -f "$TUNNEL_KEY_SRC" ] || die "私钥不存在: $TUNNEL_KEY_SRC"
command -v autossh &>/dev/null || die "未安装 autossh，请先: apt-get install -y autossh"

# --- 1. 建专用账号 ---
if id "$SVC_USER" &>/dev/null; then
    log "用户 $SVC_USER 已存在"
else
    log "创建用户 $SVC_USER (nologin, home=$SVC_HOME)"
    useradd -r -m -d "$SVC_HOME" -s /usr/sbin/nologin "$SVC_USER"
fi
install -d -m 700 -o "$SVC_USER" -g "$SVC_USER" "$SSH_DIR"

# --- 2. 放私钥/公钥 ---
log "安装隧道私钥 -> $SSH_DIR/id_amd_tunnel"
install -m 600 -o "$SVC_USER" -g "$SVC_USER" "$TUNNEL_KEY_SRC" "$SSH_DIR/id_amd_tunnel"
if [ -f "$TUNNEL_KEY_SRC.pub" ]; then
    install -m 644 -o "$SVC_USER" -g "$SVC_USER" "$TUNNEL_KEY_SRC.pub" "$SSH_DIR/id_amd_tunnel.pub"
fi

# --- 3. 固定 AMD 主机指纹（防 MITM）---
log "抓取并固定 AMD 主机指纹 ($AMD_HOST:$AMD_PORT)"
KNOWN="$SSH_DIR/known_hosts"
tmp_known="$(mktemp)"
if ! ssh-keyscan -p "$AMD_PORT" -H "$AMD_HOST" > "$tmp_known" 2>/dev/null || [ ! -s "$tmp_known" ]; then
    rm -f "$tmp_known"; die "ssh-keyscan 失败，请检查网络与 $AMD_HOST:$AMD_PORT 可达性"
fi
install -m 644 -o "$SVC_USER" -g "$SVC_USER" "$tmp_known" "$KNOWN"
rm -f "$tmp_known"
log "已固定指纹。请人工与 AMD 上 /etc/ssh/ssh_host_ed25519_key.pub 核对一次再投产。"

# --- 4. 装 ssh config ---
log "写入 ssh config -> $SSH_DIR/config"
sed \
  -e "s|__AMD_HOST__|$AMD_HOST|g" \
  -e "s|__AMD_PORT__|$AMD_PORT|g" \
  -e "s|__AMD_TUNNEL_USER__|$AMD_TUNNEL_USER|g" \
  "$SCRIPT_DIR/ssh_config.template" > "$SSH_DIR/config"
chown "$SVC_USER:$SVC_USER" "$SSH_DIR/config"
chmod 600 "$SSH_DIR/config"

# --- 5. 装 systemd 单元 ---
log "写入 systemd 单元 -> $UNIT_DEST"
sed -e "s|__AGENT_PORT__|$AGENT_PORT|g" "$SCRIPT_DIR/amd-agent-tunnel.service" > "$UNIT_DEST"
chmod 644 "$UNIT_DEST"

# --- 6. 启动 ---
systemctl daemon-reload
systemctl enable --now amd-agent-tunnel
sleep 2
systemctl --no-pager --full status amd-agent-tunnel || true

log "完成。验证隧道: curl -sS -m 5 http://127.0.0.1:$AGENT_PORT/ && echo OK"
log "隧道通后，记得删除源私钥: shred -u $TUNNEL_KEY_SRC $TUNNEL_KEY_SRC.pub"
