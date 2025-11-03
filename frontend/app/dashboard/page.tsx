"use client";

import { useQuery } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";

export default function DashboardPage() {
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: robotCloudApi.fetchDashboard,
    enabled: Boolean(token)
  });

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">个人控制面板</h1>
        <p className="text-sm text-slate-300">了解账号套餐、GPU 使用与任务运行情况。</p>
      </header>
      {!token ? (
        <p className="text-sm text-slate-400">
          请登录后查看控制面板数据。
          <Link href="/login" className="ml-1 text-teal-300 hover:text-teal-200">
            前往登录
          </Link>
        </p>
      ) : null}
      {token && isLoading ? <p>加载中...</p> : null}
      {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
      {token && data ? (
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card title="活跃任务" description="正在排队或运行的训练/推理数量">
            <span className="text-3xl font-bold text-teal-300">{data.activeJobs}</span>
          </Card>
          <Card title="数据集数量" description="已上传的多模态数据集">
            <span className="text-3xl font-bold text-teal-300">{data.datasets}</span>
          </Card>
          <Card title="套餐等级" description="当前可用功能权限">
            <span className="text-2xl font-semibold uppercase text-teal-200">
              {role ?? data.tier}
            </span>
          </Card>
          <Card title="累计 GPU 小时" description="训练与推理累计消耗">
            <span className="text-3xl font-bold text-teal-300">{data.gpuHours.toFixed(1)}</span>
          </Card>
        </section>
      ) : null}
    </main>
  );
}
