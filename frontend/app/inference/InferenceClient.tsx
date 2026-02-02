"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function InferenceClient() {
  const locale = useLocaleStore((state) => state.locale);
  const client = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.role);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["inference-jobs"],
    queryFn: robotCloudApi.fetchInferenceJobs,
    enabled: Boolean(token),
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs?.length) return false;
      return jobs.some((job) => ["queued", "running"].includes(job.status)) ? 5000 : false;
    },
    refetchIntervalInBackground: true
  });
  const [modelId, setModelId] = useState("");
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "云端推理",
        subtitle: "部署云端推理服务，启动 policy server。",
        formHeading: "启动推理",
        modelIdLabel: "模型 ID",
        modelPlaceholder: "例如：1",
        submit: "执行推理",
        submitting: "提交中...",
        jobsHeading: "推理任务记录",
        loginNotice: "请先登录后执行推理任务，正在跳转至登录页...",
        loginPrompt: "登录后可查看推理记录。",
        loginLink: "前往登录",
        upgradeNotice: "免费用户不可使用云端推理，请升级套餐。",
        loading: "加载中...",
        modelTitle: (id: number) => `模型 ${id}`,
        statusLabel: (status: string) => `状态：${status}`,
        resultLabel: (path: string) => `结果：${path}`,
        serverLabel: (host: string, port: number) => `服务地址：${host}:${port}`,
        checkpointLabel: (path: string) => `模型路径：${path}`,
        errorLabel: (message: string) => `错误：${message}`,
        countdownLabel: (value: string) => `剩余：${value}`,
        waiting: "排队中",
        delete: "删除",
        pending: "等待云端完成",
        empty: "暂无推理记录。"
      }
    : {
        title: "Cloud Inference",
        subtitle: "Deploy a cloud policy server for async inference.",
        formHeading: "Start Inference",
        modelIdLabel: "Model ID",
        modelPlaceholder: "e.g. 1",
        submit: "Run Inference",
        submitting: "Submitting...",
        jobsHeading: "Inference Jobs",
        loginNotice: "Log in before running inference jobs. Redirecting to the login page...",
        loginPrompt: "Log in to see inference history.",
        loginLink: "Go to login",
        upgradeNotice: "Cloud inference is not available on the Free plan.",
        loading: "Loading...",
        modelTitle: (id: number) => `Model ${id}`,
        statusLabel: (status: string) => `Status: ${status}`,
        resultLabel: (path: string) => `Result: ${path}`,
        serverLabel: (host: string, port: number) => `Server: ${host}:${port}`,
        checkpointLabel: (path: string) => `Checkpoint: ${path}`,
        errorLabel: (message: string) => `Error: ${message}`,
        countdownLabel: (value: string) => `Time left: ${value}`,
        waiting: "Waiting",
        delete: "Delete",
        pending: "Waiting for cloud completion",
        empty: "No inference jobs found."
      };

  const mutation = useMutation({
    mutationFn: robotCloudApi.runInference,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["inference-jobs"] });
      setModelId("");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: number) => robotCloudApi.deleteInferenceJob(taskId),
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteError(null);
      client.invalidateQueries({ queryKey: ["inference-jobs"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setDeleteError(message);
    }
  });

  useEffect(() => {
    const initialModelId = searchParams.get("modelId");
    if (initialModelId) {
      setModelId(initialModelId);
    }
  }, [searchParams]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatCountdown = (startedAt: string | null | undefined, status: string) => {
    if (status !== "running" || !startedAt) return copy.waiting;
    const startedMs = new Date(startedAt).getTime();
    if (Number.isNaN(startedMs)) return copy.waiting;
    const remaining = Math.max(0, 600000 - (now - startedMs));
    const totalSeconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };

  const runJob = async () => {
    if (!token) {
      setLoginNotice(copy.loginNotice);
      router.push("/login");
      return;
    }
    if (role === "free") {
      setLoginNotice(copy.upgradeNotice);
      return;
    }
    setLoginNotice(null);
    if (!modelId) return;
    await mutation.mutateAsync({ modelId: Number.parseInt(modelId, 10) });
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
            className="w-full rounded-md gradient-primary py-2 font-semibold text-white transition hover:bg-primary-hover"
            disabled={!modelId || mutation.isPending || role === "free"}
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
                <Card
                  key={job.id}
                  title={copy.modelTitle(job.modelId)}
                  description={job.datasetId != null ? (isZh ? `数据集：${job.datasetId}` : `Dataset: ${job.datasetId}`) : undefined}
                >
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span>{copy.statusLabel(job.status)}</span>
                    <span>{copy.countdownLabel(formatCountdown(job.startedAt, job.status))}</span>
                  </div>
                  {job.serverHost && job.serverPort ? (
                    <p className="text-[11px] text-muted">{copy.serverLabel(job.serverHost, job.serverPort)}</p>
                  ) : null}
                  {job.checkpointPath ? (
                    <p className="text-[11px] text-muted">{copy.checkpointLabel(job.checkpointPath)}</p>
                  ) : null}
                  {job.errorMessage ? (
                    <p className="text-[11px] text-red-400">{copy.errorLabel(job.errorMessage)}</p>
                  ) : null}
                  <p className="text-[11px] text-muted">
                    {job.resultPath ? copy.resultLabel(job.resultPath) : copy.pending}
                  </p>
                  {job.status !== "running" ? (
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(job.id)}
                      className="mt-2 text-xs font-semibold text-red-500 hover:text-red-400"
                    >
                      {copy.delete}
                    </button>
                  ) : null}
                </Card>
              ))}
              {!data?.length ? <p className="text-sm text-muted">{copy.empty}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg border border-theme p-4 shadow-xl" style={{ backgroundColor: "var(--color-card)" }}>
            <div className="mb-2">
              <h3 className="text-lg font-semibold text-red-500">
                {isZh ? `删除推理任务 #${deleteTarget}` : `Delete inference task #${deleteTarget}`}
              </h3>
              <p className="mt-1 text-sm text-muted">
                {isZh
                  ? "此操作将删除推理任务记录，且不可恢复。确认要删除吗？"
                  : "This will remove the inference task record and cannot be undone. Proceed?"}
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
