# 🧩 RobotCloud GPU 调度系统架构设计

**版本**：v1.1\
**最后更新**：2025-11-04\
**适用范围**：Scheduler 与 GPU Agent 部署设计、通信协议、安全架构

------------------------------------------------------------------------

## 一、架构总览

### 1.1 架构图

``` text
                ┌────────────────────────────┐
                │   Control Plane            │
                │ (Backend + DB + Scheduler) │
                │  ┌──────────────────────┐  │
                │  │ Scheduler Service    │  │
                │  │ - 调度任务队列       │  │
                │  │ - 分配GPU资源        │  │
                │  │ - 收集Agent状态      │  │
                │  └──────────────────────┘  │
                └─────────────┬──────────────┘
                              │  HTTPS / MQ
 ┌────────────────────────────┼─────────────────────────────┐
 │                            │                             │
 │          GPU Node #1        │         GPU Node #2         │
 │  ┌──────────────────────┐  │  ┌──────────────────────┐   │
 │  │ GPU Agent (worker)   │  │  │ GPU Agent (worker)   │   │
 │  │ - 拉任务/接指令      │  │  │ - 拉任务/接指令      │   │
 │  │ - 启动Docker容器     │  │  │ - 启动Docker容器     │   │
 │  │ - 上报状态/心跳      │  │  │ - 上报状态/心跳      │   │
 │  └──────────────────────┘  │  └──────────────────────┘   │
 └────────────────────────────┴─────────────────────────────┘
```

------------------------------------------------------------------------

## 二、模块划分

  --------------------------------------------------------------------------------------
  模块          部署位置               职责                       典型规模
  ------------- ---------------------- -------------------------- ----------------------
  **Scheduler   控制平面               任务分配、排队调度、监控   1\~2
  Service**                            Agent                      

  **GPU Agent** 执行平面               执行任务、管理             每台 GPU 机器 1 个
                                       GPU、上报状态              

  **Backend     控制平面               用户接口、任务记录         1
  API**                                                           

  **MinIO /     控制平面               数据与模型持久化           1
  DB**                                                            
  --------------------------------------------------------------------------------------

------------------------------------------------------------------------

## 三、通信协议设计

### 3.1 Scheduler → GPU Agent

**任务下发接口：**

``` bash
POST http://gpu-node-1:5000/api/v1/agent/run
{
  "task_id": 123,
  "cmd": "python train.py --epochs 50 --lr 1e-3",
  "gpus": [0,1],
  "model_type": "yolov8",
  "dataset_path": "/mnt/data/xxx"
}
```

**返回**

``` json
{"status":"accepted"}
```

可选实现：HTTP Push 或 消息队列（Redis/RabbitMQ）异步投递。

------------------------------------------------------------------------

### 3.2 GPU Agent → Scheduler

**状态上报：**

``` bash
POST http://scheduler.internal/api/v1/internal/training/update
{
  "task_id": 123,
  "status": "running",
  "progress": 0.45,
  "loss": 0.233,
  "gpu_mem": 7000
}
```

**心跳汇报：**

``` bash
POST /api/v1/internal/agent/heartbeat
{
  "node_name": "gpu-node-1",
  "gpu_total": 4,
  "gpu_free": [0,3],
  "gpu_busy": [1,2],
  "tasks": [123,124]
}
```

------------------------------------------------------------------------

## 四、数据库设计扩展

### 4.1 worker_nodes 表

  字段             类型                       说明
  ---------------- -------------------------- --------------
  id               INT PK                     
  node_name        VARCHAR(64)                节点名
  ip               VARCHAR(64)                内网 IP
  gpu_total        INT                        总 GPU 数
  gpu_free         INT                        空闲 GPU 数
  gpu_busy         INT                        正在使用数
  last_heartbeat   DATETIME                   上次心跳时间
  status           ENUM('online','offline')   状态
  version          VARCHAR(20)                Agent 版本

### 4.2 train_tasks 增补字段

``` sql
ALTER TABLE train_tasks
ADD COLUMN assigned_node VARCHAR(64),
ADD COLUMN assigned_gpus VARCHAR(64),
ADD COLUMN priority INT,
ADD COLUMN queue_position INT,
ADD COLUMN retry_count INT;
```

------------------------------------------------------------------------

## 五、调度逻辑

### 5.1 核心流程

``` text
[Frontend] → [Backend create task]
     ↓
[Scheduler] → [Assign GPU node]
     ↓
[GPU Agent] → [Run Docker train.py]
     ↓
[Agent 回传日志与状态]
     ↓
[Scheduler 更新 DB → 前端刷新状态]
```

### 5.2 调度算法

-   优先级：Pro(100) \> Plus(50) \> Free(10)
-   排序键：priority DESC, created_at ASC
-   并发限制：每用户 2\~4，系统全局 N=GPU 数
-   Scheduler 每 1 秒循环：
    -   拉取 pending 任务\
    -   分配可用 GPU\
    -   发出运行指令\
    -   更新任务状态

------------------------------------------------------------------------

## 六、安全设计

1.  **HTTPS 双向认证**：Scheduler 与 Agent 通信加密。\
2.  **API Token**：Agent 注册时领取 Token，用于后续鉴权。\
3.  **容器隔离**：每任务独立 Docker 容器；限制 GPU/CPU/内存。\
4.  **数据隔离**：容器挂载独立路径 `/data/train_<taskId>`。\
5.  **最小权限原则**：Agent 不直接访问数据库。

------------------------------------------------------------------------

## 七、Agent 注册与心跳机制

### 7.1 注册

首次启动：

``` bash
POST /api/v1/internal/agent/register
{
  "node_name": "gpu-node-1",
  "ip": "10.0.0.5",
  "gpu_total": 4
}
```

Scheduler 返回：

``` json
{"agent_id": "node1", "token": "abcd1234"}
```

### 7.2 心跳检测

-   每 30 秒上报一次。\
-   超过 2 分钟未响应 → 标记为 offline。\
-   若任务在离线节点 → 标记 failed 或重调度。

------------------------------------------------------------------------

## 八、部署建议

  模块                  部署节点        推荐配置
  --------------------- --------------- -------------------------
  Backend + Scheduler   控制机          CPU 8核 / RAM 16GB
  GPU Agent             每台 GPU 节点   GPU 任意 / Python 3.10+
  Redis                 任意控制机      缓存与任务队列
  MinIO                 控制机          模型与日志存储

Supervisor 示例：

    [program:gpu-agent]
    command=python /opt/agent/main.py
    autostart=true
    autorestart=true
    stderr_logfile=/var/log/gpu-agent.err.log
    stdout_logfile=/var/log/gpu-agent.out.log

------------------------------------------------------------------------

## 九、可扩展方向

  功能           说明
  -------------- -------------------------------------------
  多 Scheduler   Redis 锁防重调度，实现高可用
  节点标签       支持指定 GPU 类型 (A100 / 4090) 调度
  动态伸缩       Agent 上报空闲率，Scheduler 自动调度
  日志流         WebSocket + 文件流式展示
  模型模板       训练镜像模板化（如 yolov8, occupancy 等）

------------------------------------------------------------------------

## 十、总结

✅ **最佳部署方式**：\
- Scheduler Service 与 Backend 在一台「控制节点」上运行；\
- 每台 GPU 主机部署独立的 GPU Agent；\
- 二者之间使用 HTTPS / 消息队列通信。

这样可以实现：\
- 安全隔离与横向扩展\
- 多任务并发与优先级排队\
- 多节点分布式训练调度\
- 平滑扩展 GPU 集群

------------------------------------------------------------------------
