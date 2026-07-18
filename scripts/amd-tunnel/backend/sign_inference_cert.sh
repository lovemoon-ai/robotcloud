#!/usr/bin/env bash
# RoboCloud —— 推理短期 SSH 证书签发（后端调用；CA 私钥仅存后端）
#
# 用户点"开始推理"时：desktop 生成临时密钥对 -> 把公钥经已鉴权会话发后端 -> 后端调用本脚本签发
# 一张 5~10 分钟、绑用途/绑源 IP、只能端口转发、给不了 shell 的证书 -> 回给 desktop 拉隧道。
#
# 用法：
#   CA_KEY=/secure/inference_ca \
#     sign_inference_cert.sh <user_ephemeral.pub> <key_id> <source_ip> [ttl_minutes] [tunnel_user]
# 例：
#   CA_KEY=/secure/inference_ca \
#     sign_inference_cert.sh /tmp/u.pub user123-infer 203.0.113.9 10 tunnel
#
# 产物：在 <user_ephemeral.pub> 同目录生成 <name>-cert.pub，并打印其路径到 stdout。
set -euo pipefail

CA_KEY="${CA_KEY:?必须设置 CA_KEY（CA 私钥路径，仅后端持有）}"
PUBKEY="${1:?缺少 user_ephemeral.pub}"
KEY_ID="${2:?缺少 key_id（如 user<uid>-infer-<taskid>）}"
SOURCE_IP="${3:?缺少 source_ip（用户出口 IP，绑定证书）}"
TTL_MIN="${4:-10}"
TUNNEL_USER="${5:-tunnel}"   # 必须与 AMD 上 sshd Match 的 principal 一致

[ -f "$CA_KEY" ] || { echo "CA 私钥不存在: $CA_KEY" >&2; exit 1; }
[ -f "$PUBKEY" ] || { echo "公钥不存在: $PUBKEY" >&2; exit 1; }

# -O clear 清空所有权限，只放开端口转发；force-command 堵死 shell；-V 限 TTL；source-address 绑源 IP
ssh-keygen -s "$CA_KEY" \
    -I "$KEY_ID" \
    -n "$TUNNEL_USER" \
    -V "+${TTL_MIN}m" \
    -O clear \
    -O permit-port-forwarding \
    -O force-command="/usr/bin/sleep infinity" \
    -O source-address="$SOURCE_IP" \
    "$PUBKEY" >/dev/null

CERT="${PUBKEY%.pub}-cert.pub"
[ -f "$CERT" ] || { echo "签发失败，未生成证书" >&2; exit 1; }

# 打印证书内容摘要到 stderr，路径到 stdout（便于后端捕获）
echo "signed: id=$KEY_ID user=$TUNNEL_USER ttl=${TTL_MIN}m src=$SOURCE_IP" >&2
ssh-keygen -L -f "$CERT" | sed -n '1,20p' >&2 || true
echo "$CERT"
