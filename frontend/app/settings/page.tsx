"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";
import { useThemeStore } from "@/store/useThemeStore";

export default function SettingsPage() {
  const { locale, setLocale } = useLocaleStore((state) => ({
    locale: state.locale,
    setLocale: state.setLocale
  }));
  const { theme, setTheme } = useThemeStore((state) => ({
    theme: state.theme,
    setTheme: state.setTheme
  }));
  const { token, phone, role, reset } = useAuthStore((state) => ({
    token: state.token,
    phone: state.phone,
    role: state.role,
    reset: state.reset
  }));
  const client = useQueryClient();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "设置",
        subtitle: "管理账号、界面偏好与默认 GPU Agent。",
        accountTitle: "账号",
        accountDescription: "当前登录账号与会话控制。",
        phoneLabel: "手机号",
        roleLabel: "权限",
        logout: "退出登录",
        appearanceTitle: "界面",
        languageTitle: "语言",
        languageDescription: "切换控制台显示语言。",
        chinese: "中文",
        english: "English",
        themeTitle: "主题",
        themeDescription: "切换浅色或深色模式。",
        light: "浅色",
        dark: "深色",
        configTitle: "配置项",
        plans: {
          title: "套餐购买",
          description: "查看当前套餐并升级 Plus，获取更高算力与云端推理能力。",
          action: "打开"
        },
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
        subtitle: "Manage account, interface preferences, and the default GPU Agent.",
        accountTitle: "Account",
        accountDescription: "Current account and session controls.",
        phoneLabel: "Phone",
        roleLabel: "Role",
        logout: "Log out",
        appearanceTitle: "Interface",
        languageTitle: "Language",
        languageDescription: "Change the console display language.",
        chinese: "中文",
        english: "English",
        themeTitle: "Theme",
        themeDescription: "Switch between light and dark mode.",
        light: "Light",
        dark: "Dark",
        configTitle: "Configuration",
        plans: {
          title: "Plans",
          description: "Review your current plan and upgrade to Plus for more compute and remote inference.",
          action: "Open"
        },
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
  const handleLogout = () => {
    reset();
    router.replace("/login");
  };

  if (!token) {
    return null;
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.subtitle}</p>
      </header>
      <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-lg border border-theme bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-body">{copy.accountTitle}</h2>
              <p className="mt-1 text-sm text-muted">{copy.accountDescription}</p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md border border-theme px-3 py-2 text-sm font-semibold text-body transition hover:border-primary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {copy.logout}
            </button>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border border-theme bg-surface p-3">
              <dt className="text-xs text-muted">{copy.phoneLabel}</dt>
              <dd className="mt-1 truncate font-medium text-body">{phone}</dd>
            </div>
            <div className="rounded-md border border-theme bg-surface p-3">
              <dt className="text-xs text-muted">{copy.roleLabel}</dt>
              <dd className="mt-1 font-medium uppercase text-body">{role ?? "free"}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-lg border border-theme bg-card p-5">
          <h2 className="text-base font-semibold text-body">{copy.appearanceTitle}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold text-body">{copy.languageTitle}</h3>
                <p className="mt-1 text-xs text-muted">{copy.languageDescription}</p>
              </div>
              <div className="grid grid-cols-2 overflow-hidden rounded-md border border-theme">
                <button
                  type="button"
                  onClick={() => setLocale("zh")}
                  className={`px-3 py-2 text-sm font-semibold transition ${
                    locale === "zh" ? "bg-theme-primary text-on-primary" : "text-muted hover:bg-surface-secondary hover:text-body"
                  }`}
                >
                  {copy.chinese}
                </button>
                <button
                  type="button"
                  onClick={() => setLocale("en")}
                  className={`border-l border-theme px-3 py-2 text-sm font-semibold transition ${
                    locale === "en" ? "bg-theme-primary text-on-primary" : "text-muted hover:bg-surface-secondary hover:text-body"
                  }`}
                >
                  {copy.english}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <h3 className="text-sm font-semibold text-body">{copy.themeTitle}</h3>
                <p className="mt-1 text-xs text-muted">{copy.themeDescription}</p>
              </div>
              <div className="grid grid-cols-2 overflow-hidden rounded-md border border-theme">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`px-3 py-2 text-sm font-semibold transition ${
                    theme === "light" ? "bg-theme-primary text-on-primary" : "text-muted hover:bg-surface-secondary hover:text-body"
                  }`}
                >
                  {copy.light}
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`border-l border-theme px-3 py-2 text-sm font-semibold transition ${
                    theme === "dark" ? "bg-theme-primary text-on-primary" : "text-muted hover:bg-surface-secondary hover:text-body"
                  }`}
                >
                  {copy.dark}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section aria-label={copy.configTitle} className="grid gap-3 md:grid-cols-2">
        <Link
          href="/plans"
          className="group block rounded-lg border border-theme bg-card p-4 transition hover:border-primary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <span className="flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-base font-semibold accent-text">{copy.plans.title}</span>
              <span className="mt-1 block text-sm text-muted">{copy.plans.description}</span>
            </span>
            <span className="shrink-0 rounded-md border border-theme px-3 py-1 text-sm font-medium text-body transition group-hover:border-primary">
              {copy.plans.action}
            </span>
          </span>
        </Link>
      </section>
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
