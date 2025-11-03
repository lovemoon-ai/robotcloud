"use client";

import { useQuery } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useTierGuard } from "@/hooks/useTierGuard";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";

export default function SimulatorPage() {
  const hasAccess = useTierGuard("pro");
  const token = useAuthStore((state) => state.token);
  const { data, isLoading, error } = useQuery({
    queryKey: ["simulator-sessions"],
    queryFn: robotCloudApi.fetchSimulatorSessions,
    enabled: hasAccess && Boolean(token)
  });

  if (!hasAccess) {
    return (
      <main className="space-y-4">
        <h1 className="text-3xl font-bold">仿真与硬件</h1>
        <p className="text-sm text-slate-300">仅 Pro 套餐可用，请升级后解锁 IsaacSim / Gazebo 云仿真能力。</p>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">仿真与硬件控制台</h1>
        <p className="text-sm text-slate-300">管理仿真场景与已绑定的真实机器人设备。</p>
      </header>
      {!token ? (
        <p className="text-sm text-slate-400">
          请登录后查看仿真任务。
          <Link href="/login" className="ml-1 text-teal-300 hover:text-teal-200">
            前往登录
          </Link>
        </p>
      ) : null}
      {token && isLoading ? <p>加载中...</p> : null}
      {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
      {token ? (
        <div className="grid gap-4 md:grid-cols-2">
          {data?.map((session) => (
            <Card
              key={session.id}
              title={session.sceneFile}
              description={`状态：${session.status} · 机器人：${session.robotType}`}
            >
              <p className="text-xs text-slate-300">任务 ID：{session.id}</p>
              <p className="text-[11px] text-slate-500">
                模型：{session.modelId} / 模式：{session.trainingMode}
              </p>
              <p className="text-[11px] text-slate-500">创建时间：{new Date(session.createdAt).toLocaleString()}</p>
            </Card>
          ))}
          {!data?.length ? <p className="text-sm text-slate-400">暂无仿真会话。</p> : null}
        </div>
      ) : null}
    </main>
  );
}
