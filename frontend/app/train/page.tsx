"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useForm } from "react-hook-form";
import { TrainingConfig } from "@/types";
import { useAuthStore } from "@/store/useAuthStore";

export default function TrainPage() {
  const client = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const { data, isLoading, error } = useQuery({
    queryKey: ["training-jobs"],
    queryFn: robotCloudApi.fetchTrainingJobs,
    enabled: Boolean(token)
  });
  const form = useForm<TrainingConfig>({
    defaultValues: { model: "YOLO", datasetId: "", learningRate: 0.001, epochs: 50, batchSize: 16 }
  });

  const mutation = useMutation({
    mutationFn: robotCloudApi.createTrainingJob,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["training-jobs"] });
    }
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await mutation.mutateAsync(values);
  });

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">模型训练</h1>
        <p className="text-sm text-slate-300">配置训练参数，实时查看任务状态与进度。</p>
      </header>
      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="text-xl font-semibold text-teal-300">创建训练任务</h2>
          <label className="block text-sm">
            <span className="text-slate-300">模型模板</span>
            <select {...form.register("model")} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2">
              <option value="YOLO">YOLO</option>
              <option value="OccupancyNet">OccupancyNet</option>
              <option value="PointTransformer">PointTransformer</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">数据集 ID</span>
            <input
              {...form.register("datasetId", { required: "请输入数据集 ID" })}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-slate-300">学习率</span>
              <input
                type="number"
                step="0.0001"
                {...form.register("learningRate", { valueAsNumber: true })}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-300">Batch Size</span>
              <input
                type="number"
                {...form.register("batchSize", { valueAsNumber: true })}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="text-slate-300">Epochs</span>
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
            {mutation.isPending ? "创建中..." : "提交训练"}
          </button>
        </form>
        <div className="space-y-3">
          <h2 className="text-xl font-semibold text-teal-300">训练任务队列</h2>
          {!token ? <p className="text-sm text-slate-400">登录后可查看我的训练任务。</p> : null}
          {token && isLoading ? <p>加载中...</p> : null}
          {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
          {token ? (
            <div className="grid gap-3">
              {data?.map((job) => (
                <Card
                  key={job.id}
                  title={`${job.model} · ${job.status}`}
                  description={`数据集 ID：${job.datasetId}，进度：${job.progress}%`}
                >
                  <div className="h-2 rounded-full bg-slate-800">
                    <div className="h-full rounded-full bg-teal-400" style={{ width: `${job.progress}%` }} />
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">日志：{job.logsUrl}</p>
                </Card>
              ))}
              {!data?.length ? <p className="text-sm text-slate-400">暂无训练任务。</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
