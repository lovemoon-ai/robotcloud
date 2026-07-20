#!/usr/bin/env bash
# RoboCloud —— 机器人端推理隧道
#
# GPU 节点只对外开放 SSH，推理服务只绑在节点的 127.0.0.1。本脚本在机器人控制端建立
# SSH 端口转发，把本机 127.0.0.1:5161 接到 GPU 节点的推理服务上；随后 lerobot 客户端
# 用 --server_address='127.0.0.1:5161' 连接即可（后端下发的 server_host 也是 127.0.0.1）。
#
# 所用密钥被 authorized_keys 限死为「只能转发到推理端口」：拿不到 shell、
# 也无法转发到其它端口（实测 5160/22 均被 administratively prohibited 拒绝）。
#
# 用法：
#   KEY=~/.ssh/rc_robot_tunnel ./robot-inference-tunnel.sh
# 可覆盖：
#   GPU_HOST / GPU_SSH_PORT / GPU_SSH_USER / LOCAL_PORT / REMOTE_PORT
set -uo pipefail

GPU_HOST="${GPU_HOST:-115.190.130.100}"     # GPU 节点公网地址（只开 SSH）
GPU_SSH_PORT="${GPU_SSH_PORT:-39670}"       # GPU 节点 SSH 端口
GPU_SSH_USER="${GPU_SSH_USER:-root}"        # 账号受限于 key 的 authorized_keys 选项
KEY="${KEY:-$HOME/.ssh/rc_robot_tunnel}"    # 机器人隧道私钥（受限，只能转发推理端口）
LOCAL_PORT="${LOCAL_PORT:-5161}"            # 本机监听端口（lerobot 连这个）
REMOTE_PORT="${REMOTE_PORT:-5161}"          # GPU 节点上的推理端口

log() { printf '\033[1;32m[infer-tunnel]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[infer-tunnel] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$KEY" ] || die "隧道私钥不存在: $KEY（请向管理员索取，勿自行生成）"
chmod 600 "$KEY" 2>/dev/null || true

if lsof -ti "tcp:$LOCAL_PORT" >/dev/null 2>&1; then
    die "本机 $LOCAL_PORT 已被占用，请先释放（可能已有隧道在跑）"
fi

log "建立隧道: 127.0.0.1:$LOCAL_PORT  ->  $GPU_HOST:$GPU_SSH_PORT  ->  节点 127.0.0.1:$REMOTE_PORT"
log "保持本窗口运行；推理时用 --server_address='127.0.0.1:$LOCAL_PORT'"

# 断线自动重连
while true; do
    ssh -N \
        -i "$KEY" \
        -p "$GPU_SSH_PORT" \
        -o IdentitiesOnly=yes \
        -o ExitOnForwardFailure=yes \
        -o ServerAliveInterval=20 \
        -o ServerAliveCountMax=3 \
        -o StrictHostKeyChecking=accept-new \
        -L "127.0.0.1:$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" \
        "$GPU_SSH_USER@$GPU_HOST"
    rc=$?
    log "隧道断开 (rc=$rc)，5 秒后重连… (Ctrl-C 退出)"
    sleep 5
done
