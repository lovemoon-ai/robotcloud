"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";

export default function InferencePage() {
  const client = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const { data, isLoading, error } = useQuery({
    queryKey: ["inference-jobs"],
    queryFn: robotCloudApi.fetchInferenceJobs,
    enabled: Boolean(token)
  });
  const [datasetId, setDatasetId] = useState("");
  const [modelId, setModelId] = useState("");

  const mutation = useMutation({
    mutationFn: robotCloudApi.runInference,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["inference-jobs"] });
      setDatasetId("");
      setModelId("");
    }
  });

  const runJob = async () => {
    if (!datasetId || !modelId) return;
    await mutation.mutateAsync({ datasetId: Number.parseInt(datasetId, 10), modelId: Number.parseInt(modelId, 10) });
  };

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">云端推理</h1>
        <p className="text-sm text-slate-300">选择数据集快速执行推理任务，查看结果准确率。</p>
      </header>
      <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="text-xl font-semibold text-teal-300">启动推理</h2>
          <label className="block text-sm">
            <span className="text-slate-300">数据集 ID</span>
            <input
              value={datasetId}
              onChange={(event) => setDatasetId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              placeholder="例如：42"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">模型 ID</span>
            <input
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              placeholder="例如：1"
            />
          </label>
          <button
            onClick={runJob}
            className="w-full rounded-md bg-teal-500 py-2 font-semibold text-slate-950 transition hover:bg-teal-400"
            disabled={!datasetId || !modelId || mutation.isPending}
          >
            {mutation.isPending ? "提交中..." : "执行推理"}
          </button>
        </div>
        <div className="space-y-3">
          <h2 className="text-xl font-semibold text-teal-300">推理任务记录</h2>
          {!token ? <p className="text-sm text-slate-400">登录后可查看推理记录。</p> : null}
          {token && isLoading ? <p>加载中...</p> : null}
          {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
          {token ? (
            <div className="grid gap-3">
              {data?.map((job) => (
                <Card key={job.id} title={`模型 ${job.modelId}`} description={`数据集：${job.datasetId}`}>
                  <p className="text-xs text-slate-300">状态：{job.status}</p>
                  <p className="text-[11px] text-slate-500">{job.resultPath ? `结果：${job.resultPath}` : "等待云端完成"}</p>
                </Card>
              ))}
              {!data?.length ? <p className="text-sm text-slate-400">暂无推理记录。</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
