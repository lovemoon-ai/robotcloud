export const sections = [
  {
    title: "控制面板",
    description: "快速查看数据、任务与套餐状态，洞察研发效率。",
    href: "/dashboard"
  },
  {
    title: "数据集管理",
    description: "上传、预览与分析多模态数据集，保障数据资产安全。",
    href: "/datasets"
  },
  {
    title: "模型训练",
    description: "配置训练参数并实时监控日志，掌控 GPU 资源使用。",
    href: "/train"
  },
  {
    title: "云端推理",
    description: "对数据集执行推理任务，快速验证模型效果。",
    href: "/inference"
  },
  {
    title: "仿真与硬件",
    description: "连接 IsaacSim / Gazebo 仿真与真实机器人。",
    href: "/simulator"
  }
] as const;
