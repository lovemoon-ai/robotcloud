import type { InferenceJob } from "@/types";

export const ACTIVE_INFERENCE_STATUSES = ["queued", "running"] as const;

export function isActiveInferenceJob(job: InferenceJob) {
  return ACTIVE_INFERENCE_STATUSES.includes(job.status as (typeof ACTIVE_INFERENCE_STATUSES)[number]);
}

export function hasActiveInferenceJob(jobs: InferenceJob[] | undefined | null) {
  return Boolean(jobs?.some(isActiveInferenceJob));
}

export function selectCurrentActiveInferenceJob(jobs: InferenceJob[] | undefined | null) {
  return jobs?.find(isActiveInferenceJob) ?? null;
}

export function selectCurrentRunningInferenceJob(jobs: InferenceJob[] | undefined | null) {
  return jobs?.find((job) => job.status === "running") ?? null;
}

export function inferenceJobServerAddress(job: InferenceJob) {
  if (!job.serverHost || !job.serverPort) return null;
  return `${job.serverHost}:${job.serverPort}`;
}
