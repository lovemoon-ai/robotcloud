#!/usr/bin/env bash
# RoboCloud —— AMD 侧一键配置：建 tunnel 用户 / 装阉割授权 / 配 SSH CA / 写 sshd Match 块
#
# 用法（root 运行）：
#   sudo AMD_TUNNEL_USER=tunnel \
#        VOLC_PUBKEY_FILE=./id_amd_tunnel.pub \
#        INFERENCE_CA_PUBKEY_FILE=./inference_ca.pub \
#        AGENT_PORT=6152 INFERENCE_PORT=6153 \
#        bash setup_amd.sh
#
# 幂等：可重复执行。执行前会备份被修改的 sshd 配置。
set -euo pipefail

AMD_TUNNEL_USER="${AMD_TUNNEL_USER:-tunnel}"
AGENT_PORT="${AGENT_PORT:-6152}"
INFERENCE_PORT="${INFERENCE_PORT:-6153}"
VOLC_PUBKEY_FILE="${VOLC_PUBKEY_FILE:-}"
INFERENCE_CA_PUBKEY_FILE="${INFERENCE_CA_PUBKEY_FILE:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CA_DEST="/etc/ssh/robotcloud_inference_ca.pub"
SSHD_DROPIN="/etc/ssh/sshd_config.d/60-rc-tunnel.conf"

log() { printf '\033[1;32m[setup_amd]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[setup_amd] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "必须以 root 运行"
[ -n "$VOLC_PUBKEY_FILE" ] && [ -f "$VOLC_PUBKEY_FILE" ] || die "VOLC_PUBKEY_FILE 不存在: $VOLC_PUBKEY_FILE"

# --- 1. 建专用非登录用户 ---
if id "$AMD_TUNNEL_USER" &>/dev/null; then
    log "用户 $AMD_TUNNEL_USER 已存在，跳过创建"
else
    log "创建用户 $AMD_TUNNEL_USER (nologin)"
    useradd -r -m -s /usr/sbin/nologin "$AMD_TUNNEL_USER"
fi
HOME_DIR="$(getent passwd "$AMD_TUNNEL_USER" | cut -d: -f6)"
[ -n "$HOME_DIR" ] || die "无法定位 $AMD_TUNNEL_USER 的 home"
install -d -m 700 -o "$AMD_TUNNEL_USER" -g "$AMD_TUNNEL_USER" "$HOME_DIR/.ssh"

# --- 2. 安装被阉割的 authorized_keys ---
VOLC_PUBKEY_CONTENT="$(cat "$VOLC_PUBKEY_FILE")"
AUTH_KEYS="$HOME_DIR/.ssh/authorized_keys"
log "写入 authorized_keys（volc 隧道 -> 只能转发 127.0.0.1:$AGENT_PORT）"
sed \
  -e "s|__AGENT_PORT__|$AGENT_PORT|g" \
  -e "s|__INFERENCE_PORT__|$INFERENCE_PORT|g" \
  -e "s|__VOLC_PUBKEY__|$VOLC_PUBKEY_CONTENT|g" \
  "$SCRIPT_DIR/authorized_keys.template" > "$AUTH_KEYS"
chown "$AMD_TUNNEL_USER:$AMD_TUNNEL_USER" "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"

# --- 3. 安装推理 SSH CA 公钥 + TrustedUserCAKeys ---
if [ -n "$INFERENCE_CA_PUBKEY_FILE" ] && [ -f "$INFERENCE_CA_PUBKEY_FILE" ]; then
    log "安装推理 SSH CA 公钥 -> $CA_DEST"
    install -m 644 "$INFERENCE_CA_PUBKEY_FILE" "$CA_DEST"
    if ! grep -q "^TrustedUserCAKeys $CA_DEST" /etc/ssh/sshd_config 2>/dev/null; then
        cp -a /etc/ssh/sshd_config "/etc/ssh/sshd_config.bak.$(id -u)" 2>/dev/null || true
        echo "TrustedUserCAKeys $CA_DEST" >> /etc/ssh/sshd_config
        log "已追加 TrustedUserCAKeys 到 sshd_config"
    fi
else
    log "未提供 INFERENCE_CA_PUBKEY_FILE，跳过 CA（推理证书功能需后续补上）"
fi

# --- 4. 写 sshd Match drop-in ---
mkdir -p /etc/ssh/sshd_config.d
grep -q '^Include /etc/ssh/sshd_config.d/\*.conf' /etc/ssh/sshd_config 2>/dev/null || \
    log "提示: 请确认 sshd_config 含 'Include /etc/ssh/sshd_config.d/*.conf'"
log "写入 sshd Match 块 -> $SSHD_DROPIN"
sed \
  -e "s|__TUNNEL_USER__|$AMD_TUNNEL_USER|g" \
  -e "s|__AGENT_PORT__|$AGENT_PORT|g" \
  -e "s|__INFERENCE_PORT__|$INFERENCE_PORT|g" \
  "$SCRIPT_DIR/sshd_match_tunnel.conf" > "$SSHD_DROPIN"
chmod 644 "$SSHD_DROPIN"

# --- 5. 校验并重载 sshd ---
log "校验 sshd 配置..."
sshd -t || die "sshd 配置校验失败，未重载。请检查 $SSHD_DROPIN"
if command -v systemctl &>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || service ssh reload
else
    service ssh reload || service sshd reload
fi
log "完成。tunnel 用户: $AMD_TUNNEL_USER；放行端口: $AGENT_PORT, $INFERENCE_PORT"
log "验证（应被拒 shell / 只能转发）: ssh -N -L $AGENT_PORT:localhost:$AGENT_PORT -p 31081 $AMD_TUNNEL_USER@<AMD_IP>"
