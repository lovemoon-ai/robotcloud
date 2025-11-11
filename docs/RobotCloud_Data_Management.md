# 📦 RobotCloud 数据管理模块设计文档

**版本**：v1.0\
**最后更新**：2025-11-04\
**作者**：RobotCloud Backend Team\
**适用范围**：Free / Plus / Pro 用户数据上传与训练前数据分发

------------------------------------------------------------------------

## 一、模块定位

数据管理模块负责：

1.  接收用户上传的数据包（zip / tar.gz / tar）；
2.  将其解析并存储到统一的数据目录（支持多种后端存储）；
3.  管理数据集的元信息、状态、可见性；
4.  在发起训练时，将数据包路径与存储凭证传递给 GPU Agent；
5.  实现统一的 **「数据生命周期管理」**（上传 → 解压 → 校验 → 存储 →
    训练使用 → 清理）。

------------------------------------------------------------------------

## 二、系统架构

``` text
┌────────────────────────────────────────────────────────┐
│                      RobotCloud Backend                │
│  ┌──────────────────────────────────────────────────┐  │
│  │                DataManager Service               │  │
│  │  - 接收上传文件（HTTP/Multipart）                │  │
│  │  - 自动解析并持久化元数据                        │  │
│  │  - 统一接口访问多存储后端（HDFS/MinIO/S3）       │  │
│  │  - 提供训练任务下载接口                          │  │
│  └──────────────────────────────────────────────────┘  │
│                              │                         │
│                              ▼                         │
│        ┌──────────────────────────────┐                │
│        │ Storage Adapter Layer        │                │
│        │   - LocalFS / HDFS / S3 / Custom              │
│        │   - 统一 read/write/delete/list API           │
│        └──────────────────────────────┘                │
│                              │                         │
│          ┌──────────────────────────────────────┐      │
│          │ GPU Agent                            │      │
│          │  - 接收数据URL或挂载点               │      │
│          │  - 下载/拉取数据解压至训练路径       │      │
│          └──────────────────────────────────────┘      │
└────────────────────────────────────────────────────────┘
```

------------------------------------------------------------------------

## 三、功能点设计

### 上传与解析流程

1.  上传压缩包（`.zip` / `.tar.gz`）\
2.  临时保存 → 校验格式 → 解压\
3.  分析文件结构（统计文件类型、数量、大小）\
4.  调用 StorageAdapter 上传至目标存储后端\
5.  生成 manifest（JSON 索引）\
6.  写入数据库\
7.  清理临时缓存

------------------------------------------------------------------------

## 四、存储后端支持

  类型         参数                    示例路径
  ------------ ----------------------- -------------------------------------
  LocalFS      root_path               `/mnt/data/datasets/xxx`
  HDFS         namenode, user          `hdfs://namenode:9000/datasets/xxx`
  MinIO / S3   endpoint, bucket, key   `s3://robotcloud/datasets/xxx`
  Custom       plugin_name, base_url   用户自定义第三方接口

### Adapter 接口

``` python
class StorageAdapter(ABC):
    def upload(self, local_path, dest_path): ...
    def download(self, remote_path, local_path): ...
    def list(self, remote_dir): ...
    def delete(self, remote_path): ...
    def generate_signed_url(self, remote_path, expires=3600): ...
```

------------------------------------------------------------------------

## 五、数据库设计

### datasets

  字段              类型           描述
  ----------------- -------------- --------------
  id                INT PK         数据集ID
  name              VARCHAR(128)   数据集名称
  owner_id          INT            所属用户
  storage_backend   ENUM           存储类型
  storage_path      VARCHAR(512)   路径
  manifest_path     VARCHAR(512)   索引文件路径
  num_files         INT            文件数量
  total_size        BIGINT         总大小
  file_types        JSON           文件分布统计
  visibility        ENUM           可见性
  status            ENUM           状态
  created_at        DATETIME       上传时间
  updated_at        DATETIME       更新时间

### dataset_files

  字段         类型           描述
  ------------ -------------- ------
  id           INT PK         
  dataset_id   INT FK         
  file_name    VARCHAR(255)   
  file_path    VARCHAR(512)   
  file_size    BIGINT         
  file_type    VARCHAR(32)    
  checksum     VARCHAR(64)    

------------------------------------------------------------------------

## 六、训练数据流转

1.  创建训练任务时读取 dataset 信息\
2.  调用 Adapter 生成签名 URL\
3.  下发至 GPU Agent：

``` json
{
  "dataset_id": 42,
  "dataset_backend": "minio",
  "dataset_url": "https://minio.robotcloud.local/robotcloud/datasets/42/?token=abcd",
  "manifest_url": "https://minio.robotcloud.local/robotcloud/datasets/42/manifest.json"
}
```

GPU Agent 拉取或接收（Scheduler 直传）数据包，解压、规范目录结构并传入训练脚本：

- 训练时 `--dataset.root` 指向的目录会确保包含 `data/`、`meta/`、`videos/` 三个子目录；
- 若压缩包内存在嵌套目录，Agent 会自动选择包含这些子目录的那一层作为根目录；
- 若缺少某些目录，Agent 会在根目录下创建对应的空目录以满足训练脚本约定。

------------------------------------------------------------------------

## 七、安全与性能

-   上传仅限登录用户；\
-   存储路径隔离 `/datasets/{user_id}/{dataset_id}`；\
-   签名URL 有效期 1 小时；\
-   异步解压（Celery/Ray）；\
-   分片上传（S3 multipart / TUS）；\
-   定期清理临时缓存。

------------------------------------------------------------------------

## 八、扩展方向

  功能           说明
  -------------- -----------------------
  数据版本管理   多版本追踪与回滚
  增量上传       基于 MD5 差分同步
  自动校验       检测空文件、标签错误
  数据共享       支持公开/协作共享
  快照           训练快照复现
  插件后端       支持 OSS / COS / Ceph

------------------------------------------------------------------------

## 九、总结

该模块实现：

-   多后端存储统一访问\
-   自动上传→解析→存储→分发\
-   与训练系统无缝衔接\
-   可扩展到版本管理与共享生态

------------------------------------------------------------------------
