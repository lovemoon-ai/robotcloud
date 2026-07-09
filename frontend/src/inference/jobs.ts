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

export function normalizeInferenceServerAddress(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).host;
    } catch {
      return trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/[/?#].*$/, "");
    }
  }

  return trimmed.replace(/[/?#].*$/, "");
}

function normalizeInferenceServerHost(value: string) {
  const address = normalizeInferenceServerAddress(value);
  const ipv6Match = /^\[([^\]]+)\](?::\d+)?$/.exec(address);
  if (ipv6Match) return `[${ipv6Match[1]}]`;
  return address.replace(/:\d+$/, "");
}

export function inferenceJobServerAddress(job: InferenceJob) {
  if (!job.serverHost || !job.serverPort) return null;
  const host = normalizeInferenceServerHost(job.serverHost);
  if (!host) return null;
  return normalizeInferenceServerAddress(`${host}:${job.serverPort}`);
}
