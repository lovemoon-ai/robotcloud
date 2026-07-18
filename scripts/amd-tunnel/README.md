# AMD 机器接入 RoboCloud —— 部署脚本

对应设计文档：`docs/RobotCloud_AMD_Tunnel_Deployment.md`。

把只暴露一个 SSH 端口（`31081`）的 AMD GPU 机器，通过 volc 中转接入 RoboCloud，
跑数据上传 + 训练 + 推理，全程只借用该端口，GPU 机器 shell/数据对用户不可见。

## 目录

```
amd-tunnel/
├── README.md
├── agent.env.template               # AMD 上 Agent 的 .env 模板
├── amd/                             # 在 AMD 机器上执行
│   ├── setup_amd.sh                 #   一键：建 tunnel 用户 / 装授权 / 配 CA / 写 sshd Match
│   ├── sshd_match_tunnel.conf       #   sshd Match 块（被 setup 安装到 sshd_config.d）
│   └── authorized_keys.template     #   两条被阉割的授权模板
├── volc/                           # 在 volc 机器上执行
│   ├── setup_volc.sh                #   一键：建 rc-tunnel 账号 / 放凭据 / 固定指纹 / 装服务
│   ├── ssh_config.template          #   rc-tunnel 的 ssh config
│   ├── amd-agent-tunnel.service     #   控制/数据面 systemd 单元
│   └── nginx-amd-agent.conf         #   数据面子路由 location 片段
└── backend/
    └── sign_inference_cert.sh       # 推理短期证书签发（后端调用，需 CA 私钥）
```

## 部署顺序

### 1) 生成两把隧道密钥 + 一套 SSH CA（在安全的运维机上）

```bash
# volc -> AMD 的隧道密钥（控制/数据面）
ssh-keygen -t ed25519 -N '' -C 'volc-tunnel@robotcloud' -f ./id_amd_tunnel

# 推理 CA（只用于签发短期证书；私钥留在后端，绝不进 volc/AMD）
ssh-keygen -t ed25519 -N '' -C 'robotcloud-inference-ca' -f ./inference_ca
```

### 2) AMD 侧

把 `id_amd_tunnel.pub`、`inference_ca.pub` 拷到 AMD，然后：

```bash
sudo AMD_TUNNEL_USER=tunnel \
     VOLC_PUBKEY_FILE=./id_amd_tunnel.pub \
     INFERENCE_CA_PUBKEY_FILE=./inference_ca.pub \
     AGENT_PORT=6152 INFERENCE_PORT=6153 \
     bash amd/setup_amd.sh
```

### 3) volc 侧

把私钥 `id_amd_tunnel`（和 `.pub`）拷到 volc 的一个临时路径，然后：

```bash
sudo AMD_HOST=36.150.116.206 AMD_PORT=31081 AMD_TUNNEL_USER=tunnel \
     TUNNEL_KEY_SRC=/root/id_amd_tunnel \
     AGENT_PORT=6152 \
     bash volc/setup_volc.sh
```

把 `volc/nginx-amd-agent.conf` 的 `location` 片段并入 RoboCloud 站点的 nginx server 块，reload。

### 4) AMD 上启动 Agent

用 `agent.env.template` 生成 `.env`（填 volc 可达 IP、RoboCloud 域名），启动 Agent。

### 5) 推理证书签发（后端）

后端在用户点“开始推理”时调用：

```bash
CA_KEY=/secure/inference_ca backend/sign_inference_cert.sh \
    <user_ephemeral.pub> <principal> <source_ip> [ttl] > cert-out.txt
```

详见各脚本头部注释与设计文档第 3~6 节。
