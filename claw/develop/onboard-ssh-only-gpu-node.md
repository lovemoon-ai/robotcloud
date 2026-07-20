# 开发指南：把一台「仅可 SSH」的 GPU 机器接入为 RobotCloud GPU Agent

本文描述如何把一台**只对外开放 SSH 端口**（没有任何其它可用端口、无公网服务端口映射）的
GPU 机器，接入 RobotCloud 作为 GPU Agent，跑数据上传 / 训练 / 推理，并给出**逐层自测**方法。

> 范围边界：本文只讲 GPU 节点接入。Web 前端 / Django 后端 / scheduler 的部署见
> `claw/sop/deploy-to-volc.md`。

本文流程已在 **h20** 节点（`di-20250916145012-z62hd`）完整实操并验证通过。

---

## 0. 核心思路与架构

GPU 机器只有一个 SSH 端口可用，因此**三条链路全部塞进 SSH 隧道**，不依赖 GPU 机器的任何其它端口，
也不使用 per-node 子域名（那样每加一个节点就要改 DNS，不具扩展性）。

| 链路 | 方向 | 协议 | 走法 |
|---|---|---|---|
| ① 控制面 | 后端 Scheduler → Agent | HTTP | volc 常驻 SSH 隧道（volc loopback → 节点 loopback） |
| ② 数据面 | 浏览器 → Agent（数据集上传） | HTTP 分块续传 | RobotCloud 域名**子路由** → nginx → 同一条隧道 |
| ③ 推理面 | 机器人 → policy_server | gRPC 长连接 | **机器人端自建 SSH 隧道**到节点，连本机 `127.0.0.1` |

```
                ┌──────────── volc (115.190.243.112) ────────────┐
 浏览器 ─HTTPS─▶│ nginx: /agent-<node>/ → 127.0.0.1:<AGENT_PORT>  │
                │ 后端 ─HTTP─▶ 127.0.0.1:<AGENT_PORT>             │
                │            └─ ssh -L (常驻 systemd) ────────────┼─┐
                └────────────────────────────────────────────────┘ │
                                                                   ▼
                                            ┌──── GPU 节点（仅开 SSH）────┐
                                            │ gpu_node agent  127.0.0.1:<AGENT_PORT>
 机器人 ── ssh -L (本地隧道) ────────────────▶│ policy_server   127.0.0.1:<INFER_PORT>
        连本机 127.0.0.1:<INFER_PORT>        │ 训练/推理使用本机 GPU        │
                                            └────────────────────────────┘
```

**关键点**：
- Agent 只绑 `127.0.0.1`，**不绑 `0.0.0.0`**——只能经隧道到达。
- 下发给 volc / 机器人的 SSH key 全部用 `authorized_keys` 的 per-key 选项阉割成
  「只能转发指定端口、拿不到 shell」。
- 加新节点：**零 DNS、零安全组变更**，只需分配一组端口。

---

## 1. 端口规划

volc 上每个节点占一组端口（volc 侧 loopback 转发端口必须全局唯一）。约定每节点 +10：

| 节点 | AGENT_PORT（控制/数据面） | INFER_PORT（推理） | 数据面子路由 |
|---|---|---|---|
| h20 | 5160 | 5161 | `/agent`（历史遗留，新节点勿用此名） |
| 新节点 A | 5170 | 5171 | `/agent-<node>` |
| 新节点 B | 5180 | 5181 | `/agent-<node>` |

> 隧道两侧端口保持**同号**。原因见 §7 坑位 2。

本文后续用 `<NODE>`、`<AGENT_PORT>`、`<INFER_PORT>`、`<GPU_HOST>`、`<GPU_SSH_PORT>` 占位。

---

## 2. GPU 节点：拉代码与 Python 环境

```sh
ssh -p <GPU_SSH_PORT> root@<GPU_HOST>
```

```sh
# 选一个持久化目录（注意：容器类机器 /root 可能不持久，优先用挂载的数据盘）
export ROOT=/path/to/ws/robotcloud
git clone git@github.com:lovemoon-ai/robotcloud.git "$ROOT" || (cd "$ROOT" && git fetch origin && git merge --ff-only origin/main)
cd "$ROOT" && git rev-parse --short HEAD
```

`gpu_node` 是项目根目录下的独立包，**只依赖 `requests` + `python-dotenv`**：

```sh
# 方式一：有 uv
cd "$ROOT" && uv sync --project gpu_node

# 方式二：无 uv，复用 backend 的 venv（h20 采用此法）
"$ROOT/backend/.venv/bin/python" -c "import requests, dotenv; print('deps ok')"

# 方式三：独立 venv
python3 -m venv "$ROOT/gpu_node/.venv"
"$ROOT/gpu_node/.venv/bin/pip" install -r "$ROOT/gpu_node/requirements.txt"
```

验证可导入（**必须从项目根目录执行**）：

```sh
cd "$ROOT" && backend/.venv/bin/python -c "import gpu_node; from gpu_node.agent import Agent; print('import ok')"
```

---

## 3. GPU 节点：受限隧道密钥

安全模型：**安全性来自 `authorized_keys` 的 per-key 选项，与账号无关**。因此即使只能用
`root` 账号（很多托管 GPU 平台限制非 root 登录），下发出去的 key 也拿不到 shell。

> ⚠️ **不要修改托管平台的 sshd_config**（如 `/mlplatform/sshd_config`）。SSH 是进机器的唯一通路，
> reload 失败即永久失联，且平台会覆盖你的改动。per-key 选项由 sshd 直接强制，效果等价且零风险。

在**管理机**上生成两把 key：

```sh
ssh-keygen -t ed25519 -N '' -C "volc-<NODE>-tunnel"     -f ./<NODE>_volc_tunnel
ssh-keygen -t ed25519 -N '' -C "robot-inference-<NODE>" -f ./<NODE>_robot_tunnel
```

在 **GPU 节点**上追加到 `/root/.ssh/authorized_keys`（**只追加，不修改已有行**）：

```sh
AK=/root/.ssh/authorized_keys
cp -a "$AK" "$AK.bak.$(date +%Y%m%d%H%M%S)"

# volc 常驻隧道：只能转发 Agent 端口
printf '%s\n' 'restrict,port-forwarding,permitopen="127.0.0.1:<AGENT_PORT>",command="/usr/bin/sleep infinity" <volc 公钥内容>' >> "$AK"

# 机器人推理隧道：只能转发推理端口
printf '%s\n' 'restrict,port-forwarding,permitopen="127.0.0.1:<INFER_PORT>",command="/usr/bin/sleep infinity" <机器人公钥内容>' >> "$AK"

chmod 600 "$AK"
wc -l "$AK"   # 确认只增加了 2 行
```

选项含义：`restrict` 先禁掉一切 → `port-forwarding` 单独放开 → `permitopen` 限死目标端口 →
`command="sleep infinity"` 堵死 shell。

---

## 4. GPU 节点：Agent 拉起脚本

创建 `/root/robotcloud-<NODE>-agent.sh`（自带断线重启的 supervisor 循环）：

```bash
#!/usr/bin/env bash
set -u
ROOT=/path/to/ws/robotcloud
while true; do
  if pgrep -f "^backend/\.venv/bin/python -m gpu_node$" >/dev/null; then
    sleep 5; continue
  fi
  echo "$(date -Is) starting <NODE> gpu-node" >> /tmp/robotcloud-<NODE>-gpu-node.log
  cd "$ROOT" || exit 1          # 必须是项目根目录，见 §7 坑位 1
  export HF_ENDPOINT="https://hf-mirror.com"
  SCHEDULER_API_BASE_URL="https://robotcloud.conductor-ai.top/api/v1" \
  AGENT_NODE_NAME="<NODE>" \
  AGENT_IP="127.0.0.1" \
  AGENT_LISTEN_HOST="127.0.0.1" \
  AGENT_PORT="<AGENT_PORT>" \
  AGENT_PUBLIC_BASE_URL="https://robotcloud.conductor-ai.top/agent-<NODE>" \
  AGENT_UPLOAD_ENABLED="true" \
  AGENT_GPU_TOTAL="1" \
  AGENT_GPU_SLOT_TOTAL="4" \
  AGENT_INFERENCE_PUBLIC_HOST="127.0.0.1" \
  AGENT_INFERENCE_PORT_START="<INFER_PORT>" \
  AGENT_INFERENCE_PORT_RANGE="1" \
  AGENT_LOG_DIR="$ROOT/backend/storage/train_logs" \
  AGENT_DATASET_DIR="$ROOT/backend/storage/datasets_cache" \
  PYTHONUNBUFFERED="1" \
  backend/.venv/bin/python -m gpu_node
  echo "$(date -Is) exited rc=$?; restart in 5s" >> /tmp/robotcloud-<NODE>-gpu-node.log
  sleep 5
done
```

关键变量说明：

| 变量 | 值 | 原因 |
|---|---|---|
| `AGENT_IP` | `127.0.0.1` | 后端在 volc 上经 loopback 隧道访问，故上报 loopback |
| `AGENT_LISTEN_HOST` | `127.0.0.1` | **只绑 loopback**，不对外暴露 |
| `AGENT_PUBLIC_BASE_URL` | 域名 + `/agent-<NODE>` | 子路由，同源无 CORS，无需新域名 |
| `AGENT_INFERENCE_PUBLIC_HOST` | `127.0.0.1` | 机器人经本地隧道连接 |
| `AGENT_LOG_DIR` / `AGENT_DATASET_DIR` | 显式钉住 | 否则默认落 `gpu_node/storage`，老缓存失联，见 §7 坑位 3 |

启动（`setsid` 脱离 SSH 会话）：

```sh
chmod +x /root/robotcloud-<NODE>-agent.sh
cd /root && setsid bash /root/robotcloud-<NODE>-agent.sh </dev/null \
  >/tmp/robotcloud-<NODE>-gpu-node.stdout.log 2>&1 &
```

---

## 5. volc：常驻隧道

`/etc/systemd/system/robotcloud-<NODE>-tunnel.service`：

```ini
[Unit]
Description=RobotCloud <NODE> agent SSH tunnel
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/ssh -i /root/.ssh/<NODE>_volc_tunnel -p <GPU_SSH_PORT> -N \
  -o StrictHostKeyChecking=no -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:<AGENT_PORT>:127.0.0.1:<AGENT_PORT> \
  root@<GPU_HOST>
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```sh
systemctl daemon-reload && systemctl enable --now robotcloud-<NODE>-tunnel.service
```

> ⚠️ `ExitOnForwardFailure=yes` + `permitopen` 必须匹配：ExecStart 里**每一个** `-L` 的目标端口
> 都要在 `permitopen` 里放行，否则任一转发被拒会导致整条隧道退出。见 §7 坑位 4。

---

## 6. volc：nginx 数据面子路由

在 `/etc/nginx/sites-available/robotcloud` 的 HTTPS server 块内新增：

```nginx
location /agent-<NODE>/ {
    proxy_pass http://127.0.0.1:<AGENT_PORT>/;   # 结尾的 / 用于剥掉前缀，见 §7 坑位 5

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    client_max_body_size 0;          # 大数据集分块上传
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

```sh
nginx -t && systemctl reload nginx
```

---

## 7. 机器人端：推理隧道

把 `<NODE>_robot_tunnel` **私钥**通过安全渠道发给机器人操作方，放到 `~/.ssh/rc_robot_tunnel`，然后：

```sh
KEY=~/.ssh/rc_robot_tunnel \
GPU_HOST=<GPU_HOST> GPU_SSH_PORT=<GPU_SSH_PORT> \
LOCAL_PORT=<INFER_PORT> REMOTE_PORT=<INFER_PORT> \
scripts/amd-tunnel/robot/robot-inference-tunnel.sh
```

保持窗口运行，lerobot 侧用 `--server_address='127.0.0.1:<INFER_PORT>'` 连接
（后端下发的 `server_host` 也是 `127.0.0.1`，前端会自动生成正确命令）。

> 若一台机器人同时连多个节点，用 `LOCAL_PORT` 错开本地端口。

---

## 8. 自测清单（逐层验证）

**每一层单独验证，出问题能立刻定位是哪一跳。**

### 8.1 GPU 节点：Agent 自身

```sh
# 进程在跑
ps -eo pid,cmd | grep "gpu_node" | grep -v "bash -c" | grep -v grep
# 绑定必须是 127.0.0.1，不能是 0.0.0.0
(ss -ltnp || netstat -ltnp) | grep ":<AGENT_PORT>"
# 注册成功
tail -5 /tmp/robotcloud-<NODE>-gpu-node.stdout.log
```

期望：
```
LISTEN ... 127.0.0.1:<AGENT_PORT> ... users:(("python",pid=...))
INFO robotcloud.gpu_node: Agent registered with scheduler (token=........)
INFO robotcloud.gpu_node: Agent HTTP server listening on 127.0.0.1:<AGENT_PORT>
```

### 8.2 GPU 节点：确认只暴露 SSH

在**外部机器**上执行，确认除 SSH 外全部不可达：

```sh
python3 - <<'PY'
import socket
for port in (<AGENT_PORT>, <INFER_PORT>, <GPU_SSH_PORT>):
    s=socket.socket(); s.settimeout(6)
    try: s.connect(("<GPU_HOST>",port)); print(f"{port} -> OPEN")
    except Exception as e: print(f"{port} -> {type(e).__name__}")
    finally: s.close()
PY
```

期望：只有 `<GPU_SSH_PORT> -> OPEN`，其余 `ConnectionRefusedError`。

### 8.3 密钥阉割是否生效（重要）

在 volc 上用受限 key 测试。**注意加超时**——强制命令 `sleep infinity` 会让 ssh 永不返回
（这本身就说明拿不到 shell），不加超时会把你的终端挂住。

```sh
python3 - <<'PY'
import subprocess, time, socket
K="/root/.ssh/<NODE>_volc_tunnel"; H="root@<GPU_HOST>"
BASE=["ssh","-i",K,"-p","<GPU_SSH_PORT>","-o","StrictHostKeyChecking=no",
      "-o","BatchMode=yes","-o","ConnectTimeout=10"]

# 1) 拿 shell —— 应拿不到
p=subprocess.Popen(BASE+[H,"id; echo GOT_SHELL"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
try: out,_=p.communicate(timeout=8)
except subprocess.TimeoutExpired: p.kill(); out,_=p.communicate()
print("shell:", "OK 拿不到" if "GOT_SHELL" not in out else "!! 能拿到 shell")

# 2) 转发未授权端口 22 —— 应被拒
p=subprocess.Popen(BASE+["-N","-L","127.0.0.1:15122:127.0.0.1:22",H],
                   stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
time.sleep(3)
s=socket.socket(); s.settimeout(3)
try: s.connect(("127.0.0.1",15122)); s.send(b"x"); time.sleep(1)
except Exception: pass
finally: s.close()
time.sleep(1); p.kill(); _,err=p.communicate()
print("port22:", "OK 被拒" if "administratively prohibited" in err else f"!! {err[:80]}")
PY
```

期望：`shell: OK 拿不到`、`port22: OK 被拒`（`administratively prohibited`）。

### 8.4 控制面：volc → Agent

```sh
systemctl is-active robotcloud-<NODE>-tunnel.service        # active
curl -sS -m 8 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:<AGENT_PORT>/
```

期望 `404`。**404 就是成功**——Agent 只服务 `/api/v1/agent/*`，根路径本来就是 404；
关键是拿到了 HTTP 响应而不是 connection refused。

### 8.5 数据面：公网子路由

```sh
curl -sS -m 8 -o /dev/null -w "%{http_code}\n" https://robotcloud.conductor-ai.top/agent-<NODE>/
```

期望 `404`（同上）。若是 `502` → 隧道断了；`404` 但带 nginx 页面 → location 没配对。

### 8.6 推理面：机器人隧道

在机器人端起隧道后：

```sh
python3 -c "
import socket
s=socket.socket(); s.settimeout(4)
try: s.connect(('127.0.0.1',<INFER_PORT>)); print('OK 隧道可连')
except Exception as e: print('隧道未建立:',e)
finally: s.close()"
```

### 8.7 端到端业务验证

1. 后端控制台确认节点在线、`can_upload=true`。
2. 浏览器上传一个小数据集 → 落到节点 `AGENT_DATASET_DIR`。
3. 提交一个训练任务 → 节点上出现 `lerobot-train` 进程、`AGENT_LOG_DIR` 有日志。
4. 起推理 → 机器人经本地隧道连 `127.0.0.1:<INFER_PORT>` 出动作。

---

## 9. 常见坑（实操踩过）

1. **`python -m gpu_node` 必须从项目根目录启动。**
   `gpu_node` 在项目根，cwd 不对会 `ModuleNotFoundError`；且 `work_dir` 默认取项目根，
   训练脚本 `scripts/lerobot-*.sh` 依赖它。

2. **隧道两侧端口必须同号。**
   Agent 本地 bind 的端口 == 上报给后端的 `api_port`（同一个 `AGENT_PORT`），
   跨隧道换号会导致后端拿到错误端口。

3. **存储路径要显式钉住。**
   不设 `AGENT_LOG_DIR` / `AGENT_DATASET_DIR` 时默认落 `gpu_node/storage`。
   若节点上已有历史缓存（h20 有 101G）在 `backend/storage`，不钉住会导致缓存全部失联、重新下载。

4. **`ExitOnForwardFailure` + `permitopen` 要匹配。**
   ExecStart 里每个 `-L` 的目标端口都必须在 `permitopen` 中放行，否则任一转发被拒 →
   整条隧道退出 → 控制面全断。

5. **nginx `proxy_pass` 结尾的 `/` 不能少。**
   Agent 内部精确匹配 `/api/v1/agent/...`，不剥掉 `/agent-<NODE>` 前缀会全部 404。
   前端所有续传子请求都从 `upload_url` 派生，前缀会一路带下去。

6. **不要用 `pkill -f "<模式>"` 杀 agent。**
   模式串会出现在你自己那条 `ssh 'bash -c ...'` 的 cmdline 里，`pkill` 会**把自己的会话一起杀掉**
   （表现为命令无输出、连接中断）。用 `ps` 查到 PID 后 `kill <PID>`。

7. **托管平台的 sshd 不要碰。**
   配置可能在 `/mlplatform/sshd_config` 之类的非标准路径，且平台会覆盖。SSH 是唯一通路，
   reload 失败即失联。用 `authorized_keys` per-key 选项达成同等限制。

8. **非 root 账号可能根本无法登录。**
   部分平台只允许 root。此时不要纠结建 `tunnel` 用户（建了也认证不过），
   直接用 root + 受限 key——安全性由 key 选项保证，与账号无关。

9. **检查 `authorized_keys` 是否有畸形行。**
   曾遇到两把 key 被拼接成一行（`...user@hostssh-ed25519 AAA...`），后一把静默失效。
   这类行会让「某人的 key 明明加了却登不上」。用 `ssh-keygen -lf <file>` 逐行校验。

10. **改 `authorized_keys` 用「只追加」，并先备份。**
    用 `grep`/`awk` 按 key 内容批量改极易误伤同一行内的其它 key。改完务必
    `diff` 备份确认只有预期行发生变化。

---

## 10. 回滚

```sh
# GPU 节点：拉起脚本
cp /root/robotcloud-<NODE>-agent.sh.bak.<ts> /root/robotcloud-<NODE>-agent.sh
# GPU 节点：授权文件
cp /root/.ssh/authorized_keys.bak.<ts> /root/.ssh/authorized_keys
# volc：隧道
cp /etc/systemd/system/robotcloud-<NODE>-tunnel.service.bak.<ts> \
   /etc/systemd/system/robotcloud-<NODE>-tunnel.service
systemctl daemon-reload && systemctl restart robotcloud-<NODE>-tunnel.service
# 代码
git -C "$ROOT" reset --hard <old-commit>
```

---

## 相关文档

- `claw/sop/deploy-to-volc.md` —— Web / 后端 / scheduler 部署
- `claw/arch/deployment-architecture.md` —— 整体部署架构
- `docs/RobotCloud_AMD_Tunnel_Deployment.md` —— 隧道方案设计说明与取舍
- `gpu_node/README.md` —— gpu_node 包的独立运行方式
- `scripts/amd-tunnel/` —— 配置模板与脚本
