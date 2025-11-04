"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
    defaultValues: { model: "YOLO", datasetId: "", learningRate: 0.001, epochs: 50, batchSize: 16 }
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
        epochsLabel: "Epochs",
        submit: "提交训练",
        submitting: "创建中...",
        queueHeading: "训练任务队列",
        totalLabel: (count: number) => `共 ${count} 个任务`,
        stats: (datasetId: string, progress: number) => `数据集 ID：${datasetId} · 进度：${progress}%`,
        logsLabel: (hasLog: boolean) => (hasLog ? "查看日志" : "日志生成中"),
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
        epochsLabel: "Epochs",
        submit: "Submit Training",
        submitting: "Creating...",
        queueHeading: "Training Queue",
        totalLabel: (count: number) => `Total ${count} task${count === 1 ? "" : "s"}`,
        stats: (datasetId: string, progress: number) => `Dataset: ${datasetId} · Progress: ${progress}%`,
        logsLabel: (hasLog: boolean) => (hasLog ? "View logs" : "Logs pending"),
        loginNotice: "Log in before creating training jobs. Redirecting to the login page...",
        loginPrompt: "Log in to view your training jobs.",
        loginLink: "Go to login",
        loading: "Loading...",
        empty: "No training jobs yet."
      };
  const taskCount = data?.length ?? 0;

  const mutation = useMutation({
    mutationFn: robotCloudApi.createTrainingJob,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["training-jobs"] });
    }
  });

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
              <option value="YOLO">YOLO</option>
              <option value="OccupancyNet">OccupancyNet</option>
              <option value="PointTransformer">PointTransformer</option>
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
              {...form.register("epochs", { valueAsNumber: true })}
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
                    {job.logsUrl ? (
                      <a
                        href={job.logsUrl}
                        className="font-semibold text-teal-300 hover:text-teal-200"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {copy.logsLabel(true)}
                      </a>
                    ) : (
                      <span>{copy.logsLabel(false)}</span>
                    )}
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
    </main>
  );
}
