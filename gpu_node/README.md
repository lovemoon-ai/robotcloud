# RobotCloud GPU Node

独立运行在 GPU 机器上的 Agent，负责数据集接收、训练、推理，**与 backend 完全解耦**
（只通过 HTTP 与 Scheduler/后端通信）。

## 依赖

仅两个第三方库：`requests`、`python-dotenv`（见 `pyproject.toml` / `requirements.txt`）。

## 运行

Agent 需要项目根目录的 `scripts/lerobot-*.sh` 等资源，因此 **cwd 必须是项目根**
（`work_dir` 默认取包的上一级，即项目根）。

### 方式一：uv（推荐）

```bash
# 在项目根执行；--project gpu_node 使用本工程自己的依赖环境，cwd 保持在项目根
uv run --project gpu_node python -m gpu_node
```

### 方式二：纯 venv / pip

```bash
python -m venv gpu_node/.venv && source gpu_node/.venv/bin/activate
pip install -r gpu_node/requirements.txt
# 从项目根启动
python -m gpu_node
```

### 方式三：安装为命令

```bash
pip install ./gpu_node          # 提供 console 脚本 robotcloud-gpu-node
robotcloud-gpu-node             # 等价于 python -m gpu_node
```

## 配置

从项目根的 `.env` 读取（可用 `ENV_FILE` 覆盖）。字段见 `scripts/amd-tunnel/agent.env.template`。
默认存储目录：`gpu_node/storage/{train_logs,datasets_cache}`（可用 `AGENT_LOG_DIR` /
`AGENT_DATASET_DIR` 覆盖）。

## 测试

```bash
cd gpu_node && uv run pytest
```
