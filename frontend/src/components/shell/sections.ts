import { Locale } from "@/store/useLocaleStore";

const sectionsByLocale = {
  zh: [
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
      title: "套餐购买",
      description: "选择 Free / Plus 套餐，获取更高算力与并发。",
      href: "/plans"
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
  ],
  en: [
    {
      title: "Dashboard",
      description: "Monitor data, jobs, and plan status to keep robotics workflows efficient.",
      href: "/dashboard"
    },
    {
      title: "Datasets",
      description: "Upload, preview, and analyze multimodal datasets while protecting data assets.",
      href: "/datasets"
    },
    {
      title: "Training",
      description: "Configure training parameters and watch logs in real time to manage GPU usage.",
      href: "/train"
    },
    {
      title: "Plans",
      description: "Pick the Free, Plus plan to unlock more compute and concurrency.",
      href: "/plans"
    },
    {
      title: "Inference",
      description: "Run inference jobs on your datasets to validate model performance quickly.",
      href: "/inference"
    },
    {
      title: "Simulation & Hardware",
      description: "Connect IsaacSim/Gazebo simulations with physical robots in the field.",
      href: "/simulator"
    }
  ]
} as const satisfies Record<Locale, readonly { title: string; description: string; href: string }[]>;

export const sections = sectionsByLocale;

export function getSections(locale: Locale) {
  return sectionsByLocale[locale];
}
