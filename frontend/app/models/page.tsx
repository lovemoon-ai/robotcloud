"use client";

import { useQuery } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function ModelsPage() {
  const locale = useLocaleStore((state) => state.locale);
  const token = useAuthStore((state) => state.token);
  const { data, isLoading, error } = useQuery({
    queryKey: ["models"],
    queryFn: robotCloudApi.fetchModels,
    enabled: Boolean(token)
  });
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "模型管理",
        subtitle: "查看与管理训练完成的模型，追溯训练参数与数据集。",
        list: {
          heading: "模型列表",
          loginPrompt: "登录后可查看个人模型列表。",
          loginLink: "前往登录",
          loading: "加载中...",
          empty: "暂无模型，训练完成后可在此管理。",
          modelType: (value: string) => `模型类型：${value}`,
          dataset: (value: string | null) => `数据集：${value || "未知"}`,
          createdAt: (value: string) => `创建时间：${value}`,
          meta: {
            id: (value: number) => `模型 ID：${value}`,
            path: (value: string | null) => value ? `路径：${value}` : null
          }
        }
      }
    : {
        title: "Model Management",
        subtitle: "View and manage trained models, trace training parameters and datasets.",
        list: {
          heading: "Model List",
          loginPrompt: "Log in to view your models.",
          loginLink: "Go to login",
          loading: "Loading...",
          empty: "No models yet. Complete training to manage them here.",
          modelType: (value: string) => `Model Type: ${value}`,
          dataset: (value: string | null) => `Dataset: ${value || "Unknown"}`,
          createdAt: (value: string) => `Created at: ${value}`,
          meta: {
            id: (value: number) => `Model ID: ${value}`,
            path: (value: string | null) => value ? `Path: ${value}` : null
          }
        }
      };

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.subtitle}</p>
      </header>
      <section>
        <h2 className="text-xl font-semibold accent-text mb-4">{copy.list.heading}</h2>
        {!token ? (
          <p className="text-sm text-muted">
            {copy.list.loginPrompt}
            <Link href="/login" className="ml-1 accent-text hover:text-primary-light">
              {copy.list.loginLink}
            </Link>
          </p>
        ) : null}
        {token && isLoading ? <p>{copy.list.loading}</p> : null}
        {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
        {token ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {data?.map((model) => (
              <Card key={model.modelId} title={model.name} description={copy.list.modelType(model.modelType)}>
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{copy.list.dataset(model.datasetName)}</span>
                </div>
                {(() => {
                  const segments: string[] = [copy.list.meta.id(model.modelId)];
                  const pathInfo = copy.list.meta.path(model.modelPath);
                  if (pathInfo) {
                    segments.push(pathInfo);
                  }
                  return segments.length ? (
                    <p className="mt-2 text-[11px] text-muted">{segments.join(" • ")}</p>
                  ) : null;
                })()}
                <p className="mt-2 text-[11px] text-muted">
                  {copy.list.createdAt(new Date(model.createdAt).toLocaleString())}
                </p>
              </Card>
            ))}
            {!data?.length ? <p className="text-sm text-muted col-span-full">{copy.list.empty}</p> : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
