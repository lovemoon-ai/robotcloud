"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useForm } from "react-hook-form";
import { TrainingConfig, TrainingJob } from "@/types";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocaleStore } from "@/store/useLocaleStore";

const ACTIVE_TRAINING_STATUSES: Array<TrainingJob["status"]> = ["queued", "running"];

export default function TrainPage() {
  const locale = useLocaleStore((state) => state.locale);
  const client = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["training-jobs"],
    queryFn: robotCloudApi.fetchTrainingJobs,
    enabled: Boolean(token),
    refetchInterval: (jobs: TrainingJob[] | undefined) => {
      if (!jobs?.length) {
        return false;
      }
      const hasActive = jobs.some((job) => ACTIVE_TRAINING_STATUSES.includes(job.status));
      return hasActive ? 5000 : false;
    },
    refetchIntervalInBackground: true
  });
  const form = useForm<TrainingConfig>({
    defaultValues: { model: "ACT", datasetId: "", learningRate: 0.001, steps: 5000, batchSize: 16 }
  });
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
        submit: "提交训练",
        submitting: "创建中...",
        queueHeading: "训练任务队列",
        totalLabel: (count: number) => `共 ${count} 个任务`,
        stats: (datasetId: string, progress: number) => `数据集 ID：${datasetId} · 进度：${progress}%`,
        logsLabel: (hasLog: boolean) => (hasLog ? "查看日志" : "日志生成中"),
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
        submit: "Submit Training",
        submitting: "Creating...",
        queueHeading: "Training Queue",
        totalLabel: (count: number) => `Total ${count} task${count === 1 ? "" : "s"}`,
        stats: (datasetId: string, progress: number) => `Dataset: ${datasetId} · Progress: ${progress}%`,
        logsLabel: (hasLog: boolean) => (hasLog ? "View logs" : "Logs pending"),
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

  const mutation = useMutation({
    mutationFn: robotCloudApi.createTrainingJob,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["training-jobs"] });
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
  };

  const openLog = (taskId: number) => {
    setLogTaskId(taskId);
    setLogBuffer("");
    setLogOffset(0);
    setLogComplete(false);
    setLogError(null);
  };

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
        if (chunk.content) setLogBuffer((prev) => prev + chunk.content);
        setLogOffset(chunk.nextOffset);
        setLogComplete(chunk.complete);
        setLogError(null);
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
  }, [shouldPoll, logTaskId, logOffset, pollTick, token]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!token) {
      setLoginNotice(copy.loginNotice);
      router.push("/login");
      return;
    }
    setLoginNotice(null);
    await mutation.mutateAsync(values);
  });

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-slate-300">{copy.subtitle}</p>
      </header>
      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="text-xl font-semibold text-teal-300">{copy.formHeading}</h2>
          <label className="block text-sm">
            <span className="text-slate-300">{copy.modelLabel}</span>
            <select {...form.register("model")} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2">
              <option value="ACT">ACT</option>
              <option value="DiffusionPolicy">DiffusionPolicy</option>
              <option value="SmolVLA">SmolVLA</option>
              <option value="Pi0">Pi0</option>
              <option value="Pi0.5">Pi0.5</option>
              <option value="GR00T_N1.5">GR00T_N1.5</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">{copy.datasetLabel}</span>
            <input
              {...form.register("datasetId", { required: copy.datasetRequired })}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-300">{copy.learningRateLabel}</span>
              <input
                type="number"
                step="0.0001"
                {...form.register("learningRate", { valueAsNumber: true })}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-300">{copy.batchSizeLabel}</span>
              <input
                type="number"
                {...form.register("batchSize", { valueAsNumber: true })}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-300">{copy.epochsLabel}</span>
            <input
              type="number"
              {...form.register("steps", { valueAsNumber: true })}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-teal-500 py-2 font-semibold text-slate-950 transition hover:bg-teal-400"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? copy.submitting : copy.submit}
          </button>
        </form>
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold text-teal-300">{copy.queueHeading}</h2>
            {token ? <span className="text-xs text-slate-400">{copy.totalLabel(taskCount)}</span> : null}
          </div>
          {loginNotice ? <p className="text-sm text-teal-200">{loginNotice}</p> : null}
          {!token ? (
            <p className="text-sm text-slate-400">
              {copy.loginPrompt}
              <Link href="/login" className="ml-1 text-teal-300 hover:text-teal-200">
                {copy.loginLink}
              </Link>
            </p>
          ) : null}
          {token && isLoading ? <p>{copy.loading}</p> : null}
          {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
          {token ? (
            <div className="grid max-h-[24rem] gap-2 overflow-y-auto pr-2">
              {data?.map((job) => (
                <Card key={job.id} title={`${job.model} · ${job.status}`} compact>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{copy.stats(job.datasetId.toString(), job.progress)}</span>
                    <div className="flex items-center gap-3">
                      {job.status === "queued" ? (
                        <span>{copy.logsLabel(false)}</span>
                      ) : (
                        <button
                          onClick={() => openLog(job.id)}
                          className="font-semibold text-teal-300 hover:text-teal-200"
                          type="button"
                        >
                          {copy.logsLabel(true)}
                        </button>
                      )}
                      {job.status !== "running" ? (
                        <button
                          onClick={() => setDeleteTarget(job.id)}
                          className="font-semibold text-red-400 hover:text-red-300"
                          type="button"
                        >
                          {copy.delete}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-teal-400 transition-all" style={{ width: `${job.progress}%` }} />
                  </div>
                </Card>
              ))}
              {!data?.length ? <p className="text-sm text-slate-400">{copy.empty}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
      {logTaskId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-teal-300">Task #{logTaskId} Logs</h3>
              <button onClick={closeLog} className="text-slate-300 hover:text-white" type="button">
                Close
              </button>
            </div>
            <div className="h-96 overflow-auto rounded bg-black p-3 text-xs text-slate-200">
              <pre className="whitespace-pre-wrap leading-relaxed">{logBuffer || (logError ? `Error: ${logError}` : "Waiting for logs...")}</pre>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>Offset: {logOffset}{logComplete ? " · Completed" : ""}</span>
              {!logComplete ? (
                <button
                  onClick={() => setPollTick((x) => x + 1)}
                  className="text-teal-300 hover:text-teal-200"
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
          <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <div className="mb-2">
              <h3 className="text-lg font-semibold text-red-300">{copy.confirmDeleteTitle(deleteTarget)}</h3>
              <p className="mt-1 text-sm text-slate-300">{copy.confirmDeleteMessage}</p>
              {deleteError ? <p className="mt-2 text-sm text-red-400">{deleteError}</p> : null}
            </div>
            <div className="mt-3 flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-slate-200 hover:bg-slate-800"
                type="button"
                disabled={deleteMutation.isPending}
              >
                {copy.cancel}
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget)}
                className="rounded-md bg-red-500 px-3 py-1.5 font-semibold text-slate-950 hover:bg-red-400 disabled:opacity-60"
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
