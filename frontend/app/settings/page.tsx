"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function SettingsPage() {
  const locale = useLocaleStore((state) => state.locale);
  const token = useAuthStore((state) => state.token);
  const client = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "设置",
        subtitle: "管理默认 GPU Agent，数据集上传会直传到选中的节点。",
        loginPrompt: "登录后可配置默认 GPU Agent。",
        loginLink: "前往登录",
        loading: "加载中...",
        empty: "当前没有在线 GPU Agent。",
        saved: "默认 GPU Agent 已更新",
        save: "设为默认",
        default: "默认",
        uploadReady: "可接收上传",
        uploadBlocked: "未配置上传地址",
        node: {
          gpu: (busy: number, total: number) => `GPU 使用：${busy}/${total}`,
          endpoint: (value: string) => `上传地址：${value}`,
          heartbeat: (value: string) => `心跳：${value}`
        }
      }
    : {
        title: "Settings",
        subtitle: "Manage the default GPU Agent. Dataset uploads go directly to the selected node.",
        loginPrompt: "Log in to configure the default GPU Agent.",
        loginLink: "Go to login",
        loading: "Loading...",
        empty: "No GPU Agent is online.",
        saved: "Default GPU Agent updated",
        save: "Set default",
        default: "Default",
        uploadReady: "Upload ready",
        uploadBlocked: "Upload URL missing",
        node: {
          gpu: (busy: number, total: number) => `GPU usage: ${busy}/${total}`,
          endpoint: (value: string) => `Upload URL: ${value}`,
          heartbeat: (value: string) => `Heartbeat: ${value}`
        }
      };

  const agentsQuery = useQuery({
    queryKey: ["agents", "active"],
    queryFn: robotCloudApi.listActiveAgents,
    enabled: Boolean(token)
  });
  const settingsQuery = useQuery({
    queryKey: ["user", "settings"],
    queryFn: robotCloudApi.getUserSettings,
    enabled: Boolean(token)
  });
  const mutation = useMutation({
    mutationFn: robotCloudApi.updateDefaultAgent,
    onSuccess: () => {
      setMessage(copy.saved);
      client.invalidateQueries({ queryKey: ["agents", "active"] });
      client.invalidateQueries({ queryKey: ["user", "settings"] });
    },
    onError: (error: unknown) => {
      setMessage(error instanceof Error ? error.message : null);
    }
  });

  const defaultNode = settingsQuery.data?.defaultAgentNode || agentsQuery.data?.defaultAgentNode || "";

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.subtitle}</p>
      </header>
      {!token ? (
        <p className="rounded-md border border-primary/30 accent-bg p-3 text-sm text-primary-light">
          {copy.loginPrompt}
          <Link href="/login" className="ml-1 text-primary-lighter link">
            {copy.loginLink}
          </Link>
        </p>
      ) : null}
      {token && agentsQuery.isLoading ? <p className="text-sm text-muted">{copy.loading}</p> : null}
      {token && message ? <p className="text-sm accent-text">{message}</p> : null}
      {token ? (
        <section className="grid gap-4 md:grid-cols-2">
          {agentsQuery.data?.items.map((agent) => (
            <Card
              key={agent.nodeName}
              title={agent.nodeName}
              description={`${agent.ip}:${agent.apiPort} · ${agent.version || "unknown"}`}
            >
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded border border-theme px-2 py-1 text-muted">
                    {copy.node.gpu(agent.gpuBusy, agent.gpuTotal)}
                  </span>
                  <span className="rounded border border-theme px-2 py-1 text-muted">
                    {agent.canUpload ? copy.uploadReady : copy.uploadBlocked}
                  </span>
                  {agent.nodeName === defaultNode ? (
                    <span className="rounded border border-primary/40 px-2 py-1 accent-text">{copy.default}</span>
                  ) : null}
                </div>
                {agent.publicBaseUrl ? (
                  <p className="break-all text-xs text-muted">{copy.node.endpoint(agent.publicBaseUrl)}</p>
                ) : null}
                {agent.lastHeartbeat ? (
                  <p className="text-xs text-muted">
                    {copy.node.heartbeat(new Date(agent.lastHeartbeat).toLocaleString())}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="rounded-md gradient-primary px-3 py-2 text-sm font-semibold text-white transition disabled:opacity-50"
                  disabled={!agent.canUpload || agent.nodeName === defaultNode || mutation.isPending}
                  onClick={() => mutation.mutate(agent.nodeName)}
                >
                  {copy.save}
                </button>
              </div>
            </Card>
          ))}
          {!agentsQuery.data?.items.length ? <p className="text-sm text-muted">{copy.empty}</p> : null}
        </section>
      ) : null}
    </main>
  );
}
