"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildTrainingParams,
  isPi05TrainingModel,
  PI05_BASE_MODEL,
  PI05_DEFAULT_LEARNING_RATE,
  robotCloudApi
} from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useForm } from "react-hook-form";
import { TrainingConfig, TrainingJob } from "@/types";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocaleStore } from "@/store/useLocaleStore";
import { useThemeStore } from "@/store/useThemeStore";

const ACTIVE_TRAINING_STATUSES: Array<TrainingJob["status"]> = ["queued", "running"];
const LOG_CHUNK_LIMIT = 1024 * 1024;
const LOG_POLL_INTERVAL_MS = 2000;
const PI05_PRESETS = {
  memory: { batchSize: 1, gradientCheckpointing: true },
  balanced: { batchSize: 8, gradientCheckpointing: true },
  throughput: { batchSize: 16, gradientCheckpointing: false }
} as const;

const DEFAULT_TRAINING_VALUES: TrainingConfig = {
  model: "ACT",
  datasetId: "",
  learningRate: 0.001,
  steps: 5000,
  batchSize: 16,
  pi05Preset: "memory",
  pi05TrainingScope: "expert"
};

function formatParams(params: Record<string, unknown>) {
  return JSON.stringify(params, null, 2);
}

function parseParams(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Training params must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function normalizeLogContent(content: string) {
  return content.replace(/\r(?!\n)/g, "\n");
}

// tqdm-style progress bars (e.g. "Training:  89%|████▉ | 17863/20000 [1:22:35<09:08, 3.90step/s]")
// are emitted many times per second and, once their carriage returns are turned
// into newlines, flood the log with near-identical lines. Detect such lines so we
// can keep only the most recent snapshot of each contiguous run.
const TQDM_PROGRESS_RE = /\d{1,3}%\s*\|/;

// Collapse consecutive tqdm progress lines, keeping only the last line of each run.
// Non-progress lines (and progress bars separated by other output) are preserved,
// so a final "100%" bar still remains visible.
function collapseProgressLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (
      TQDM_PROGRESS_RE.test(line) &&
      lines[i + 1] !== undefined &&
      TQDM_PROGRESS_RE.test(lines[i + 1])
    ) {
      // A later progress line supersedes this one; drop this intermediate snapshot.
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

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
  const form = useForm<TrainingConfig>({
    defaultValues: {
      ...DEFAULT_TRAINING_VALUES,
      datasetId: initialDatasetId
    }
  });
  const selectedModel = form.watch("model");
  const learningRate = form.watch("learningRate");
  const steps = form.watch("steps");
  const batchSize = form.watch("batchSize");
  const pi05Preset = form.watch("pi05Preset") ?? "memory";
  const pi05TrainingScope = form.watch("pi05TrainingScope") ?? "expert";
  const pi05PresetConfig = PI05_PRESETS[pi05Preset];
  const isPi05Selected = isPi05TrainingModel(selectedModel);
  const pi05EffectiveBatchSize = pi05TrainingScope === "full" ? 1 : pi05PresetConfig.batchSize;
  const pi05GradientCheckpointing = pi05TrainingScope === "full" || pi05PresetConfig.gradientCheckpointing;
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const paramsTemplate = useMemo(
    () =>
      formatParams(
        buildTrainingParams({
          ...DEFAULT_TRAINING_VALUES,
          model: selectedModel,
          datasetId: initialDatasetId,
          learningRate,
          steps,
          batchSize,
          pi05Preset,
          pi05TrainingScope
        })
      ),
    [batchSize, initialDatasetId, learningRate, pi05Preset, pi05TrainingScope, selectedModel, steps]
  );
  const [paramsText, setParamsText] = useState(paramsTemplate);
  const [paramsDirty, setParamsDirty] = useState(false);
  const [paramsError, setParamsError] = useState<string | null>(null);
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
        pi05ModeTitle: "Pi0.5 轻量微调",
        pi05ModeDescription: "默认基于 lerobot/pi05_base，只训练 Action Expert，避免误触发 4B 参数全量训练。",
        pi05PresetLabel: "H20 预设",
        pi05PresetOptions: {
          memory: "省显存",
          balanced: "H20 均衡",
          throughput: "H20 吞吐"
        },
        pi05ScopeLabel: "训练范围",
        pi05ScopeExpert: "只训练 Action Expert",
        pi05ScopeFull: "全量微调",
        pi05FullWarning: "全量微调会放开约 4B 参数，H20 96GB 也可能 OOM。请只在明确需要时使用。",
        pi05BaseLabel: "Base",
        pi05DtypeLabel: "DType",
        pi05CheckpointingLabel: "Checkpoint",
        detailsTitle: "Details",
        paramsLabel: "参数 JSON",
        resetParams: "重置模板",
        paramsJsonInvalid: "参数 JSON 必须是对象",
        paramsJsonError: (message: string) => `参数 JSON 错误：${message}`,
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
        pi05ModeTitle: "Pi0.5 lightweight fine-tuning",
        pi05ModeDescription: "Defaults to lerobot/pi05_base and trains only the Action Expert to avoid accidental 4B full training.",
        pi05PresetLabel: "H20 Preset",
        pi05PresetOptions: {
          memory: "Memory saver",
          balanced: "H20 balanced",
          throughput: "H20 throughput"
        },
        pi05ScopeLabel: "Training Scope",
        pi05ScopeExpert: "Action Expert only",
        pi05ScopeFull: "Full fine-tune",
        pi05FullWarning: "Full fine-tuning opens about 4B parameters and can OOM on H20 96GB. Use only when intentional.",
        pi05BaseLabel: "Base",
        pi05DtypeLabel: "DType",
        pi05CheckpointingLabel: "Checkpoint",
        detailsTitle: "Details",
        paramsLabel: "Params JSON",
        resetParams: "Reset template",
        paramsJsonInvalid: "Params JSON must be an object",
        paramsJsonError: (message: string) => `Params JSON error: ${message}`,
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
  const [isLogLoading, setIsLogLoading] = useState<boolean>(false);
  const [logRefreshSignal, setLogRefreshSignal] = useState(0);
  const logOffsetRef = useRef(0);
  const logCompleteRef = useRef(false);
  const logFetchInFlightRef = useRef(false);
  const logViewportRef = useRef<HTMLDivElement | null>(null);
  const [completedTaskIds, setCompletedTaskIds] = useState<Set<number>>(new Set());
  const [createError, setCreateError] = useState<string | null>(null);
  const [paramsTemplateModel, setParamsTemplateModel] = useState(selectedModel);

  useEffect(() => {
    if (selectedModel !== paramsTemplateModel) {
      setParamsTemplateModel(selectedModel);
      setParamsDirty(false);
      setParamsText(paramsTemplate);
      setParamsError(null);
      return;
    }
    if (!paramsDirty) {
      setParamsText(paramsTemplate);
      setParamsError(null);
    }
  }, [paramsDirty, paramsTemplate, paramsTemplateModel, selectedModel]);

  useEffect(() => {
    if (!isPi05Selected) return;
    form.setValue("learningRate", PI05_DEFAULT_LEARNING_RATE, { shouldDirty: true });
    form.setValue("batchSize", pi05EffectiveBatchSize, { shouldDirty: true });
  }, [form, isPi05Selected, pi05EffectiveBatchSize]);

  const mutation = useMutation({
    mutationFn: robotCloudApi.createTrainingJob,
    onSuccess: () => {
      setCreateError(null);
      setParamsError(null);
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
    setIsLogLoading(false);
    logOffsetRef.current = 0;
    logCompleteRef.current = false;
    logFetchInFlightRef.current = false;
  };

  const openLog = (taskId: number) => {
    setLogTaskId(taskId);
    setLogBuffer("");
    setLogOffset(0);
    setLogComplete(false);
    setLogError(null);
    setIsLogLoading(false);
    logOffsetRef.current = 0;
    logCompleteRef.current = false;
    logFetchInFlightRef.current = false;
    setLogRefreshSignal((value) => value + 1);
  };

  useEffect(() => {
    if (!token) return;
    const raw = searchParams.get("logTaskId");
    const parsed = raw ? Number(raw) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    openLog(parsed);
  }, [searchParams, token]);

  useLayoutEffect(() => {
    const viewport = logViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [isLogMaximized, logBuffer]);

  // Poll logs while modal open. Drain to the current EOF so completed logs
  // load fully instead of appearing stuck on the first chunk.
  useEffect(() => {
    if (!logTaskId || !token) return;
    let aborted = false;

    const fetchChunks = async () => {
      if (logFetchInFlightRef.current || logCompleteRef.current) return;
      logFetchInFlightRef.current = true;
      setIsLogLoading(true);
      try {
        while (!aborted) {
          const offset = logOffsetRef.current;
          const chunk = await robotCloudApi.fetchTrainingLog({
            taskId: logTaskId,
            offset,
            limit: LOG_CHUNK_LIMIT
          });
          if (aborted) return;

          const rawContent = chunk.content || "";
          const newContent = normalizeLogContent(rawContent);
          if (newContent) {
            setLogBuffer((prev) => collapseProgressLines(prev + newContent));
          }

          logOffsetRef.current = chunk.nextOffset;
          logCompleteRef.current = chunk.complete;
          setLogOffset(chunk.nextOffset);
          setLogComplete(chunk.complete);
          setLogError(null);

          if (newContent.includes("End of training")) {
            setCompletedTaskIds((prev) => new Set(prev).add(logTaskId));
          }
          if (chunk.complete || !rawContent || chunk.nextOffset <= offset) {
            break;
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setLogError(message);
      } finally {
        if (!aborted) {
          setIsLogLoading(false);
        }
        logFetchInFlightRef.current = false;
      }
    };

    fetchChunks();
    const t = setInterval(fetchChunks, LOG_POLL_INTERVAL_MS);
    return () => {
      aborted = true;
      clearInterval(t);
    };
  }, [logRefreshSignal, logTaskId, token]);

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
    let parsedParams: Record<string, unknown>;
    try {
      parsedParams = parseParams(paramsText);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setParamsError(
        message === "Training params must be a JSON object." ? copy.paramsJsonInvalid : copy.paramsJsonError(message)
      );
      setIsDetailsOpen(true);
      return;
    }
    setParamsError(null);
    try {
      await mutation.mutateAsync({ ...values, params: parsedParams });
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
              <option value="ACT">ACT</option>
              <option value="DiffusionPolicy">DiffusionPolicy</option>
              <option value="Pi0">Pi0</option>
              <option value="Pi0.5">Pi0.5</option>
              <option value="SmolVLA">SmolVLA</option>
            </select>
          </label>
          {isPi05Selected ? (
            <div className="space-y-3 border-l-2 border-primary/60 pl-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold accent-text">{copy.pi05ModeTitle}</h3>
                <p className="text-xs text-muted">{copy.pi05ModeDescription}</p>
              </div>
              <label className="block text-sm">
                <span className="text-muted">{copy.pi05PresetLabel}</span>
                <select
                  {...form.register("pi05Preset")}
                  className="mt-1 w-full rounded-md border border-theme bg-surface/50 p-2"
                >
                  <option value="memory">{copy.pi05PresetOptions.memory}</option>
                  <option value="balanced">{copy.pi05PresetOptions.balanced}</option>
                  <option value="throughput">{copy.pi05PresetOptions.throughput}</option>
                </select>
              </label>
              <fieldset className="space-y-2 text-sm">
                <legend className="text-muted">{copy.pi05ScopeLabel}</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" value="expert" {...form.register("pi05TrainingScope")} />
                  <span>{copy.pi05ScopeExpert}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" value="full" {...form.register("pi05TrainingScope")} />
                  <span>{copy.pi05ScopeFull}</span>
                </label>
              </fieldset>
              {pi05TrainingScope === "full" ? <p className="text-xs text-red-500">{copy.pi05FullWarning}</p> : null}
              <dl className="grid grid-cols-3 gap-2 text-[11px] text-muted">
                <div>
                  <dt>{copy.pi05BaseLabel}</dt>
                  <dd className="break-all text-body">{PI05_BASE_MODEL}</dd>
                </div>
                <div>
                  <dt>{copy.pi05DtypeLabel}</dt>
                  <dd className="text-body">bfloat16</dd>
                </div>
                <div>
                  <dt>{copy.pi05CheckpointingLabel}</dt>
                  <dd className="text-body">{pi05GradientCheckpointing ? "on" : "off"}</dd>
                </div>
              </dl>
            </div>
          ) : null}
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
          <div className="rounded-md border border-theme bg-surface/40">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold accent-text"
              onClick={() => setIsDetailsOpen((value) => !value)}
            >
              <span>{copy.detailsTitle}</span>
              <span aria-hidden="true">{isDetailsOpen ? "-" : "+"}</span>
            </button>
            {isDetailsOpen ? (
              <div className="space-y-2 border-t border-theme p-3">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="training-params-json" className="text-sm text-muted">
                    {copy.paramsLabel}
                  </label>
                  <button
                    type="button"
                    className="text-xs font-semibold accent-text hover:text-primary"
                    onClick={() => {
                      setParamsDirty(false);
                      setParamsText(paramsTemplate);
                      setParamsError(null);
                    }}
                  >
                    {copy.resetParams}
                  </button>
                </div>
                <textarea
                  id="training-params-json"
                  value={paramsText}
                  spellCheck={false}
                  onChange={(event) => {
                    setParamsDirty(true);
                    setParamsText(event.target.value);
                    setParamsError(null);
                  }}
                  className="h-64 w-full resize-y rounded-md border border-theme bg-card p-3 font-mono text-xs leading-relaxed text-body outline-none focus:border-primary"
                />
                {paramsError ? <p className="text-xs text-red-500">{paramsError}</p> : null}
              </div>
            ) : null}
          </div>
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
              ref={logViewportRef}
              className={`overflow-auto rounded p-3 text-xs font-mono ${isLogMaximized ? "h-[calc(100%-5rem)]" : "h-96"} ${theme === "light" ? "bg-white text-black border border-gray-200" : "bg-black text-white"}`}
            >
              <pre className="whitespace-pre-wrap leading-relaxed">{logBuffer || (logError ? `Error: ${logError}` : "Waiting for logs...")}</pre>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-muted">
              <span>Offset: {logOffset}{logComplete ? " · Completed" : isLogLoading ? " · Loading" : ""}</span>
              {!logComplete ? (
                <button
                  onClick={() => setLogRefreshSignal((x) => x + 1)}
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
