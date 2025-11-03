"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useForm } from "react-hook-form";
import { useAuthStore } from "@/store/useAuthStore";

interface DatasetForm {
  name: string;
  description: string;
  visibility: "public" | "private";
  file: FileList;
}

export default function DatasetsPage() {
  const client = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["datasets"],
    queryFn: robotCloudApi.listDatasets,
    enabled: Boolean(token)
  });
  const form = useForm<DatasetForm>({
    defaultValues: { name: "", description: "", visibility: "private" } as Partial<DatasetForm>
  });

  const mutation = useMutation({
    mutationFn: robotCloudApi.uploadDataset,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["datasets"] });
      setSuccess("数据集上传成功，正在异步处理文件。");
      setFormError(null);
      form.reset({ name: "", description: "", visibility: "private" } as Partial<DatasetForm>);
    },
    onError: (uploadError: unknown) => {
      setSuccess(null);
      setFormError(uploadError instanceof Error ? uploadError.message : "上传失败，请稍后重试。");
    }
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!token) {
      setFormError("请先登录后再上传数据集。");
      return;
    }
    const file = values.file?.[0];
    if (!file) {
      setFormError("请选择要上传的压缩文件。");
      return;
    }
    setFormError(null);
    setSuccess(null);
    await mutation.mutateAsync({
      file,
      name: values.name,
      description: values.description,
      visibility: values.visibility
    });
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
            <span className="text-slate-300">数据集描述</span>
            <textarea
              {...form.register("description")}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              rows={3}
              placeholder="例如：停车场障碍物识别数据集"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">数据文件</span>
            <input
              type="file"
              accept=".zip,.tar,.gz,.tgz,.rar"
              {...form.register("file", { required: "请上传数据文件" })}
              className="mt-1 w-full rounded-md border border-dashed border-slate-700 bg-slate-950/50 p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-teal-500 file:px-3 file:py-1 file:font-semibold file:text-slate-950 hover:file:bg-teal-400"
            />
            {form.formState.errors.file ? (
              <span className="text-xs text-red-400">{form.formState.errors.file.message as string}</span>
            ) : null}
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
          {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
          {success ? <p className="text-sm text-teal-300">{success}</p> : null}
        </form>
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-teal-300">数据集列表</h2>
          {!token ? <p className="text-sm text-slate-400">登录后可查看个人数据集列表。</p> : null}
          {token && isLoading ? <p>加载中...</p> : null}
          {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
          {token ? (
            <div className="space-y-3">
              {data?.map((dataset) => (
                <Card key={dataset.id} title={dataset.name} description={dataset.description || "暂无描述"}>
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>状态：{dataset.status}</span>
                    <span>权限：{dataset.visibility}</span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    创建时间：{new Date(dataset.createdAt).toLocaleString()}
                  </p>
                </Card>
              ))}
              {!data?.length ? <p className="text-sm text-slate-400">暂无数据集，上传后可在此管理。</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
