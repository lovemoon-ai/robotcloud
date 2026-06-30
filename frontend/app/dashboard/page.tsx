"use client";

import { useQuery } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function DashboardPage() {
  const locale = useLocaleStore((state) => state.locale);
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: robotCloudApi.fetchDashboard,
    enabled: Boolean(token)
  });
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "个人控制面板",
        subtitle: "了解账号套餐、GPU 使用与任务运行情况。",
        loginPrompt: "请登录后查看控制面板数据。",
        loginLink: "前往登录",
        loading: "加载中...",
        cards: {
          activeJobs: { title: "活跃任务", description: "正在排队或运行的训练/推理数量" },
          datasets: { title: "数据集数量", description: "已上传的多模态数据集" },
          tier: { title: "套餐等级", description: "当前可用功能权限" },
          gpu: { title: "累计 GPU 小时", description: "训练与推理累计消耗" }
        }
      }
    : {
        title: "Personal Dashboard",
        subtitle: "Track your plan, GPU usage, and running jobs in one place.",
        loginPrompt: "Log in to see your dashboard data.",
        loginLink: "Go to login",
        loading: "Loading...",
        cards: {
          activeJobs: { title: "Active Jobs", description: "Training or inference jobs that are queued or running" },
          datasets: { title: "Datasets", description: "Multimodal datasets you've uploaded" },
          tier: { title: "Plan Tier", description: "Feature access available for your account" },
          gpu: { title: "GPU Hours Used", description: "Total GPU hours consumed across training and inference" }
        }
      };

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.subtitle}</p>
      </header>
      {!token ? (
        <p className="text-sm text-muted">
          {copy.loginPrompt}
          <Link href="/login" className="ml-1 accent-text hover:opacity-80">
            {copy.loginLink}
          </Link>
        </p>
      ) : null}
      {token && isLoading ? <p>{copy.loading}</p> : null}
      {token && error instanceof Error ? <p className="text-red-500">{error.message}</p> : null}
      {token && data ? (
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card title={copy.cards.activeJobs.title} description={copy.cards.activeJobs.description}>
            <span className="text-3xl font-bold accent-text">{data.activeJobs}</span>
          </Card>
          <Card title={copy.cards.datasets.title} description={copy.cards.datasets.description}>
            <span className="text-3xl font-bold accent-text">{data.datasets}</span>
          </Card>
          <Card title={copy.cards.tier.title} description={copy.cards.tier.description}>
            <span className="text-2xl font-semibold uppercase accent-text">
              {role ?? data.tier}
            </span>
          </Card>
          <Card title={copy.cards.gpu.title} description={copy.cards.gpu.description}>
            <span className="text-3xl font-bold accent-text">{data.gpuHours.toFixed(1)}</span>
          </Card>
        </section>
      ) : null}
    </main>
  );
}
