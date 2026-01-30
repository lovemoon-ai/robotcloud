"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function InferencePage() {
  const locale = useLocaleStore((state) => state.locale);
  const client = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const { data, isLoading, error } = useQuery({
    queryKey: ["inference-jobs"],
    queryFn: robotCloudApi.fetchInferenceJobs,
    enabled: Boolean(token)
  });
  const [datasetId, setDatasetId] = useState("");
  const [modelId, setModelId] = useState("");
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "云端推理",
        subtitle: "选择数据集快速执行推理任务，查看结果准确率。",
        formHeading: "启动推理",
        datasetIdLabel: "数据集 ID",
        datasetPlaceholder: "例如：42",
        modelIdLabel: "模型 ID",
        modelPlaceholder: "例如：1",
        submit: "执行推理",
        submitting: "提交中...",
        jobsHeading: "推理任务记录",
        loginNotice: "请先登录后执行推理任务，正在跳转至登录页...",
        loginPrompt: "登录后可查看推理记录。",
        loginLink: "前往登录",
        loading: "加载中...",
        modelTitle: (id: number) => `模型 ${id}`,
        datasetLabel: (id: number) => `数据集：${id}`,
        statusLabel: (status: string) => `状态：${status}`,
        resultLabel: (path: string) => `结果：${path}`,
        pending: "等待云端完成",
        empty: "暂无推理记录。"
      }
    : {
        title: "Cloud Inference",
        subtitle: "Select a dataset to launch inference jobs and review accuracy.",
        formHeading: "Start Inference",
        datasetIdLabel: "Dataset ID",
        datasetPlaceholder: "e.g. 42",
        modelIdLabel: "Model ID",
        modelPlaceholder: "e.g. 1",
        submit: "Run Inference",
        submitting: "Submitting...",
        jobsHeading: "Inference Jobs",
        loginNotice: "Log in before running inference jobs. Redirecting to the login page...",
        loginPrompt: "Log in to see inference history.",
        loginLink: "Go to login",
        loading: "Loading...",
        modelTitle: (id: number) => `Model ${id}`,
        datasetLabel: (id: number) => `Dataset: ${id}`,
        statusLabel: (status: string) => `Status: ${status}`,
        resultLabel: (path: string) => `Result: ${path}`,
        pending: "Waiting for cloud completion",
        empty: "No inference jobs found."
      };

  const mutation = useMutation({
    mutationFn: robotCloudApi.runInference,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["inference-jobs"] });
      setDatasetId("");
      setModelId("");
    }
  });

  const runJob = async () => {
    if (!token) {
      setLoginNotice(copy.loginNotice);
      router.push("/login");
      return;
    }
    setLoginNotice(null);
    if (!datasetId || !modelId) return;
    await mutation.mutateAsync({ datasetId: Number.parseInt(datasetId, 10), modelId: Number.parseInt(modelId, 10) });
  };

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.subtitle}</p>
      </header>
      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4 rounded-xl border border-theme p-5" style={{ backgroundColor: 'var(--color-card)' }}>
          <h2 className="text-xl font-semibold accent-text">{copy.formHeading}</h2>
          <label className="block text-sm">
            <span className="text-muted">{copy.datasetIdLabel}</span>
            <input
              value={datasetId}
              onChange={(event) => setDatasetId(event.target.value)}
              className="mt-1 w-full rounded-md border border-theme bg-surface-secondary/50 p-2"
              placeholder={copy.datasetPlaceholder}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">{copy.modelIdLabel}</span>
            <input
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              className="mt-1 w-full rounded-md border border-theme bg-surface-secondary/50 p-2"
              placeholder={copy.modelPlaceholder}
            />
          </label>
          <button
            onClick={runJob}
            className="w-full rounded-md gradient-primary py-2 font-semibold text-inverse transition hover:bg-primary-hover"
            disabled={!datasetId || !modelId || mutation.isPending}
          >
            {mutation.isPending ? copy.submitting : copy.submit}
          </button>
        </div>
        <div className="space-y-3">
          <h2 className="text-xl font-semibold accent-text">{copy.jobsHeading}</h2>
          {loginNotice ? <p className="text-sm text-body">{loginNotice}</p> : null}
          {!token ? (
            <p className="text-sm text-muted">
              {copy.loginPrompt}{" "}
              <Link href="/login" className="accent-text hover:text-body">
                {copy.loginLink}
              </Link>
            </p>
          ) : null}
          {token && isLoading ? <p>{copy.loading}</p> : null}
          {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
          {token ? (
            <div className="grid gap-3">
              {data?.map((job) => (
                <Card key={job.id} title={copy.modelTitle(job.modelId)} description={copy.datasetLabel(job.datasetId)}>
                  <p className="text-xs text-muted">{copy.statusLabel(job.status)}</p>
                  <p className="text-[11px] text-muted">
                    {job.resultPath ? copy.resultLabel(job.resultPath) : copy.pending}
                  </p>
                </Card>
              ))}
              {!data?.length ? <p className="text-sm text-muted">{copy.empty}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
