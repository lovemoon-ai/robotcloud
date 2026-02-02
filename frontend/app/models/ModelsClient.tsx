"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useLocaleStore } from "@/store/useLocaleStore";
import { useRouter, useSearchParams } from "next/navigation";

export default function ModelsClient() {
  const locale = useLocaleStore((state) => state.locale);
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const router = useRouter();
  const searchParams = useSearchParams();
  const client = useQueryClient();
  const [highlightModelId, setHighlightModelId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const cardRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const { data, isLoading, error } = useQuery({
    queryKey: ["models"],
    queryFn: robotCloudApi.fetchModels,
    enabled: Boolean(token)
  });
  const deleteMutation = useMutation({
    mutationFn: (modelId: number) => robotCloudApi.deleteModel(modelId),
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteError(null);
      client.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setDeleteError(message);
    }
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
            path: (value: string | null) => (value ? `路径：${value}` : null),
            checkpoint: (value: string | null) => (value ? `Checkpoint：${value}` : null),
            detail: "查看详情",
            delete: "删除",
            infer: "推理",
            inferDisabled: "免费用户不可推理"
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
            path: (value: string | null) => (value ? `Path: ${value}` : null),
            checkpoint: (value: string | null) => (value ? `Checkpoint: ${value}` : null),
            detail: "View details",
            delete: "Delete",
            infer: "Inference",
            inferDisabled: "Free plan only"
          }
        }
      };

  useEffect(() => {
    const raw = searchParams.get("highlight");
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setHighlightModelId(parsed);
    const node = cardRefs.current[parsed];
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const timeout = setTimeout(() => setHighlightModelId(null), 3000);
    return () => clearTimeout(timeout);
  }, [searchParams, data?.length]);

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
            {data?.map((model) => {
              const segments: string[] = [copy.list.meta.id(model.modelId)];
              const pathInfo = copy.list.meta.path(model.modelPath);
              const checkpointInfo = copy.list.meta.checkpoint(model.checkpointPath ?? null);
              if (pathInfo) segments.push(pathInfo);
              if (checkpointInfo) segments.push(checkpointInfo);
              const isHighlighted = highlightModelId === model.modelId;
              return (
                <div key={model.modelId} ref={(node) => { cardRefs.current[model.modelId] = node; }}>
                  <Card
                    title={model.name}
                    description={copy.list.modelType(model.modelType)}
                    className={isHighlighted ? "ring-2 ring-primary shadow-lg animate-pulse" : ""}
                  >
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>{copy.list.dataset(model.datasetName)}</span>
                    </div>
                    {segments.length ? (
                      <p className="mt-2 text-[11px] text-muted break-words">{segments.join(" • ")}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Link href={`/models/detail?modelId=${model.modelId}`} className="inline-flex text-xs accent-text hover:text-primary">
                        {copy.list.meta.detail}
                      </Link>
                      <button
                        type="button"
                        onClick={() => router.push(`/inference?modelId=${model.modelId}`)}
                        className={`text-xs font-semibold ${role === "free" ? "text-muted cursor-not-allowed" : "accent-text hover:text-primary"}`}
                        disabled={role === "free"}
                        title={role === "free" ? copy.list.meta.inferDisabled : undefined}
                      >
                        {copy.list.meta.infer}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(model.modelId)}
                        className="text-xs font-semibold text-red-500 hover:text-red-400"
                      >
                        {copy.list.meta.delete}
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-muted">
                      {copy.list.createdAt(new Date(model.createdAt).toLocaleString())}
                    </p>
                  </Card>
                </div>
              );
            })}
            {!data?.length ? <p className="text-sm text-muted col-span-full">{copy.list.empty}</p> : null}
          </div>
        ) : null}
      </section>
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg border border-theme p-4 shadow-xl" style={{ backgroundColor: "var(--color-card)" }}>
            <div className="mb-2">
              <h3 className="text-lg font-semibold text-red-500">
                {isZh ? `删除模型 #${deleteTarget}` : `Delete model #${deleteTarget}`}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {isZh
                  ? "此操作将删除模型记录，且不可恢复。确认要删除吗？"
                  : "This will remove the model record and cannot be undone. Proceed?"}
              </p>
              {deleteError ? <p className="mt-2 text-sm text-red-500">{deleteError}</p> : null}
            </div>
            <div className="mt-3 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-theme px-3 py-1.5 text-body hover:bg-surface-secondary"
                type="button"
                disabled={deleteMutation.isPending}
              >
                {isZh ? "取消" : "Cancel"}
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget)}
                className="rounded-md bg-red-500 px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
                type="button"
                disabled={deleteMutation.isPending}
              >
                {isZh ? "确认删除" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
