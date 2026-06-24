"use client";

import { useEffect, useState } from "react";
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
  targetNode: string;
  file: FileList;
}

export default function DatasetsPage() {
  const locale = useLocaleStore((state) => state.locale);
  const client = useQueryClient();
  const token = useAuthStore((state) => state.token);
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const { data, isLoading, error } = useQuery({
    queryKey: ["datasets"],
    queryFn: robotCloudApi.listDatasets,
    enabled: Boolean(token)
  });
  const agentsQuery = useQuery({
    queryKey: ["agents", "active"],
    queryFn: robotCloudApi.listActiveAgents,
    enabled: Boolean(token)
  });
  const form = useForm<DatasetForm>({
    defaultValues: { name: "", description: "", visibility: "private", targetNode: "" } as Partial<DatasetForm>
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
          agentLabel: "上传到 GPU Agent",
          agentLoading: "正在加载 Agent...",
          noAgent: "当前没有可接收上传的 GPU Agent，请先启动 Agent 并配置公网/隧道地址。",
          agentStatus: (free: number, total: number) => `空闲 GPU：${free}/${total}`,
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
            preview: "预览可用",
            node: (value: string) => `节点：${value}`
          },
          trainButton: "训练",
          deleteButton: "删除",
          deleteConfirm: "确定要删除这个数据集吗？此操作不可撤销。",
          deleteSuccess: "数据集已删除",
          deleteError: "删除失败，请稍后重试。"
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
          agentLabel: "Upload to GPU Agent",
          agentLoading: "Loading agents...",
          noAgent: "No upload-capable GPU Agent is active. Start an Agent with a public or tunnel URL first.",
          agentStatus: (free: number, total: number) => `Free GPUs: ${free}/${total}`,
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
            preview: "Preview available",
            node: (value: string) => `Node: ${value}`
          },
          trainButton: "Train",
          deleteButton: "Delete",
          deleteConfirm: "Are you sure you want to delete this dataset? This action cannot be undone.",
          deleteSuccess: "Dataset deleted",
          deleteError: "Delete failed, please try again later."
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
  const uploadAgents = agentsQuery.data?.items.filter((agent) => agent.canUpload) ?? [];
  const selectedTargetNode = form.watch("targetNode");

  useEffect(() => {
    if (!token) {
      return;
    }
    const availableAgents = agentsQuery.data?.items.filter((agent) => agent.canUpload) ?? [];
    if (!availableAgents.length) {
      return;
    }
    const current = form.getValues("targetNode");
    if (current && availableAgents.some((agent) => agent.nodeName === current)) {
      return;
    }
    const preferred =
      availableAgents.find((agent) => agent.nodeName === agentsQuery.data?.defaultAgentNode) ??
      availableAgents.find((agent) => agent.isDefault) ??
      availableAgents[0];
    form.setValue("targetNode", preferred.nodeName, { shouldDirty: false });
  }, [agentsQuery.data, form, token]);

  const mutation = useMutation({
    mutationFn: robotCloudApi.uploadDataset,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["datasets"] });
      setSuccess(copy.upload.success);
      setFormError(null);
      setUploadProgress(0);
      form.reset({
        name: "",
        description: "",
        visibility: "private",
        targetNode: selectedTargetNode
      } as Partial<DatasetForm>);
    },
    onError: (uploadError: unknown) => {
      setSuccess(null);
      setUploadProgress(0);
      setFormError(uploadError instanceof Error ? uploadError.message : copy.upload.fallbackError);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: robotCloudApi.deleteDataset,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["datasets"] });
    }
  });

  const handleDelete = async (datasetId: number) => {
    if (!window.confirm(copy.list.deleteConfirm)) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(datasetId);
    } catch {
      // Error is handled by mutation state
    }
  };

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
    if (!values.targetNode) {
      setFormError(copy.upload.noAgent);
      return;
    }
    setFormError(null);
    setSuccess(null);
    setUploadProgress(0);
    await mutation.mutateAsync({
      file,
      name: values.name,
      description: values.description,
      visibility: values.visibility,
      targetNode: values.targetNode,
      onProgress: (percent) => setUploadProgress(percent)
    });
  });

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.subtitle}</p>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-theme bg-card p-5">
          <h2 className="text-xl font-semibold accent-text">{copy.upload.heading}</h2>
          <label className="block text-sm">
            <span className="text-muted">{copy.upload.nameLabel}</span>
            <input
              {...form.register("name", { required: copy.upload.nameRequired })}
              className="mt-1 w-full rounded-md border border-theme bg-surface p-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">{copy.upload.descriptionLabel}</span>
            <textarea
              {...form.register("description")}
              className="mt-1 w-full rounded-md border border-theme bg-surface p-2"
              rows={3}
              placeholder={copy.upload.descriptionPlaceholder}
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">{copy.upload.fileLabel}</span>
            <input
              type="file"
              accept=".zip,.tar,.gz,.tgz,.rar"
              {...form.register("file", { required: copy.upload.fileRequired })}
              className="mt-1 w-full rounded-md border border-dashed border-theme bg-surface p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:gradient-primary file:px-3 file:py-1 file:font-semibold file:text-white hover:file:bg-primary"
            />
            {form.formState.errors.file ? (
              <span className="text-xs text-red-400">{form.formState.errors.file.message as string}</span>
            ) : null}
          </label>
          <label className="block text-sm">
            <span className="text-muted">{copy.upload.visibilityLabel}</span>
            <select
              {...form.register("visibility")}
              className="mt-1 w-full rounded-md border border-theme bg-surface p-2"
            >
              <option value="private">{copy.upload.visibility.private}</option>
              <option value="public">{copy.upload.visibility.public}</option>
            </select>
          </label>
          {token ? (
            <label className="block text-sm">
              <span className="text-muted">{copy.upload.agentLabel}</span>
              <select
                {...form.register("targetNode")}
                className="mt-1 w-full rounded-md border border-theme bg-surface p-2"
                disabled={agentsQuery.isLoading || !uploadAgents.length}
              >
                {uploadAgents.map((agent) => (
                  <option key={agent.nodeName} value={agent.nodeName}>
                    {agent.nodeName} · {copy.upload.agentStatus(agent.gpuFree, agent.gpuTotal)}
                  </option>
                ))}
              </select>
              {agentsQuery.isLoading ? <span className="text-xs text-muted">{copy.upload.agentLoading}</span> : null}
              {!agentsQuery.isLoading && !uploadAgents.length ? (
                <span className="text-xs text-red-400">{copy.upload.noAgent}</span>
              ) : null}
            </label>
          ) : null}
          {!token ? (
            <p className="rounded-md border border-primary/30 accent-bg p-3 text-sm text-primary-light">
              {copy.upload.notLoggedPrefix}
              <Link href="/login" className="mx-1 text-primary-lighter link">
                {copy.upload.loginLink}
              </Link>
              {copy.upload.notLoggedSuffix}
            </p>
          ) : null}
          <button
            type="submit"
            className="w-full rounded-md gradient-primary py-2 font-semibold text-white transition hover:bg-primary"
            disabled={mutation.isPending || (Boolean(token) && !uploadAgents.length)}
          >
            {mutation.isPending ? `${copy.upload.uploading} ${uploadProgress}%` : copy.upload.uploadButton}
          </button>
          {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
          {success ? <p className="text-sm accent-text">{success}</p> : null}
        </form>
        <div className="space-y-4">
          <h2 className="text-xl font-semibold accent-text">{copy.list.heading}</h2>
          {!token ? (
            <p className="text-sm text-muted">
              {copy.list.loginPrompt}
              <Link href="/login" className="ml-1 accent-text hover:text-primary-light">
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
                  <div className="flex items-center justify-between text-xs text-muted">
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
                    if (dataset.storageNode) {
                      segments.push(copy.list.meta.node(dataset.storageNode));
                    }
                    return segments.length ? (
                      <p className="mt-2 text-[11px] text-muted">{segments.join(" • ")}</p>
                    ) : null;
                  })()}
                  <div className="mt-2 flex items-center justify-between">
                    <p className="text-[11px] text-muted">
                      {copy.list.createdAt(new Date(dataset.createdAt).toLocaleString())}
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => router.push(`/train?datasetId=${dataset.id}`)}
                        className="rounded-md gradient-primary px-3 py-1 text-xs font-semibold text-white hover:opacity-90 transition"
                      >
                        {copy.list.trainButton}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(dataset.id)}
                        disabled={deleteMutation.isPending}
                        className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 transition disabled:opacity-50"
                      >
                        {copy.list.deleteButton}
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
              {!data?.length ? <p className="text-sm text-muted">{copy.list.empty}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
