# AMD 机器接入 RoboCloud —— SSH 隧道方案（部署与实现）

> 目标：让只暴露一个 SSH 端口（`31081`）的 AMD GPU 机器，作为 RoboCloud 的 GPU 节点跑
> 数据上传 + 训练 + 推理，全程只借用那一个端口，且 GPU 机器的 shell / 数据对用户不可见。

## 0. 背景与约束

- **AMD 机器**：有 GPU，只对外暴露 `31081`（映射内部 sshd），无法再开端口。
  登录：`ssh -i id_ed25519 -p 31081 root@36.150.116.206`。
- **volc 机器**：公网 IP、可开端口、已有 nginx（承载 RoboCloud 站点入口）、可 SSH 到 AMD。
- **端口约定**（对齐 `.env.example`）：后端 6150、前端 6151、**Agent 6152**、推理 6153 起。

GPU Agent 有三条独立入站链路，各用各的策略（代码依据：`scheduler.py:429` 控制面 /
`services.py:1223`+`client.ts:504` 数据面 / `agent.py:1628` 推理面）：

| 链路 | 方向 | 协议 | 策略 |
|---|---|---|---|
| ① 控制面 | 后端 → Agent | HTTP | volc 常驻端口转发（autossh） |
| ② 数据面（数据集上传） | 浏览器 → Agent | HTTP 分块续传 | **RoboCloud 域名子路由**，零域名/零端口 |
| ③ 推理面 | 机器人 → policy_server | gRPC 长连接 | SSH 端口转发，机器人端本地直连 + 密钥阉割 |

## 1. 总体拓扑

```
                 ┌───────────────────── volc（公网IP，nginx）─────────────────────┐
 浏览器 ──HTTPS──▶│ nginx: location /amd-agent/ → 127.0.0.1:6152（剥前缀）         │
 (数据集上传)     │                                        │                       │
                 │ 后端 Scheduler ──HTTP──▶ 127.0.0.1:6152 ┤ autossh -L(over 31081)│
                 │   凭据: /var/lib/rc-tunnel/.ssh/        │  以 rc-tunnel 账号运行 │
                 └────────────────────────────────────────┼───────────────────────┘
                                                           ▼
                                            ┌─── AMD（仅开 31081）───┐
                                            │ GPU Agent :6152        │
                                            │ policy_server :6153+   │◀── 机器人 gRPC
                                            │ 训练/推理用本地 GPU     │    (本地直连隧道)
                                            └────────────────────────┘
 机器人控制端 PC ── ssh -N -L 6153:127.0.0.1:6153 -p 31081 tunnel@AMD ──▶ policy_server
                    (Tauri 内存托管短期证书，密钥阉割成只能转发 6153)
```

AMD 上三种被阉割的入站授权，各管各的端口：
- volc 隧道 key → 只能转发 `127.0.0.1:6152`
- 机器人推理证书 → 只能转发 `127.0.0.1:6153`
- 真正 root key → 运维专用，单独保管，不进任何隧道链路

## 2. 凭据存放（volc 侧）

AMD 的 SSH 信息是**主机层密钥，不进 `.env`/DB/仓库**。放在 volc 专用账号下，最小权限，主机指纹固定。

专用服务账号：

```bash
useradd -r -m -d /var/lib/rc-tunnel -s /usr/sbin/nologin rc-tunnel
install -d -m 700 -o rc-tunnel -g rc-tunnel /var/lib/rc-tunnel/.ssh
```

四样文件：

| 文件 | 内容 | 权限 |
|---|---|---|
| `/var/lib/rc-tunnel/.ssh/id_amd_tunnel` | 私钥（连 AMD） | `600 rc-tunnel` |
| `id_amd_tunnel.pub` | 公钥 | `644` |
| `known_hosts` | AMD 主机指纹（防 MITM） | `644` |
| `config` | host/port/user 连接参数 | `600` |

ssh config（连接参数收口成别名）：

```
# /var/lib/rc-tunnel/.ssh/config
Host amd-gpu
    HostName 36.150.116.206
    Port 31081
    User tunnel                        # AMD 上被阉割的专用用户，不是 root
    IdentityFile /var/lib/rc-tunnel/.ssh/id_amd_tunnel
    IdentitiesOnly yes
    StrictHostKeyChecking yes
    UserKnownHostsFile /var/lib/rc-tunnel/.ssh/known_hosts
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

固定 AMD 指纹（一次性，人工核对后定稿）：

```bash
sudo -u rc-tunnel ssh-keyscan -p 31081 36.150.116.206 \
  > /var/lib/rc-tunnel/.ssh/known_hosts
```

（可选）密钥不落明文盘：`systemd-creds encrypt` + 单元 `LoadCredentialEncrypted=`，或接 Vault/火山 KMS 启动时拉进 tmpfs。

不该放 volc 上：推理用的 SSH CA 私钥（属于后端）、AMD 真正 root 私钥。

## 3. 控制面 + 数据面（一条 volc 隧道搞定）

Agent 的 HTTP 服务（控制面 + 上传同一个端口）统一走 volc:6152 隧道，**端口两侧一致**
（Agent 本地 bind 端口 == 上报的 api_port，换号会对不上）。

volc 常驻隧道 `/etc/systemd/system/amd-agent-tunnel.service`：

```ini
[Unit]
Description=RoboCloud AMD agent tunnel (control+data)
After=network-online.target
Wants=network-online.target

[Service]
User=rc-tunnel
Environment=AUTOSSH_GATETIME=0
ExecStart=/usr/bin/autossh -M 0 -N -F /var/lib/rc-tunnel/.ssh/config \
  -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:6152:localhost:6152 \
  amd-gpu
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now amd-agent-tunnel
```

数据面：RoboCloud 域名子路由（不需要域名/子域名）。关键是 `proxy_pass` 结尾的 `/` 剥掉前缀
（Agent 内部精确匹配 `/api/v1/agent/...`）：

```nginx
location /amd-agent/ {
    proxy_pass http://127.0.0.1:6152/;   # 结尾 / = 剥掉 /amd-agent/
    client_max_body_size 0;              # 大文件分块上传
    proxy_request_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

好处：**同源**，无 mixed-content、无 CORS、不动 DNS、不签新证书。
数据流：浏览器 → `https://<域名>/amd-agent/...` → nginx 剥前缀 → volc 隧道 → AMD Agent:6152 落盘 → 就地训练。

## 4. 推理面（机器人 → policy_server，gRPC）

实时 gRPC 长连接，**不能用子路由**（那是 HTTP path），必须转发真实端口。用机器人端本地直连降延迟，并把密钥彻底阉割。

端口策略：省事同时一路 → 下发任务 params 带 `port:6153` 固定单端口；要并发 → 保持动态
6153–6202 并整段转发（Agent 会回报实际 `server_port` 再下发给机器人）。

AMD 安全基座（专用 `tunnel` 用户 + sshd Match）：

```sshd
Match User tunnel
    ForceCommand /usr/bin/sleep infinity     # 永远给不了 shell
    PermitTTY no
    AllowTcpForwarding local                 # 只允许 -L
    PermitOpen 127.0.0.1:6152 127.0.0.1:6153 # 只能转发这两个端口
    X11Forwarding no
    AllowAgentForwarding no
    PasswordAuthentication no
```

authorized_keys 再叠一层（双保险，各 key 各端口）：

```
restrict,port-forwarding,permitopen="127.0.0.1:6152",command="/usr/bin/sleep infinity" ssh-ed25519 ... volc-tunnel@robotcloud
restrict,port-forwarding,permitopen="127.0.0.1:6153",command="/usr/bin/sleep infinity" ssh-ed25519 ... infer-tunnel@robotcloud
```

短期证书代替长期密钥（不落盘）：后端持 SSH CA，AMD 配 `TrustedUserCAKeys`。用户点“开始推理”时
desktop 生成临时密钥对，公钥经**已鉴权的 RoboCloud 会话**发后端签发：

```bash
ssh-keygen -s ca -I "user123-infer" -n tunnel -V +10m \
  -O clear -O permit-port-forwarding \
  -O force-command="/usr/bin/sleep infinity" \
  -O source-address=<用户出口IP> \
  ephemeral.pub
```

Tauri 内存托管：desktop 的 Rust 侧子进程拉起 `ssh -N -L 6153:127.0.0.1:6153 -p 31081 tunnel@AMD`，
临时私钥/证书只在内存（用完 zeroize），不写盘、不给 webview。用户只见“连接机器人”按钮。
机器人连 `localhost:6153` → 本地隧道 → policy_server，延迟最低。

诚实边界：用户 root 掌控自己机器，无法根除对本地隧道进程的读取/复用。但做完上面几层后，
用户能触碰的极限恰好等于“连他被授权的推理端口”，GPU 机器 shell、训练数据、其它服务全碰不到。
若连残余风险都不要 → 推理改走 volc 中转（客户端零秘密，代价多一跳延迟）。

## 5. AMD 上 Agent 的最终 `.env`

```bash
# --- 控制面（后端可达的 volc 地址）---
AGENT_IP=<volc后端可达IP>
AGENT_PORT=6152
AGENT_LISTEN_HOST=127.0.0.1                  # 只需本地监听，隧道落 localhost

# --- 数据面（子路由，浏览器直传）---
AGENT_PUBLIC_BASE_URL=https://<RoboCloud域名>/amd-agent
AGENT_UPLOAD_ENABLED=true
# AGENT_UPLOAD_ALLOWED_ORIGINS 同源可留空

# --- 推理面（本地直连：机器人连 localhost 隧道）---
AGENT_INFERENCE_PUBLIC_HOST=127.0.0.1
AGENT_INFERENCE_PORT_START=6153
AGENT_INFERENCE_PORT_RANGE=50                 # 与转发段一致
# 若推理改走 volc 中转，则 AGENT_INFERENCE_PUBLIC_HOST=<volc公网IP>
```

## 6. 部署清单

1. **AMD 侧安全基座**：建 `tunnel` 用户、写 sshd `Match` 块、`authorized_keys` 两条阉割授权；
   配 SSH CA + `TrustedUserCAKeys`；`PasswordAuthentication no`。
2. **volc 侧凭据**：建 `rc-tunnel` 账号、放四样文件（600/644）、`ssh-keyscan` 固定指纹、（可选）加密静置。
3. **控制/数据隧道**：装 autossh，起 `amd-agent-tunnel.service`，`curl 127.0.0.1:6152` 通到 Agent。
4. **数据面子路由**：RoboCloud nginx 加 `location /amd-agent/`（剥前缀 + 大包配置），reload。
5. **desktop 托管**：Tauri Rust 侧实现“取短期证书 → 拉起 `ssh -L` → 内存持有 → 用完清除”。
6. **Agent 配置**：AMD 上按第 5 节写 `.env` 启动 Agent，确认后端看到节点在线、`can_upload=true`。
7. **端到端验证**：① 浏览器传数据集 → ② 提交训练跑通 → ③ 点推理，机器人连上 `localhost:6153` 出动作。

## 7. 交付物（本仓库内）

配置模板与脚本集中在 `scripts/amd-tunnel/`：

- `README.md` —— 逐步部署指引
- `amd/sshd_match_tunnel.conf` —— AMD sshd Match 块
- `amd/authorized_keys.template` —— 两条阉割授权模板
- `amd/setup_amd.sh` —— AMD 侧一键：建用户 / 装授权 / 配 CA
- `volc/ssh_config.template` —— rc-tunnel 的 ssh config
- `volc/amd-agent-tunnel.service` —— 控制/数据面 systemd 单元
- `volc/setup_volc.sh` —— volc 侧一键：建账号 / 放凭据 / 固定指纹 / 装服务
- `volc/nginx-amd-agent.conf` —— 数据面子路由 location 片段
- `backend/sign_inference_cert.sh` —— 推理短期证书签发（后端调用）
- `agent.env.template` —— AMD 上 Agent 的 .env 模板
