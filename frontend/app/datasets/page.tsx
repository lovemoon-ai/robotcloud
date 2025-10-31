"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useForm } from "react-hook-form";

interface DatasetForm {
  name: string;
  modality: string;
  visibility: "public" | "private";
}

export default function DatasetsPage() {
  const client = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["datasets"], queryFn: robotCloudApi.listDatasets });
  const form = useForm<DatasetForm>({
    defaultValues: { name: "", modality: "image", visibility: "private" }
  });

  const mutation = useMutation({
    mutationFn: robotCloudApi.uploadDataset,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["datasets"] });
      form.reset({ name: "", modality: "image", visibility: "private" });
    }
  });

  const onSubmit = form.handleSubmit(async (values) => {
    await mutation.mutateAsync(values);
  });

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">数据集管理</h1>
        <p className="text-sm text-slate-300">上传与浏览多模态数据，支持图像、点云、视频等格式。</p>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="text-xl font-semibold text-teal-300">上传数据集</h2>
          <label className="block text-sm">
            <span className="text-slate-300">数据集名称</span>
            <input
              {...form.register("name", { required: "请填写名称" })}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">数据模态</span>
            <select
              {...form.register("modality")}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            >
              <option value="image">图像</option>
              <option value="lidar">LiDAR 点云</option>
              <option value="video">视频</option>
              <option value="text">文本</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">可见性</span>
            <select
              {...form.register("visibility")}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            >
              <option value="private">私有</option>
              <option value="public">公开</option>
            </select>
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-teal-500 py-2 font-semibold text-slate-950 transition hover:bg-teal-400"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "上传中..." : "开始上传"}
          </button>
        </form>
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-teal-300">数据集列表</h2>
          {isLoading ? <p>加载中...</p> : null}
          {error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
          <div className="space-y-3">
            {data?.map((dataset) => (
              <Card key={dataset.id} title={dataset.name} description={`样本数：${dataset.samples}`}>
                <div className="flex justify-between text-xs text-slate-300">
                  <span>模态：{dataset.modality}</span>
                  <span>权限：{dataset.visibility}</span>
                </div>
              </Card>
            ))}
            {!data?.length ? <p className="text-sm text-slate-400">暂无数据集，上传后可在此管理。</p> : null}
          </div>
        </div>
      </section>
    </main>
  );
}
