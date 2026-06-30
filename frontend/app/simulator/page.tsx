"use client";

import { useQuery } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useTierGuard } from "@/hooks/useTierGuard";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function SimulatorPage() {
  const locale = useLocaleStore((state) => state.locale);
  const hasAccess = useTierGuard("pro");
  const token = useAuthStore((state) => state.token);
  const { data, isLoading, error } = useQuery({
    queryKey: ["simulator-sessions"],
    queryFn: robotCloudApi.fetchSimulatorSessions,
    enabled: hasAccess && Boolean(token)
  });
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        restrictedTitle: "仿真与硬件",
        restrictedMessage: "待解锁 IsaacSim / Gazebo 云仿真能力。",
        title: "仿真与硬件控制台",
        subtitle: "管理仿真场景与已绑定的真实机器人设备。",
        loginPrompt: "请登录后查看仿真任务。",
        loginLink: "前往登录",
        loading: "加载中...",
        cardDescription: (status: string, robotType: string) => `状态：${status} · 机器人：${robotType}`,
        jobId: (id: number) => `任务 ID：${id}`,
        modelMode: (modelId: number, mode: string) => `模型：${modelId} / 模式：${mode}`,
        createdAt: (value: string) => `创建时间：${value}`,
        empty: "暂无仿真会话。"
      }
    : {
        restrictedTitle: "Simulation & Hardware",
        restrictedMessage: "Wait to unlock IsaacSim/Gazebo cloud simulation.",
        title: "Simulation & Hardware Console",
        subtitle: "Manage simulation scenes and linked physical robots.",
        loginPrompt: "Log in to view simulation sessions.",
        loginLink: "Go to login",
        loading: "Loading...",
        cardDescription: (status: string, robotType: string) => `Status: ${status} · Robot: ${robotType}`,
        jobId: (id: number) => `Job ID: ${id}`,
        modelMode: (modelId: number, mode: string) => `Model: ${modelId} / Mode: ${mode}`,
        createdAt: (value: string) => `Created at: ${value}`,
        empty: "No simulation sessions."
      };

  if (!hasAccess) {
    return (
      <main className="space-y-4">
        <h1 className="text-3xl font-bold">{copy.restrictedTitle}</h1>
        <p className="text-sm text-muted">{copy.restrictedMessage}</p>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.subtitle}</p>
      </header>
      {!token ? (
        <p className="text-sm text-muted">
          {copy.loginPrompt}
          <Link href="/login" className="ml-1 accent-text hover:text-primary">
            {copy.loginLink}
          </Link>
        </p>
      ) : null}
      {token && isLoading ? <p>{copy.loading}</p> : null}
      {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
      {token ? (
        <div className="grid gap-4 md:grid-cols-2">
          {data?.map((session) => (
            <Card
              key={session.id}
              title={session.sceneFile}
              description={copy.cardDescription(session.status, session.robotType)}
            >
              <p className="text-xs text-muted">{copy.jobId(session.id)}</p>
              <p className="text-[11px] text-muted">{copy.modelMode(session.modelId, session.trainingMode)}</p>
              <p className="text-[11px] text-muted">{copy.createdAt(new Date(session.createdAt).toLocaleString())}</p>
            </Card>
          ))}
          {!data?.length ? <p className="text-sm text-muted">{copy.empty}</p> : null}
        </div>
      ) : null}
    </main>
  );
}
