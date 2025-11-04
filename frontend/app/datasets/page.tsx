"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useForm } from "react-hook-form";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocaleStore } from "@/store/useLocaleStore";

interface DatasetForm {
  name: string;
  description: string;
  visibility: "public" | "private";
  file: FileList;
}

export default function DatasetsPage() {
  const locale = useLocaleStore((state) => state.locale);
  const client = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
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
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "数据集管理",
        subtitle: "上传与浏览多模态数据，支持图像、点云、视频等格式。",
        upload: {
          heading: "上传数据集",
          nameLabel: "数据集名称",
          nameRequired: "请填写名称",
          descriptionLabel: "数据集描述",
          descriptionPlaceholder: "例如：停车场障碍物识别数据集",
          fileLabel: "数据文件",
          fileRequired: "请上传数据文件",
          visibilityLabel: "可见性",
          visibility: {
            private: "私有",
            public: "公开"
          },
          loginNotice: "请先登录后再上传数据集，正在跳转至登录页...",
          notLoggedPrefix: "当前未登录，上传前请",
          loginLink: "前往登录",
          notLoggedSuffix: "并获取必要权限。",
          uploadButton: "开始上传",
          uploading: "上传中...",
          success: "数据集上传成功",
          missingFile: "请选择要上传的压缩文件。",
          fallbackError: "上传失败，请稍后重试。"
        },
        list: {
          heading: "数据集列表",
          loginPrompt: "登录后可查看个人数据集列表。",
          loginLink: "前往登录",
          loading: "加载中...",
          empty: "暂无数据集，上传后可在此管理。",
          noDescription: "暂无描述",
          status: (value: string) => `状态：${value}`,
          visibility: (value: string) => `权限：${value}`,
          createdAt: (value: string) => `创建时间：${value}`,
          meta: {
            id: (value: number) => `数据集 ID：${value}`,
            files: (count: number) => `文件数：${count}`,
            size: (size: string) => `总大小：${size}`,
            preview: "预览可用"
          }
        }
      }
    : {
        title: "Dataset Management",
        subtitle: "Upload and browse multimodal data including images, point clouds, and video.",
        upload: {
          heading: "Upload Dataset",
          nameLabel: "Dataset Name",
          nameRequired: "Please provide a name",
          descriptionLabel: "Dataset Description",
          descriptionPlaceholder: "e.g. Parking lot obstacle detection dataset",
          fileLabel: "Data File",
          fileRequired: "Please upload a dataset archive",
          visibilityLabel: "Visibility",
          visibility: {
            private: "Private",
            public: "Public"
          },
          loginNotice: "Please log in before uploading datasets. Redirecting to the login page...",
          notLoggedPrefix: "You are not logged in. Please",
          loginLink: "go to login",
          notLoggedSuffix: "before uploading.",
          uploadButton: "Start Upload",
          uploading: "Uploading...",
          success: "Dataset uploaded successfully",
          missingFile: "Select an archive file to upload.",
          fallbackError: "Upload failed, please try again later."
        },
        list: {
          heading: "Dataset List",
          loginPrompt: "Log in to view your datasets.",
          loginLink: "Go to login",
          loading: "Loading...",
          empty: "No datasets yet. Upload to manage them here.",
          noDescription: "No description",
          status: (value: string) => `Status: ${value}`,
          visibility: (value: string) => `Visibility: ${value}`,
          createdAt: (value: string) => `Created at: ${value}`,
          meta: {
            id: (value: number) => `Dataset ID: ${value}`,
            files: (count: number) => `Files: ${count}`,
            size: (size: string) => `Size: ${size}`,
            preview: "Preview available"
          }
        }
      };
  const formatBytes = (size?: number | null): string | null => {
    if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return null;
    if (size === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB", "PB"];
    const exponent = Math.min(units.length - 1, Math.floor(Math.log10(size) / 3));
    const value = size / Math.pow(1000, exponent);
    return `${value.toFixed(value < 10 && exponent > 0 ? 1 : 0)} ${units[exponent]}`;
  };

  const mutation = useMutation({
    mutationFn: robotCloudApi.uploadDataset,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["datasets"] });
      setSuccess(copy.upload.success);
      setFormError(null);
      form.reset({ name: "", description: "", visibility: "private" } as Partial<DatasetForm>);
    },
    onError: (uploadError: unknown) => {
      setSuccess(null);
      setFormError(uploadError instanceof Error ? uploadError.message : copy.upload.fallbackError);
    }
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!token) {
      setFormError(copy.upload.loginNotice);
      router.push("/login");
      return;
    }
    const file = values.file?.[0];
    if (!file) {
      setFormError(copy.upload.missingFile);
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
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-slate-300">{copy.subtitle}</p>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <h2 className="text-xl font-semibold text-teal-300">{copy.upload.heading}</h2>
          <label className="block text-sm">
            <span className="text-slate-300">{copy.upload.nameLabel}</span>
            <input
              {...form.register("name", { required: copy.upload.nameRequired })}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">{copy.upload.descriptionLabel}</span>
            <textarea
              {...form.register("description")}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              rows={3}
              placeholder={copy.upload.descriptionPlaceholder}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">{copy.upload.fileLabel}</span>
            <input
              type="file"
              accept=".zip,.tar,.gz,.tgz,.rar"
              {...form.register("file", { required: copy.upload.fileRequired })}
              className="mt-1 w-full rounded-md border border-dashed border-slate-700 bg-slate-950/50 p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-teal-500 file:px-3 file:py-1 file:font-semibold file:text-slate-950 hover:file:bg-teal-400"
            />
            {form.formState.errors.file ? (
              <span className="text-xs text-red-400">{form.formState.errors.file.message as string}</span>
            ) : null}
          </label>
          <label className="block text-sm">
            <span className="text-slate-300">{copy.upload.visibilityLabel}</span>
            <select
              {...form.register("visibility")}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            >
              <option value="private">{copy.upload.visibility.private}</option>
              <option value="public">{copy.upload.visibility.public}</option>
            </select>
          </label>
          {!token ? (
            <p className="rounded-md border border-teal-500/30 bg-teal-500/10 p-3 text-sm text-teal-200">
              {copy.upload.notLoggedPrefix}
              <Link href="/login" className="mx-1 text-teal-100 underline underline-offset-4">
                {copy.upload.loginLink}
              </Link>
              {copy.upload.notLoggedSuffix}
            </p>
          ) : null}
          <button
            type="submit"
            className="w-full rounded-md bg-teal-500 py-2 font-semibold text-slate-950 transition hover:bg-teal-400"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? copy.upload.uploading : copy.upload.uploadButton}
          </button>
          {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
          {success ? <p className="text-sm text-teal-300">{success}</p> : null}
        </form>
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-teal-300">{copy.list.heading}</h2>
          {!token ? (
            <p className="text-sm text-slate-400">
              {copy.list.loginPrompt}
              <Link href="/login" className="ml-1 text-teal-300 hover:text-teal-200">
                {copy.list.loginLink}
              </Link>
            </p>
          ) : null}
          {token && isLoading ? <p>{copy.list.loading}</p> : null}
          {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
          {token ? (
            <div className="space-y-3">
              {data?.map((dataset) => (
                <Card key={dataset.id} title={dataset.name} description={dataset.description || copy.list.noDescription}>
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>{copy.list.status(dataset.status)}</span>
                    <span>{copy.list.visibility(dataset.visibility)}</span>
                  </div>
                  {(() => {
                    const segments: string[] = [copy.list.meta.id(dataset.id)];
                    if (typeof dataset.totalFiles === "number") {
                      segments.push(copy.list.meta.files(dataset.totalFiles));
                    }
                    const formattedSize = formatBytes(dataset.fileSize);
                    if (formattedSize) {
                      segments.push(copy.list.meta.size(formattedSize));
                    }
                    if (dataset.previewAvailable) {
                      segments.push(copy.list.meta.preview);
                    }
                    return segments.length ? (
                      <p className="mt-2 text-[11px] text-slate-400">{segments.join(" • ")}</p>
                    ) : null;
                  })()}
                  <p className="mt-2 text-[11px] text-slate-500">
                    {copy.list.createdAt(new Date(dataset.createdAt).toLocaleString())}
                  </p>
                </Card>
              ))}
              {!data?.length ? <p className="text-sm text-slate-400">{copy.list.empty}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
