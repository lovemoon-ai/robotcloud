"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useForm } from "react-hook-form";
import { TrainingConfig, TrainingJob } from "@/types";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocaleStore } from "@/store/useLocaleStore";
import { useThemeStore } from "@/store/useThemeStore";
import { getTrainingModelDefaults, getTrainingModelOption, LEROBOT_TRAINING_MODELS } from "@/training/models";

const ACTIVE_TRAINING_STATUSES: Array<TrainingJob["status"]> = ["queued", "running"];

function TrainPageContent() {
  const locale = useLocaleStore((state) => state.locale);
  const theme = useThemeStore((state) => state.theme);
  const client = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialDatasetId = searchParams.get("datasetId") || "";
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["training-jobs"],
    queryFn: robotCloudApi.fetchTrainingJobs,
    enabled: Boolean(token),
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs?.length) {
        return false;
      }
      const hasActive = jobs.some((job) => ACTIVE_TRAINING_STATUSES.includes(job.status));
      return hasActive ? 5000 : false;
    },
    refetchIntervalInBackground: true
  });
  const initialModelDefaults = getTrainingModelDefaults("ACT");
  const form = useForm<TrainingConfig>({
    defaultValues: {
      model: "ACT",
      datasetId: initialDatasetId,
      learningRate: initialModelDefaults.learningRate,
      steps: initialModelDefaults.steps,
      batchSize: initialModelDefaults.batchSize
    }
  });
  const selectedModelValue = form.watch("model");
  const selectedModel = getTrainingModelOption(selectedModelValue) ?? LEROBOT_TRAINING_MODELS[0];
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "模型训练",
        subtitle: "配置训练参数，实时查看任务状态与进度。",
        formHeading: "创建训练任务",
        modelLabel: "模型模板",
        datasetLabel: "数据集 ID",
        datasetRequired: "请输入数据集 ID",
        learningRateLabel: "学习率",
        batchSizeLabel: "Batch Size",
        epochsLabel: "Steps",
        presetLabel: "SO101 训练预设",
        cameraPreset: "2/3 路 RGB 相机",
        jointPreset: "6DoF joint state/action",
        taskRequired: "需要数据集 task 字段",
        taskOptional: "不依赖 task 字段",
        submit: "提交训练",
        submitting: "创建中...",
        queueHeading: "训练任务队列",
        totalLabel: (count: number) => `共 ${count} 个任务`,
        stats: (datasetId: string) => `数据集 ID：${datasetId}`,
        statusLabel: {
          queued: "等待中",
          running: "训练中",
          completed: "已完成"
        },
        logsLabel: (hasLog: boolean) => (hasLog ? "查看日志" : "日志生成中"),
        viewModel: "查看模型",
        delete: "删除",
        confirmDeleteTitle: (id: number) => `删除训练任务 #${id}`,
        confirmDeleteMessage: "此操作将从后端删除任务记录，且不可恢复。确认要删除吗？",
        confirm: "确认删除",
        cancel: "取消",
        loginNotice: "请先登录后创建训练任务，正在跳转至登录页...",
        loginPrompt: "登录后可查看我的训练任务。",
        loginLink: "前往登录",
        loading: "加载中...",
        empty: "暂无训练任务。"
      }
    : {
        title: "Model Training",
        subtitle: "Configure training parameters and monitor progress in real time.",
        formHeading: "Create Training Job",
        modelLabel: "Model Template",
        datasetLabel: "Dataset ID",
        datasetRequired: "Enter a dataset ID",
        learningRateLabel: "Learning Rate",
        batchSizeLabel: "Batch Size",
        epochsLabel: "Steps",
        presetLabel: "SO101 Training Preset",
        cameraPreset: "2/3 RGB cameras",
        jointPreset: "6DoF joint state/action",
        taskRequired: "Requires dataset task field",
        taskOptional: "Does not require task field",
        submit: "Submit Training",
        submitting: "Creating...",
        queueHeading: "Training Queue",
        totalLabel: (count: number) => `Total ${count} task${count === 1 ? "" : "s"}`,
        stats: (datasetId: string) => `Dataset: ${datasetId}`,
        statusLabel: {
          queued: "Queued",
          running: "Training",
          completed: "Completed"
        },
        logsLabel: (hasLog: boolean) => (hasLog ? "View logs" : "Logs pending"),
        viewModel: "View model",
        delete: "Delete",
        confirmDeleteTitle: (id: number) => `Delete training task #${id}`,
        confirmDeleteMessage: "This will remove the task record from the backend and cannot be undone. Proceed?",
        confirm: "Confirm Delete",
        cancel: "Cancel",
        loginNotice: "Log in before creating training jobs. Redirecting to the login page...",
        loginPrompt: "Log in to view your training jobs.",
        loginLink: "Go to login",
        loading: "Loading...",
        empty: "No training jobs yet."
      };
  const taskCount = data?.length ?? 0;
  const [logTaskId, setLogTaskId] = useState<number | null>(null);
  const [logBuffer, setLogBuffer] = useState<string>("");
  const [logOffset, setLogOffset] = useState<number>(0);
  const [logComplete, setLogComplete] = useState<boolean>(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [isLogMaximized, setIsLogMaximized] = useState<boolean>(false);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<number>>(new Set());
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const defaults = getTrainingModelDefaults(selectedModelValue);
    form.setValue("learningRate", defaults.learningRate);
    form.setValue("steps", defaults.steps);
    form.setValue("batchSize", defaults.batchSize);
  }, [form, selectedModelValue]);

  const mutation = useMutation({
    mutationFn: robotCloudApi.createTrainingJob,
    onSuccess: () => {
      setCreateError(null);
      client.invalidateQueries({ queryKey: ["training-jobs"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setCreateError(message);
    }
  });

  // Delete training job flow
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (taskId: number) => robotCloudApi.deleteTrainingJob(taskId),
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteError(null);
      client.invalidateQueries({ queryKey: ["training-jobs"] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setDeleteError(message);
    }
  });

  const closeLog = () => {
    setLogTaskId(null);
    setLogBuffer("");
    setLogOffset(0);
    setLogComplete(false);
    setLogError(null);
    setIsLogMaximized(false);
  };

  const openLog = (taskId: number) => {
    setLogTaskId(taskId);
    setLogBuffer("");
    setLogOffset(0);
    setLogComplete(false);
    setLogError(null);
  };

  useEffect(() => {
    if (!token) return;
    const raw = searchParams.get("logTaskId");
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    openLog(parsed);
  }, [searchParams, token]);

  // Poll logs while modal open
  const [pollTick, setPollTick] = useState(0);
  const shouldPoll = Boolean(logTaskId && token && !logComplete);
  useEffect(() => {
    if (!shouldPoll) return;
    let aborted = false;
    const fetchChunk = async () => {
      try {
        const chunk = await robotCloudApi.fetchTrainingLog({ taskId: logTaskId!, offset: logOffset });
        if (aborted) return;
        const newContent = chunk.content || "";
        if (newContent) setLogBuffer((prev) => prev + newContent);
        setLogOffset(chunk.nextOffset);
        setLogComplete(chunk.complete);
        setLogError(null);
        // Check if log contains "End of training" to mark task as completed
        if (newContent.includes("End of training") || (logBuffer + newContent).includes("End of training")) {
          setCompletedTaskIds((prev) => new Set(prev).add(logTaskId!));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLogError(message);
      }
    };
    fetchChunk();
    const t = setInterval(() => setPollTick((x) => x + 1), 2000);
    return () => {
      aborted = true;
      clearInterval(t);
    };
  }, [shouldPoll, logTaskId, logOffset, pollTick, token, logBuffer]);

  // Helper function to get display status for a job
  const getDisplayStatus = (job: TrainingJob): "queued" | "running" | "completed" => {
    if (job.status === "completed" || completedTaskIds.has(job.id)) {
      return "completed";
    }
    if (job.status === "running") {
      return "running";
    }
    return "queued";
  };

  const onSubmit = form.handleSubmit(async (values) => {
    if (!token) {
      setLoginNotice(copy.loginNotice);
      router.push("/login");
      return;
    }
    setLoginNotice(null);
    try {
      await mutation.mutateAsync(values);
    } catch {
      // Error handled by mutation onError.
    }
  });

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.subtitle}</p>
      </header>
      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-theme bg-card p-5">
          <h2 className="text-xl font-semibold accent-text">{copy.formHeading}</h2>
          <label className="block text-sm">
            <span className="text-muted">{copy.modelLabel}</span>
            <select {...form.register("model")} className="mt-1 w-full rounded-md border border-theme bg-surface/50 p-2">
              {LEROBOT_TRAINING_MODELS.map((model) => (
                <option key={model.value} value={model.value}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <div className="rounded-md border border-theme bg-surface/40 p-3 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold accent-text">{copy.presetLabel}</span>
              <span className="text-muted">{selectedModel.requiresTask ? copy.taskRequired : copy.taskOptional}</span>
            </div>
            <p className="mt-2 text-muted">{isZh ? selectedModel.description.zh : selectedModel.description.en}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">
              <span className="rounded border border-theme px-2 py-1">{copy.cameraPreset}</span>
              <span className="rounded border border-theme px-2 py-1">{copy.jointPreset}</span>
            </div>
          </div>
          <label className="block text-sm">
            <span className="text-muted">{copy.datasetLabel}</span>
            <input
              {...form.register("datasetId", { required: copy.datasetRequired })}
              className="mt-1 w-full rounded-md border border-theme bg-surface/50 p-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-muted">{copy.learningRateLabel}</span>
              <input
                type="number"
                step="0.000001"
                {...form.register("learningRate", { valueAsNumber: true })}
                className="mt-1 w-full rounded-md border border-theme bg-surface/50 p-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">{copy.batchSizeLabel}</span>
              <input
                type="number"
                {...form.register("batchSize", { valueAsNumber: true })}
                className="mt-1 w-full rounded-md border border-theme bg-surface/50 p-2"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-muted">{copy.epochsLabel}</span>
            <input
              type="number"
              {...form.register("steps", { valueAsNumber: true })}
              className="mt-1 w-full rounded-md border border-theme bg-surface/50 p-2"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md gradient-primary py-2 font-semibold text-white transition hover:opacity-90"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? copy.submitting : copy.submit}
          </button>
          {createError ? <p className="text-xs text-red-500">{createError}</p> : null}
        </form>
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold accent-text">{copy.queueHeading}</h2>
            {token ? <span className="text-xs text-muted">{copy.totalLabel(taskCount)}</span> : null}
          </div>
          {loginNotice ? <p className="text-sm text-primary">{loginNotice}</p> : null}
          {!token ? (
            <p className="text-sm text-muted">
              {copy.loginPrompt}
              <Link href="/login" className="ml-1 accent-text hover:text-primary">
                {copy.loginLink}
              </Link>
            </p>
          ) : null}
          {token && isLoading ? <p>{copy.loading}</p> : null}
          {token && error instanceof Error ? <p className="text-red-500">{error.message}</p> : null}
          {token ? (
            <div className="grid max-h-[24rem] gap-2 overflow-y-auto pr-2">
              {data?.map((job) => {
                const displayStatus = getDisplayStatus(job);
                return (
                  <Card key={job.id} title={`${job.model} · ${copy.statusLabel[displayStatus]}`} compact>
                    <div className="flex items-center justify-between text-[10px] text-muted">
                      <span>{copy.stats(job.datasetId.toString())}</span>
                      <div className="flex items-center gap-3">
                        {job.status === "queued" ? (
                          <span>{copy.logsLabel(false)}</span>
                        ) : (
                          <button
                            onClick={() => openLog(job.id)}
                            className="font-semibold accent-text hover:text-primary"
                            type="button"
                          >
                            {copy.logsLabel(true)}
                          </button>
                        )}
                        {displayStatus === "completed" ? (
                          <button
                            onClick={() => router.push(`/models?highlight=${job.id}`)}
                            className="font-semibold accent-text hover:text-primary"
                            type="button"
                          >
                            {copy.viewModel}
                          </button>
                        ) : null}
                        {displayStatus !== "running" ? (
                          <button
                            onClick={() => setDeleteTarget(job.id)}
                            className="font-semibold text-red-500 hover:text-red-400"
                            type="button"
                          >
                            {copy.delete}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </Card>
                );
              })}
              {!data?.length ? <p className="text-sm text-muted">{copy.empty}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
      {logTaskId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            className={`rounded-lg border border-theme p-4 shadow-xl transition-all ${isLogMaximized ? "w-full h-full max-w-none" : "w-full max-w-3xl"}`}
            style={{ backgroundColor: 'var(--color-card)' }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold accent-text">Task #{logTaskId} Logs</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsLogMaximized(!isLogMaximized)}
                  className="text-muted hover:text-body"
                  type="button"
                >
                  {isLogMaximized ? "⊖" : "⊕"}
                </button>
                <button onClick={closeLog} className="text-muted hover:text-body" type="button">
                  Close
                </button>
              </div>
            </div>
            <div
              className={`overflow-auto rounded p-3 text-xs font-mono ${isLogMaximized ? "h-[calc(100%-5rem)]" : "h-96"} ${theme === "light" ? "bg-white text-black border border-gray-200" : "bg-black text-white"}`}
            >
              <pre className="whitespace-pre-wrap leading-relaxed">{logBuffer || (logError ? `Error: ${logError}` : "Waiting for logs...")}</pre>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              <span>Offset: {logOffset}{logComplete ? " · Completed" : ""}</span>
              {!logComplete ? (
                <button
                  onClick={() => setPollTick((x) => x + 1)}
                  className="accent-text hover:text-primary"
                  type="button"
                >
                  Refresh
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-lg border border-theme p-4 shadow-xl" style={{ backgroundColor: 'var(--color-card)' }}>
            <div className="mb-2">
              <h3 className="text-lg font-semibold text-red-500">{copy.confirmDeleteTitle(deleteTarget)}</h3>
              <p className="mt-1 text-sm text-muted">{copy.confirmDeleteMessage}</p>
              {deleteError ? <p className="mt-2 text-sm text-red-500">{deleteError}</p> : null}
            </div>
            <div className="mt-3 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-theme px-3 py-1.5 text-body hover:bg-surface-secondary"
                type="button"
                disabled={deleteMutation.isPending}
              >
                {copy.cancel}
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget)}
                className="rounded-md bg-red-500 px-3 py-1.5 font-semibold text-white hover:opacity-90 disabled:opacity-60"
                type="button"
                disabled={deleteMutation.isPending}
              >
                {copy.confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

export default function TrainPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <TrainPageContent />
    </Suspense>
  );
}
