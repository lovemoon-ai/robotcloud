"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function ModelDetailPage() {
  const locale = useLocaleStore((state) => state.locale);
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const params = useParams<{ modelId?: string }>();
  const modelId = Number(params?.modelId);
  const isValidId = Number.isFinite(modelId) && modelId > 0;
  const isZh = locale === "zh";

  const copy = isZh
    ? {
        title: "模型详情",
        back: "返回模型管理",
        invalid: "模型 ID 无效。",
        loginPrompt: "请先登录后查看模型详情。",
        loginLink: "前往登录",
        loading: "加载中...",
        notFound: "未找到该模型。",
        fields: {
          id: "模型 ID",
          name: "名称",
          type: "模型类型",
          dataset: "数据集",
          createdAt: "创建时间",
          modelPath: "模型路径",
          checkpointPath: "Checkpoint 路径"
        }
      }
    : {
        title: "Model Details",
        back: "Back to Models",
        invalid: "Invalid model id.",
        loginPrompt: "Log in to view model details.",
        loginLink: "Go to login",
        loading: "Loading...",
        notFound: "Model not found.",
        fields: {
          id: "Model ID",
          name: "Name",
          type: "Model Type",
          dataset: "Dataset",
          createdAt: "Created at",
          modelPath: "Model Path",
          checkpointPath: "Checkpoint Path"
        }
      };

  const { data, isLoading, error } = useQuery({
    queryKey: ["model-detail", modelId],
    queryFn: () => robotCloudApi.getModel(modelId),
    enabled: Boolean(token) && isValidId
  });

  if (!isValidId) {
    return (
      <main className="space-y-4">
        <h1 className="text-2xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.invalid}</p>
        <button onClick={() => router.push("/models")} className="text-sm accent-text hover:text-primary">
          {copy.back}
        </button>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <Link href="/models" className="text-sm accent-text hover:text-primary">
          {copy.back}
        </Link>
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
      {token && error instanceof Error ? <p className="text-sm text-red-400">{error.message}</p> : null}
      {token && data ? (
        <div className="space-y-3 rounded-xl border border-theme p-5" style={{ backgroundColor: "var(--color-card)" }}>
          <div className="text-sm text-muted">{copy.fields.id}: {data.modelId}</div>
          <div className="text-sm text-muted">{copy.fields.name}: {data.name}</div>
          <div className="text-sm text-muted">{copy.fields.type}: {data.modelType}</div>
          <div className="text-sm text-muted">
            {copy.fields.dataset}: {data.datasetName || data.datasetId}
          </div>
          <div className="text-sm text-muted">
            {copy.fields.createdAt}: {new Date(data.createdAt).toLocaleString()}
          </div>
          {data.modelPath ? (
            <div className="text-sm text-muted">{copy.fields.modelPath}: {data.modelPath}</div>
          ) : null}
          {data.checkpointPath ? (
            <div className="text-sm text-muted">{copy.fields.checkpointPath}: {data.checkpointPath}</div>
          ) : null}
        </div>
      ) : null}
      {token && !isLoading && !data && !error ? <p className="text-sm text-muted">{copy.notFound}</p> : null}
    </main>
  );
}
