# 🧩 **RobotCloud 接口设计与数据库设计文档**

**版本**：v1.0\
**最后更新**：2025-10-31\
**文档目标**：规范接口定义与数据库结构，为开发团队分工提供依据

------------------------------------------------------------------------

## 一、接口命名与约定

-   **统一前缀**：`/api/v1/`
-   **返回结构**

``` json
{
  "code": 0,
  "message": "success",
  "data": {...}
}
```

-   **分页参数**：`?page=1&size=20`
-   **认证方式**：JWT Token (`Authorization: Bearer <token>`)
-   **权限验证**：基于用户等级（free / plus / pro）
-   **跨域配置**：默认允许 `http://localhost:3000` / `http://127.0.0.1:3000` 以及 RobotCloud Desktop 本地 origin（`tauri://localhost`、`http://tauri.localhost`、`https://tauri.localhost`、`app://local`）；如需调整可设置环境变量 `DJANGO_CORS_ALLOWED_ORIGINS`

------------------------------------------------------------------------

## 二、模块划分总览

  模块              功能说明                主要职责
  ----------------- ----------------------- ----------------
  Auth 模块         注册、登录、Token验证   用户体系与权限
  User 模块         用户信息、套餐、升级    用户资料管理
  Dataset 模块      上传、浏览、可视化      数据集管理
  Training 模块     模型训练任务管理        模型训练调度
  Inference 模块    推理任务管理            模型云端推理
  Simulation 模块   仿真环境与硬件绑定      Pro专属功能
  Admin 模块        系统与资源管理          管理员后台接口

------------------------------------------------------------------------

# 🧱 **Ⅰ. Auth 模块**

### 1. 注册

**POST** `/api/v1/auth/register`

``` json
{
  "phone": "13800000000",
  "password": "123456",
  "code": "1234"
}
```

**响应**

``` json
{"code":0,"message":"success","data":{"user_id":1}}
```

### 2. 登录

**POST** `/api/v1/auth/login`

``` json
{
  "phone": "13800000000",
  "password": "123456",
  "device_id": "browser-or-app-installation-uuid",
  "device_type": "browser"
}
```

`device_type` 支持 `browser` / `desktop` / `mobile`。同一用户同一时刻最多保留 1 个 `browser` 会话和 1 个 `desktop` 会话，浏览器登录与桌面客户端登录互不挤下线；同一 `device_id` 重新登录会刷新该设备会话。可通过环境变量 `AUTH_SINGLE_DEVICE_BYPASS_PHONES` 配置逗号分隔手机号白名单，白名单用户不受该限制。可通过 `AUTH_PLUS_WHITELIST_PHONES` 配置逗号分隔手机号白名单，白名单用户注册或登录时默认获得 plus 权限。可通过 `AUTH_NO_LIMITS_WHITELIST_PHONES` 配置逗号分隔手机号白名单，白名单用户注册或登录时默认获得 plus 权限，并绕过数据集、模型、训练任务等账号资源数量限制；推理仍受同一时刻单实例端口限制。

**响应**

``` json
{"code":0,"data":{"token":"xxx.yyy.zzz","role":"free"}}
```

短信验证码登录 `/api/v1/auth/login_code` 使用同样的 `device_id` / `device_type` 规则。

### 3. 发送验证码

**POST** `/api/v1/auth/send_code`

``` json
{"phone":"13800000000"}
```

### 4. Token 验证

**GET** `/api/v1/auth/verify_token`

------------------------------------------------------------------------

# 👤 **Ⅱ. User 模块**

### 1. 获取用户信息

**GET** `/api/v1/user/profile` **响应**

``` json
{
  "code":0,
  "data":{
    "user_id":1,
    "phone":"13800000000",
    "role":"plus",
    "expire_at":"2026-01-01",
    "created_at":"2025-10-31"
  }
}
```

### 2. 升级套餐

**POST** `/api/v1/user/upgrade`

``` json
{"target_role":"plus","payment_id":"alipay_12345"}
```

### 3. 查看使用记录

**GET** `/api/v1/user/usage` 返回训练/推理任务统计

------------------------------------------------------------------------

# 📂 **Ⅲ. Dataset 模块**

### 1. 上传数据集

**POST** `/api/v1/dataset/upload`\
Header: `Authorization: Bearer <token>`\
Form-Data：

    file: dataset.zip
    name: "parking_scene"
    description: "停车场障碍数据集"

**响应**

``` json
{"code":0,"data":{"dataset_id":42,"status":"processing"}}
```

### 2. 获取数据集列表

**GET** `/api/v1/dataset/list?visibility=public&page=1&size=10`

### 3. 获取数据集详情

**GET** `/api/v1/dataset/{dataset_id}`

### 4. 数据集统计

**GET** `/api/v1/dataset/{dataset_id}/stats`

### 5. 数据集可视化（预览）

**GET** `/api/v1/dataset/{dataset_id}/preview`
返回样本缩略图、视频、点云 URL

------------------------------------------------------------------------

# 🧠 **Ⅳ. Training 模块**

### 1. 创建训练任务

**POST** `/api/v1/training/create`

``` json
{
  "dataset_id":42,
  "job_name":"pi05-grasp-v1",
  "model_type":"pi05",
  "params":{
    "steps":5000,
    "batch_size":8,
    "learning_rate":0.000025
  }
}
```

`model_type` 使用后端/LeRobot CLI canonical 名称，例如 `act`、`diffusion`、`pi0`、`pi05`、`smolvla`、`groot`。

### 2. 获取任务列表

**GET** `/api/v1/training/list?page=1&size=10`

### 3. 查看任务状态

**GET** `/api/v1/training/{task_id}/status`

``` json
{
  "task_id":101,
  "job_name":"pi05-grasp-v1",
  "status":"running",
  "progress":45.3,
  "logs_url":"/storage/train_logs/101.log"
}
```

### 4. 停止任务

**POST** `/api/v1/training/{task_id}/stop`

### 5. 下载模型

**GET** `/api/v1/training/{task_id}/download`

### 6. 删除训练任务

仅支持删除非运行中的任务（排队、已完成、已失败）。

**POST** `/api/v1/training/{task_id}/delete`

Response

```json
{
  "code": 0,
  "data": { "deleted": true }
}
```

------------------------------------------------------------------------

# ⚙️ **Ⅴ. Inference 模块**

### 1. 创建推理任务

**POST** `/api/v1/inference/create`

``` json
{
  "model_id":101,
  "dataset_id":42
}
```

说明：`model_id` 绑定训练任务（TrainTask.id），仅允许已完成的训练任务，且必须存在 `checkpoint_path`。

### 2. 查询推理结果

**GET** `/api/v1/inference/{task_id}/result`

``` json
{
  "code":0,
  "data":{
    "task_id":88,
    "status":"running",
    "server_host":"115.190.130.100",
    "server_port":6153,
    "checkpoint_path":"backend/storage/train_runs/task_88/checkpoints/last/pretrained_model",
    "result_path":null,
    "error_message":null
  }
}
```

------------------------------------------------------------------------

# 🧩 **Ⅵ. Simulation 模块（Pro 专属）**

### 1. 创建仿真任务

**POST** `/api/v1/sim/create`

``` json
{
  "scene_file":"warehouse.usd",
  "model_id":101,
  "robot_type":"S100",
  "training_mode":"reinforcement"
}
```

### 2. 查询仿真任务状态

**GET** `/api/v1/sim/{task_id}/status`

### 3. 硬件绑定

**POST** `/api/v1/sim/bind_device`

``` json
{"device_sn":"S100-00012"}
```

------------------------------------------------------------------------

# 🧭 **Ⅶ. Admin 模块**

### 1. 获取用户列表

**GET** `/api/v1/admin/users?page=1&role=plus`

### 2. 审核数据集

**POST** `/api/v1/admin/dataset/{id}/review`

``` json
{"status":"approved"}
```

### 3. 查看系统统计

**GET** `/api/v1/admin/overview`

------------------------------------------------------------------------

# 🗄️ **Ⅷ. 数据库设计**

### 1. 用户表 `users`

  字段            类型                                说明
  --------------- ----------------------------------- --------------
  id              INT PK                              用户ID
  phone           VARCHAR(20)                         手机号
  password_hash   VARCHAR(255)                        加密密码
  role            ENUM('free','plus','pro','admin')   用户等级
  expire_at       DATETIME                            套餐到期时间
  created_at      DATETIME                            注册时间

### 2. 数据集表 `datasets`

  字段           类型                                 说明
  -------------- ------------------------------------ ------
  id             INT PK                               
  name           VARCHAR(100)                         
  description    TEXT                                 
  owner_id       INT FK → users.id                    
  storage_path   VARCHAR(255)                         
  visibility     ENUM('private','public')             
  status         ENUM('processing','ready','error')   
  created_at     DATETIME                             

### 3. 模型任务表 `train_tasks`

  字段         类型                                            说明
  ------------ ----------------------------------------------- ------
  id           INT PK                                          
  dataset_id   INT FK                                          
  user_id      INT FK                                          
  job_name     VARCHAR(128)                 可选实验/任务名称
  model_type   VARCHAR(50)                  canonical CLI model type
  params       JSON                                            
  status       ENUM('queued','running','completed','failed')   
  progress     FLOAT                                           
  logs_url     VARCHAR(255)                                    
  model_path   VARCHAR(255)                                    
  checkpoint_path VARCHAR(255)                                 
  created_at   DATETIME                                        

### 4. 推理任务表 `inference_tasks`

  字段          类型                                            说明
  ------------- ----------------------------------------------- ------
  id            INT PK                                          
  model_id      INT FK                                          
  dataset_id    INT FK                                          
  user_id       INT FK                                          
  progress      FLOAT                                           
  assigned_node VARCHAR(64)                                     
  assigned_gpus VARCHAR(64)                                     
  server_host   VARCHAR(128)                                    
  server_port   INT                                             
  checkpoint_path VARCHAR(255)                                  
  result_path   VARCHAR(255)                                    
  status        ENUM('queued','running','completed','failed')   
  error_message TEXT                                            
  started_at    DATETIME                                        
  finished_at   DATETIME                                        
  created_at    DATETIME                                        

### 5. 仿真任务表 `sim_tasks`

  字段            类型                                            说明
  --------------- ----------------------------------------------- ------
  id              INT PK                                          
  user_id         INT FK                                          
  scene_file      VARCHAR(255)                                    
  model_id        INT FK                                          
  robot_type      VARCHAR(50)                                     
  training_mode   ENUM('supervised','reinforcement')              
  status          ENUM('queued','running','completed','failed')   
  created_at      DATETIME                                        

### 6. 设备表 `devices`

  字段        类型          说明
  ----------- ------------- ------------
  id          INT PK        
  sn          VARCHAR(50)   设备序列号
  user_id     INT FK        
  model_id    INT FK        
  bind_time   DATETIME      

### 7. 管理操作表 `admin_logs`

  字段          类型           说明
  ------------- -------------- ------
  id            INT PK         
  admin_id      INT FK         
  action        VARCHAR(100)   
  target_type   VARCHAR(50)    
  target_id     INT            
  created_at    DATETIME       

------------------------------------------------------------------------

## 🧩 模块对应责任划分

  模块                   前端负责人   后端负责人   技术栈
  ---------------------- ------------ ------------ ----------------------------
  Auth / User            前端A        后端A        Django REST + JWT
  Dataset                前端B        后端B        MinIO + Redis
  Training / Inference   前端C        后端C        Ray / PyTorch
  Simulation             前端D        后端D        IsaacSim / REST Bridge
  Admin                  前端E        后端E        Django Admin 或自建Console

------------------------------------------------------------------------

## ✅ 总结

本接口文档与数据库结构可直接作为开发实现依据，具备以下特征： -
**模块清晰** - **可扩展性强** - **一致性** - **实际落地**
