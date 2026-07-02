# SOP: 部署 RobotCloud 到 Volc 生产环境

本文档描述如何把 **RobotCloud** 网站前后端部署 / 更新到火山引擎生产服务器，并绑定：

```text
https://robotcloud.conductor-ai.top
```

> 范围边界：本文部署 Web 前端 + Django 后端 + 后端侧 scheduler；不在 Volc Web 服务器上部署 GPU Agent。GPU Agent 需要在 GPU 机器上单独部署，并通过 Backend 注册。

---

## 0. 架构与关键事实

**线上形态**
- 前端：Next.js `output: "export"`，构建后是静态文件，由 nginx 直接托管。
- 后端：Django + DRF，通过 gunicorn 监听 `127.0.0.1:6150`。
- Scheduler：Django management command `manage.py run_scheduler`，作为 `robotcloud-scheduler.service` 跑在同一台 Volc Web / 后端服务器上，读取同一个 SQLite 数据库并把 queued 训练任务派发给 GPU Agent。
- 反向代理：nginx
  - `/` -> `/opt/robotcloud/frontend/out`
  - `/api/` -> `http://127.0.0.1:6150/api/`
  - `/storage/` -> `http://127.0.0.1:6150/storage/`
- 数据库：SQLite，默认 `/opt/robotcloud/backend/db.sqlite3`。
- GPU Agent：不跑在 Volc Web 服务器上；它跑在 GPU 机器上，负责执行 `lerobot-train`、回报 heartbeat/status/log。
- 进程：Volc Web 服务器需要 `robotcloud-backend.service` 和 `robotcloud-scheduler.service`；不要在 Volc Web 服务器上启动 `make agent` 或 GPU Agent systemd。

**发布铁律**
> 部署前先把本地改动 `commit` + `push` 到远程。服务器只通过 `git fetch && git reset --hard origin/main` 同步 tracked 文件，然后在服务器构建、迁移、重启。不要绕过 git 直接传代码，也不要在服务器上手改 tracked 文件。

根据仓库里的命令获取 Volc 连接信息：

```sh
make info-volc
```

---

## 1. 首次部署

### 1.1 设置连接变量

```sh
export SERVER_IP=<服务器公网IP>
export SSH_KEY=<SSH私钥路径>
export SERVER="root@$SERVER_IP"
export APP_DIR=/opt/robotcloud
export DOMAIN=robotcloud.conductor-ai.top
```

### 1.2 检查服务器前置条件

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  node -v; npm -v; python3 -V
  for t in git nginx certbot python3 npm node; do printf "%s: " "$t"; command -v "$t" || echo MISSING; done
  python3 -m venv --help >/dev/null && echo "python venv: ok" || echo "python venv: missing"
'
```

如果缺 `python3-venv`：

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3.10-venv
'
```

### 1.3 拉取代码

服务器需要能通过 GitHub SSH key 拉取仓库。

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  if [ ! -d /opt/robotcloud/.git ]; then
    git clone git@github.com:DuinoDu/robotcloud.git /opt/robotcloud
  fi
  cd /opt/robotcloud
  git fetch origin
  git reset --hard origin/main
  git rev-parse --short HEAD
'
```

### 1.4 配置生产 `.env`

`.env` 放在仓库根目录 `/opt/robotcloud/.env`，不要提交进 git。可先复制本地 `.env.dev`，再在服务器覆盖生产项。

```sh
scp -i "$SSH_KEY" .env.dev "$SERVER:/opt/robotcloud/.env"
```

服务器上至少确认这些变量：

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  cd /opt/robotcloud
  grep -q "^DJANGO_SECRET_KEY=" .env || printf "\nDJANGO_SECRET_KEY=%s\n" "$(openssl rand -base64 48)" >> .env
  sed -i "s|^BACKEND_HOST=.*|BACKEND_HOST=127.0.0.1|" .env
  sed -i "s|^BACKEND_PORT=.*|BACKEND_PORT=6150|" .env
  sed -i "s|^PUBLIC_API_BASE_URL=.*|PUBLIC_API_BASE_URL=https://robotcloud.conductor-ai.top/api/v1|" .env
  grep -q "^NEXT_PUBLIC_API_BASE_URL=" .env || printf "NEXT_PUBLIC_API_BASE_URL=https://robotcloud.conductor-ai.top/api/v1\n" >> .env
  sed -i "s|^NEXT_PUBLIC_API_BASE_URL=.*|NEXT_PUBLIC_API_BASE_URL=https://robotcloud.conductor-ai.top/api/v1|" .env
  sed -i "s|^PUBLIC_FRONTEND_ORIGIN=.*|PUBLIC_FRONTEND_ORIGIN=https://robotcloud.conductor-ai.top|" .env
  sed -i "s|^DJANGO_ALLOWED_HOSTS=.*|DJANGO_ALLOWED_HOSTS=robotcloud.conductor-ai.top,localhost,127.0.0.1,$SERVER_IP|" .env
  sed -i "s|^DJANGO_CORS_ALLOWED_ORIGINS=.*|DJANGO_CORS_ALLOWED_ORIGINS=https://robotcloud.conductor-ai.top,http://robotcloud.conductor-ai.top|" .env
  sed -i "s|^DJANGO_DEBUG=.*|DJANGO_DEBUG=false|" .env
  grep -q "^USE_SQLITE=" .env || printf "USE_SQLITE=1\n" >> .env
  sed -i "s|^USE_SQLITE=.*|USE_SQLITE=1|" .env
  grep -q "^USE_IN_MEMORY_CACHE=" .env || printf "USE_IN_MEMORY_CACHE=1\n" >> .env
  sed -i "s|^USE_IN_MEMORY_CACHE=.*|USE_IN_MEMORY_CACHE=1|" .env
  grep -q "^SQLITE_PATH=" .env || printf "SQLITE_PATH=/opt/robotcloud/backend/db.sqlite3\n" >> .env
  sed -i "s|^SQLITE_PATH=.*|SQLITE_PATH=/opt/robotcloud/backend/db.sqlite3|" .env
  grep -q "^DATASET_STORAGE_DIR=" .env || printf "DATASET_STORAGE_DIR=/opt/robotcloud/backend/storage/datasets\n" >> .env
  sed -i "s|^DATASET_STORAGE_DIR=.*|DATASET_STORAGE_DIR=/opt/robotcloud/backend/storage/datasets|" .env
  sed -i "s|^AUTH_DEV_CODE=.*|AUTH_DEV_CODE=|" .env
  chmod 600 .env
'
```

生产关键点：
- `AUTH_DEV_CODE=` 必须为空，否则短信验证码会固定为开发码。
- `PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL` 必须是 `https://robotcloud.conductor-ai.top/api/v1`，因为前端静态构建会把这个值写进产物。
- `USE_IN_MEMORY_CACHE=1` 可以让当前轻量部署不依赖 Redis；多进程/多机生产再切 Redis。

### 1.5 安装后端依赖

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  cd /opt/robotcloud/backend
  python3 -m venv .venv
  . .venv/bin/activate
  python -m pip install --upgrade pip setuptools wheel
  pip install -e .
  python -m django --version
  gunicorn --version
'
```

### 1.6 安装前端依赖并构建

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  cd /opt/robotcloud/frontend
  npm install
  PUBLIC_API_BASE_URL=https://robotcloud.conductor-ai.top/api/v1 \
  NEXT_PUBLIC_API_BASE_URL=https://robotcloud.conductor-ai.top/api/v1 \
  npm run build
  test -f out/index.html
'
```

### 1.7 数据库迁移与静态资源

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  cd /opt/robotcloud/backend
  mkdir -p public staticfiles storage/datasets storage/train_logs
  . .venv/bin/activate
  ENV_FILE=.env USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 python manage.py migrate --noinput
  ENV_FILE=.env USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 python manage.py collectstatic --noinput --clear
  ENV_FILE=.env USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 python manage.py check
'
```

### 1.8 systemd 后端与 Scheduler 服务

Scheduler 应该跑在 Volc Web / 后端服务器上，不跑在 GPU 机器上。它必须和 Django 后端使用同一个数据库，否则看不到用户创建的 queued 任务。GPU 机器只运行 GPU Agent。

```sh
ssh -i "$SSH_KEY" "$SERVER" 'cat > /etc/systemd/system/robotcloud-backend.service <<"UNIT"
[Unit]
Description=RobotCloud Django backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/robotcloud/backend
Environment=ENV_FILE=.env
ExecStart=/opt/robotcloud/backend/.venv/bin/gunicorn robotcloud_backend.wsgi:application --bind 127.0.0.1:6150 --workers 1 --timeout 120 --access-logfile - --error-logfile -
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/robotcloud-scheduler.service <<"UNIT"
[Unit]
Description=RobotCloud Scheduler
After=network.target robotcloud-backend.service

[Service]
Type=simple
WorkingDirectory=/opt/robotcloud/backend
Environment=ENV_FILE=.env
ExecStart=/opt/robotcloud/backend/.venv/bin/python manage.py run_scheduler
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now robotcloud-backend.service
systemctl enable --now robotcloud-scheduler.service
sleep 3
systemctl is-active robotcloud-backend.service
systemctl is-active robotcloud-scheduler.service
curl -s -o /dev/null -w "backend_local=%{http_code}\n" http://127.0.0.1:6150/api/v1/dashboard/summary'
```

`backend_local=400` 是未登录请求的预期响应。Scheduler 本身没有 HTTP 端口，使用 `systemctl status` / `journalctl` 验证。

### 1.9 nginx 站点

```sh
ssh -i "$SSH_KEY" "$SERVER" 'cat > /etc/nginx/sites-available/robotcloud <<"NGINX"
server {
    listen 80;
    server_name robotcloud.conductor-ai.top;
    client_max_body_size 100m;

    root /opt/robotcloud/frontend/out;
    index index.html;

    access_log /var/log/nginx/robotcloud_access.log;
    error_log  /var/log/nginx/robotcloud_error.log;

    location /_next/static/ {
        alias /opt/robotcloud/frontend/out/_next/static/;
        expires 1y;
        access_log off;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:6150/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
        proxy_send_timeout 300;
    }

    location /storage/ {
        proxy_pass http://127.0.0.1:6150/storage/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/robotcloud /etc/nginx/sites-enabled/robotcloud
nginx -t
systemctl reload nginx'
```

### 1.10 DNS

在 Volcengine DNS 控制台给 `conductor-ai.top` 添加：

```text
主机记录: robotcloud
记录类型: A
记录值: <SERVER_IP>
```

校验：

```sh
dig +short @vip1.volcengine-dns.com robotcloud.conductor-ai.top A
dig +short @vip2.volcengine-dns.com robotcloud.conductor-ai.top A
```

都应返回 `<SERVER_IP>`。

### 1.11 TLS 证书

DNS 权威生效后：

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  certbot --nginx -d robotcloud.conductor-ai.top --non-interactive --redirect --keep-until-expiring
'
```

certbot 会自动改 nginx：HTTP -> HTTPS 跳转，并配置自动续期 timer。

### 1.12 验收

```sh
curl -s -o /dev/null -w "http=%{http_code} redirect=%{redirect_url}\n" http://robotcloud.conductor-ai.top/
curl -s -o /dev/null -w "https=%{http_code}\n" https://robotcloud.conductor-ai.top/
curl -s https://robotcloud.conductor-ai.top/ | grep -oiE "<title>[^<]*</title>" | head -1
curl -s -o /tmp/robotcloud_api.txt -w "api=%{http_code}\n" https://robotcloud.conductor-ai.top/api/v1/dashboard/summary
head -c 160 /tmp/robotcloud_api.txt; echo
```

期望：

```text
http=301 redirect=https://robotcloud.conductor-ai.top/
https=200
<title>RobotCloud Platform</title>
api=400
{"code":1,"message":"Invalid Authorization header",...}
```

---

## 2. 日常更新

顺序固定：本地自检 -> commit/push -> 服务器 reset 到 origin/main -> 构建 -> migrate/collectstatic -> restart -> 验收。

### 2.1 本地自检与提交

```sh
make test
git status --short
git add -A
git commit -m "feat: ..."
git push origin main
```

### 2.2 服务器同步代码

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  cd /opt/robotcloud
  git fetch origin
  git reset --hard origin/main
  echo "server HEAD: $(git rev-parse --short HEAD)"
'
```

### 2.3 重新安装依赖并构建

有 Python 或 Node 依赖变化时都跑；没依赖变化也可以保守跑一遍。

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  cd /opt/robotcloud/backend
  . .venv/bin/activate
  pip install -e .

  cd /opt/robotcloud/frontend
  npm install
  PUBLIC_API_BASE_URL=https://robotcloud.conductor-ai.top/api/v1 \
  NEXT_PUBLIC_API_BASE_URL=https://robotcloud.conductor-ai.top/api/v1 \
  npm run build
'
```

### 2.4 迁移、静态资源、重启

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  cd /opt/robotcloud/backend
  . .venv/bin/activate
  ENV_FILE=.env USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 python manage.py migrate --noinput
  ENV_FILE=.env USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 python manage.py collectstatic --noinput --clear
  systemctl restart robotcloud-backend.service
  systemctl restart robotcloud-scheduler.service
  sleep 3
  systemctl is-active robotcloud-backend.service
  systemctl is-active robotcloud-scheduler.service
  nginx -t && systemctl reload nginx
'
```

### 2.5 更新验收

```sh
curl -s -o /dev/null -w "https=%{http_code}\n" https://robotcloud.conductor-ai.top/
curl -s https://robotcloud.conductor-ai.top/ | grep -oiE "<title>[^<]*</title>" | head -1
echo "local  HEAD: $(git rev-parse --short HEAD)"
ssh -i "$SSH_KEY" "$SERVER" 'echo "server HEAD: $(git -C /opt/robotcloud rev-parse --short HEAD)"'
```

---

## 3. 数据与备份

### 3.1 备份线上 SQLite

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  cd /opt/robotcloud/backend
  mkdir -p backups
  systemctl stop robotcloud-scheduler.service
  systemctl stop robotcloud-backend.service
  cp db.sqlite3 backups/db.sqlite3.bak-$(date +%Y%m%d-%H%M%S)
  systemctl start robotcloud-backend.service
  systemctl start robotcloud-scheduler.service
  systemctl is-active robotcloud-backend.service
  systemctl is-active robotcloud-scheduler.service
'
```

### 3.2 拉取线上 SQLite 到本地

```sh
mkdir -p .runtime
scp -i "$SSH_KEY" "$SERVER:/opt/robotcloud/backend/db.sqlite3" .runtime/robotcloud-prod.sqlite3
```

### 3.3 覆盖线上 SQLite

仅在明确需要恢复或迁移数据时使用。先停服务、备份，再覆盖。

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  cd /opt/robotcloud/backend
  systemctl stop robotcloud-scheduler.service
  systemctl stop robotcloud-backend.service
  mkdir -p backups
  cp db.sqlite3 backups/db.sqlite3.bak-$(date +%Y%m%d-%H%M%S)
  rm -f db.sqlite3-wal db.sqlite3-shm
'
scp -i "$SSH_KEY" ./db.sqlite3 "$SERVER:/opt/robotcloud/backend/db.sqlite3"
ssh -i "$SSH_KEY" "$SERVER" '
  systemctl start robotcloud-backend.service
  systemctl start robotcloud-scheduler.service
  sleep 3
  systemctl is-active robotcloud-backend.service
  systemctl is-active robotcloud-scheduler.service
'
```

---

## 4. 运维速查

**状态 / 日志**

```sh
ssh -i "$SSH_KEY" "$SERVER" 'systemctl status robotcloud-backend.service --no-pager -l'
ssh -i "$SSH_KEY" "$SERVER" 'systemctl status robotcloud-scheduler.service --no-pager -l'
ssh -i "$SSH_KEY" "$SERVER" 'journalctl -u robotcloud-backend.service -n 100 --no-pager'
ssh -i "$SSH_KEY" "$SERVER" 'journalctl -u robotcloud-scheduler.service -n 100 --no-pager'
ssh -i "$SSH_KEY" "$SERVER" 'tail -100 /var/log/nginx/robotcloud_error.log'
ssh -i "$SSH_KEY" "$SERVER" 'tail -100 /var/log/nginx/robotcloud_access.log'
```

**重启**

```sh
ssh -i "$SSH_KEY" "$SERVER" 'systemctl restart robotcloud-backend.service'
ssh -i "$SSH_KEY" "$SERVER" 'systemctl restart robotcloud-scheduler.service'
ssh -i "$SSH_KEY" "$SERVER" 'nginx -t && systemctl reload nginx'
```

**证书**

```sh
ssh -i "$SSH_KEY" "$SERVER" 'certbot certificates -d robotcloud.conductor-ai.top'
ssh -i "$SSH_KEY" "$SERVER" 'certbot renew --dry-run'
```

**确认没有部署 GPU Agent**

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  systemctl list-units --type=service --all | grep -Ei "robotcloud|gpu|agent" || true
  ss -ltnp | grep -E ":6150|:6151|:6152|:6153" || true
'
```

期望至少看到 `robotcloud-backend.service`、`robotcloud-scheduler.service` 和 `127.0.0.1:6150`。如果后端通过 SSH tunnel 访问 GPU Agent，也可能看到类似 `robotcloud-h20-tunnel.service` 和本地 `127.0.0.1:6153` 转发端口。不要在 Volc Web 服务器上看到 `python -m gpu_agent` 这类 GPU Agent 进程。服务器上已有的云厂商监控 agent 或其它项目服务不属于 RobotCloud GPU Agent。

---

## 5. 回滚

**代码回滚**

```sh
ssh -i "$SSH_KEY" "$SERVER" '
  cd /opt/robotcloud
  git reset --hard <old_commit_or_tag>
  cd frontend
  PUBLIC_API_BASE_URL=https://robotcloud.conductor-ai.top/api/v1 \
  NEXT_PUBLIC_API_BASE_URL=https://robotcloud.conductor-ai.top/api/v1 \
  npm run build
  cd ../backend
  . .venv/bin/activate
  ENV_FILE=.env USE_SQLITE=1 USE_IN_MEMORY_CACHE=1 python manage.py migrate --noinput
  systemctl restart robotcloud-backend.service
  systemctl restart robotcloud-scheduler.service
'
```

**数据回滚**

用 `backend/backups/db.sqlite3.bak-<ts>` 覆盖回 `backend/db.sqlite3`。必须先停服务，再覆盖，再启动。

---

## 6. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `https` 访问失败但 `--resolve` 能通 | DNS 还没指到服务器。先查 `dig +short @vip1.volcengine-dns.com robotcloud.conductor-ai.top A`。 |
| certbot 失败 | DNS 权威没生效，或 80 端口没到 nginx。先确认 `curl --resolve robotcloud.conductor-ai.top:80:<SERVER_IP> http://robotcloud.conductor-ai.top/` 返回 200/301。 |
| 前端调用了 localhost API | 构建时 `PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL` 没设成线上域名。重新 `npm run build`。 |
| `/api/v1/dashboard/summary` 返回 400 | 未登录请求的正常结果，不是后端异常。 |
| 登录/上传数据后状态丢失 | 当前轻量部署用 in-memory token cache，服务重启会导致登录 token 失效。需要长期会话时切 Redis。 |
| 数据集上传提示没有 GPU Agent | 这是预期：本 SOP 不部署 GPU Agent。需要先在 GPU 机器上启动 Agent 并配置 `AGENT_PUBLIC_BASE_URL`。 |
| 训练任务一直 `queued` | 先查 `systemctl is-active robotcloud-scheduler.service`。Scheduler 应在 Volc Web / 后端服务器上运行；再查 `journalctl -u robotcloud-scheduler.service -n 100 --no-pager` 和 `/api/v1/agents/active` 确认 GPU Agent 在线。 |
| `502 Bad Gateway` | `robotcloud-backend.service` 未运行或 gunicorn 没监听 `127.0.0.1:6150`。看 `journalctl -u robotcloud-backend.service`。 |
| 服务器没有 `python3 -m venv` | 安装 `python3.10-venv`。 |
| 线上还是旧页面 | 服务器没有 reset 到最新 commit，或前端没有重新 `npm run build`。核对 local/server HEAD。 |
| 不小心在 Volc Web 服务器上启动了 GPU Agent | 停掉 `python -m gpu_agent` 或对应 systemd。Volc Web 服务器只保留 backend、scheduler，以及可选的 Agent SSH tunnel；GPU Agent 应跑在 GPU 机器。 |

---

## 7. 文件 / 服务索引

- 代码目录：`/opt/robotcloud`
- 环境变量：`/opt/robotcloud/.env`
- 前端静态产物：`/opt/robotcloud/frontend/out`
- 后端 venv：`/opt/robotcloud/backend/.venv`
- SQLite：`/opt/robotcloud/backend/db.sqlite3`
- 数据集目录：`/opt/robotcloud/backend/storage/datasets`
- systemd：`/etc/systemd/system/robotcloud-backend.service`
- systemd：`/etc/systemd/system/robotcloud-scheduler.service`
- nginx：`/etc/nginx/sites-available/robotcloud`
- 线上域名：`https://robotcloud.conductor-ai.top`
