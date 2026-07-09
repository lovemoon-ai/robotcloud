import getConfig from "next/config";
import { useAuthStore } from "@/store/useAuthStore";
import {
  AdminUser,
  AuthCredentials,
  AuthSession,
  BuildVersionInfo,
  DashboardSummary,
  DatasetSummary,
  DatasetUploadInput,
  DatasetUploadResult,
  GpuAgent,
  InferenceJob,
  Model,
  OtpPayload,
  Payment,
  SimulatorSession,
  TrainingConfig,
  TrainingJob,
  UserSettings,
  UserRole
} from "@/types";

const DEFAULT_API_BASE = "http://localhost:6150/api/v1";

type RuntimeConfig = {
  publicRuntimeConfig?: {
    apiBaseUrl?: string;
  };
};

const runtimeConfig: RuntimeConfig | undefined = (() => {
  try {
    return getConfig();
  } catch {
    return undefined;
  }
})();

const RAW_API_BASE = runtimeConfig?.publicRuntimeConfig?.apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE;
const API_BASE = RAW_API_BASE.replace(/\/$/, "");
const DEVICE_ID_STORAGE_KEY = "robotcloud-device-id";
export const PI05_BASE_MODEL = "lerobot/pi05_base";
export const PI05_DEFAULT_LEARNING_RATE = 0.000025;
export const PI05_DEFAULT_RENAME_MAP = {
  "observation.images.front": "observation.images.base_0_rgb",
  "observation.images.side": "observation.images.left_wrist_0_rgb"
} as const;

type LoginDeviceType = "mobile" | "desktop";
type LoginOptions = {
  replaceExistingDevice?: boolean;
};

export function isPi05TrainingModel(model: string) {
  return ["pi0.5", "pi05", "pi0_5", "pi0-5"].includes(model.trim().toLowerCase());
}

export function buildTrainingParams(config: TrainingConfig): Record<string, unknown> {
  const isPi05 = isPi05TrainingModel(config.model);
  const pi05Preset = config.pi05Preset ?? "memory";
  const pi05TrainingScope = config.pi05TrainingScope ?? "expert";
  const pi05BatchByPreset = {
    memory: 1,
    balanced: 8,
    throughput: 16
  } satisfies Record<NonNullable<TrainingConfig["pi05Preset"]>, number>;
  const params: Record<string, unknown> = {
    learning_rate: isPi05 ? config.learningRate || PI05_DEFAULT_LEARNING_RATE : config.learningRate,
    steps: config.steps,
    batch_size: isPi05
      ? pi05TrainingScope === "full"
        ? 1
        : config.batchSize || pi05BatchByPreset[pi05Preset]
      : config.batchSize
  };
  if (isPi05) {
    params["policy.path"] = PI05_BASE_MODEL;
    params["policy.dtype"] = "bfloat16";
    params["policy.train_expert_only"] = pi05TrainingScope !== "full";
    params["policy.gradient_checkpointing"] = pi05Preset !== "throughput" || pi05TrainingScope === "full";
    params.rename_map = { ...PI05_DEFAULT_RENAME_MAP };
  }
  return params;
}

function createDeviceId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getDeviceId(): string {
  if (typeof window === "undefined") {
    return createDeviceId();
  }
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
    if (stored) {
      return stored;
    }
    const generated = createDeviceId();
    window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return createDeviceId();
  }
}

function getDeviceType(): LoginDeviceType {
  if (typeof navigator === "undefined") {
    return "desktop";
  }
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent)
    ? "mobile"
    : "desktop";
}

function getLoginDeviceContext(): { deviceId: string; deviceType: LoginDeviceType } {
  return {
    deviceId: getDeviceId(),
    deviceType: getDeviceType()
  };
}

interface ApiResponse<T> {
  code: number;
  message?: string;
  data: T;
}

type BackendDataset = {
  dataset_id: number;
  name: string;
  description: string;
  visibility: "public" | "private";
  status: string;
  created_at: string;
  storage_path?: string;
  storage_backend?: "local" | "agent";
  storage_node?: string;
  file_name?: string | null;
  file_size?: number | null;
  total_files?: number | null;
  preview_available?: boolean;
};

type BackendAgent = {
  node_name: string;
  ip: string;
  api_port: number;
  gpu_total: number;
  gpu_free: number;
  gpu_busy: number;
  gpu_slot_total?: number;
  gpu_slot_free?: number;
  gpu_slot_busy?: number;
  status: string;
  version: string;
  public_base_url: string;
  upload_enabled: boolean;
  can_upload: boolean;
  is_default: boolean;
  last_heartbeat: string | null;
};

type BackendUserSettings = {
  default_agent_node: string;
};

type BackendDatasetUploadSession = {
  dataset_id: number;
  status: string;
  upload_url: string;
  upload_token: string;
  expires_at: string;
  expires_in: number;
  chunk_size?: number;
  status_url?: string;
  chunk_url?: string;
  complete_url?: string;
  node_name: string;
  file_name: string;
};

type BackendDatasetUploadComplete = {
  dataset_id: number;
  status: string;
  file_name: string;
  file_size: number;
  total_files: number;
  storage_node?: string;
};

type BackendTrainingTask = {
  task_id: number;
  dataset_id: number;
  model_type: string;
  status: string;
  progress: number;
  logs_url: string;
};

type BackendInferenceTask = {
  task_id: number;
  model_id: number;
  dataset_id?: number | null;
  status: string;
  progress?: number;
  server_host?: string | null;
  server_port?: number | null;
  checkpoint_path?: string | null;
  result_path?: string | null;
  error_message?: string | null;
  started_at?: string | null;
  created_at: string;
};

type BackendSimulationTask = {
  task_id: number;
  scene_file: string;
  model_id: number;
  robot_type: string;
  training_mode: string;
  status: string;
  created_at: string;
};

type BackendAdminUser = {
  user_id: number;
  phone: string;
  role: UserRole;
  created_at: string;
};

type BackendModel = {
  model_id: number;
  name: string;
  model_type: string;
  dataset_id: number;
  dataset_name: string | null;
  model_path: string | null;
  checkpoint_path?: string | null;
  created_at: string;
  params?: Record<string, unknown>;
};

type BackendPayment = {
  payment_id: string;
  target_role: UserRole;
  amount_cents: number;
  currency: string;
  provider: string;
  status: "pending" | "succeeded" | "failed" | "canceled";
  applied_at: string | null;
  created_at: string;
  checkout_url?: string;
  pay_code?: string;
};

type BackendLoginResponse = {
  token: string;
  user_id: number;
  phone: string;
  role: UserRole;
  expire_at: string | null;
};

type BackendDashboardResponse = {
  active_jobs: number;
  datasets: number;
  tier: UserRole;
  gpu_hours: number;
};

type BackendBuildVersion = {
  version: string;
  build_commit: string;
  build_time: string;
};

type AgentUploadStatus = {
  dataset_id?: number;
  file_name?: string;
  uploaded_bytes?: number;
  complete?: boolean;
};

type AgentUploadChunkResult = {
  dataset_id?: number;
  uploaded_bytes?: number;
  total_size?: number;
  complete?: boolean;
};

type StoredAgentUploadSession = {
  session: BackendDatasetUploadSession;
  fileName: string;
  fileSize: number;
  lastModified: number;
  name: string;
  description: string;
  visibility: "public" | "private";
  targetNode: string;
};

type DatasetUploadAbortReason = "pause" | "cancel";

const DEFAULT_AGENT_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const AGENT_UPLOAD_RETRY_LIMIT = 3;
const AGENT_UPLOAD_RETRY_DELAY_MS = 500;

function isAuthError(status: number, message: string): boolean {
  const normalized = message.toLowerCase();
  if (status === 401) return true;
  if (status === 400) {
    return (
      normalized.includes("invalid token") ||
      normalized.includes("token required") ||
      normalized.includes("invalid authorization header") ||
      normalized.includes("session revoked")
    );
  }
  return false;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const headers = new Headers(init?.headers ?? {});

  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const raw = await response.text();
    let message = raw.trim();
    if (message) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.detail === "string" && parsed.detail) {
          message = parsed.detail;
        } else if (typeof parsed.message === "string" && parsed.message) {
          message = parsed.message;
        }
      } catch {
        // ignore JSON parse failure and use raw string
      }
    }
    if (!message) {
      message = `Request failed with status ${response.status}`;
    }
    // Auto-logout on invalid/expired token so UI can redirect to login
    if (isAuthError(response.status, message)) {
      try {
        useAuthStore.getState().reset();
      } catch {
        // ignore store errors in non-browser contexts
      }
    }
    throw new Error(message);
  }

  const payload = (await response.json()) as ApiResponse<T>;
  if (payload.code !== 0) {
    throw new Error(payload.message || "Request failed");
  }
  return payload.data;
}

function parseAgentJson<T>(raw: string, fallbackMessage: string): T {
  if (!raw.trim()) {
    return {} as T;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.code === "number") {
      if (parsed.code !== 0) {
        throw new Error(parsed.message || fallbackMessage);
      }
      return parsed.data as T;
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof Error && error.message !== "Unexpected end of JSON input") {
      throw error;
    }
    throw new Error("Invalid response format");
  }
}

async function agentFetchJson<T>(url: string, init: RequestInit): Promise<T> {
  throwIfAborted(init.signal ?? undefined);
  const response = await fetch(url, init);
  const raw = await response.text();
  if (!response.ok) {
    let message = raw.trim();
    try {
      const parsed = JSON.parse(raw);
      message = parsed.detail || parsed.message || message;
    } catch {
      // use raw response body
    }
    const error = new Error(message || `Request failed with status ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return parseAgentJson<T>(raw, `Request failed with status ${response.status}`);
}

function agentUploadEndpoint(session: BackendDatasetUploadSession, kind: "status" | "chunk" | "complete"): string {
  if (kind === "status" && session.status_url) return session.status_url;
  if (kind === "chunk" && session.chunk_url) return session.chunk_url;
  if (kind === "complete" && session.complete_url) return session.complete_url;
  return `${session.upload_url.replace(/\/$/, "")}/${kind}`;
}

function agentUploadHeaders(session: BackendDatasetUploadSession): Record<string, string> {
  return {
    Authorization: `Bearer ${session.upload_token}`,
    "X-Dataset-Id": String(session.dataset_id),
    "X-Filename": session.file_name
  };
}

function readStoredAgentUploadSession(key: string): BackendDatasetUploadSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAgentUploadSession;
    const expiresAt = Date.parse(parsed.session.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    if (isMixedContentAgentUploadSession(parsed.session)) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.session;
  } catch {
    return null;
  }
}

function writeStoredAgentUploadSession(key: string, value: StoredAgentUploadSession): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage can be unavailable or full; upload can still proceed.
  }
}

function removeStoredAgentUploadSession(key: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function uploadAbortReason(signal?: AbortSignal): DatasetUploadAbortReason | null {
  if (!signal) return null;
  const reason = (signal as AbortSignal & { reason?: unknown }).reason;
  return reason === "pause" || reason === "cancel" ? reason : null;
}

function createAbortError(signal?: AbortSignal): Error {
  const reason = uploadAbortReason(signal);
  const error = new Error(reason === "cancel" ? "Upload canceled" : "Upload paused");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { name?: unknown; message?: unknown };
  return (
    candidate.name === "AbortError" ||
    candidate.message === "Upload paused" ||
    candidate.message === "Upload canceled"
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
    const cleanup = () => {
      if (timeout) {
        globalThis.clearTimeout(timeout);
        timeout = null;
      }
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(createAbortError(signal));
    };
    timeout = globalThis.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function agentUploadStorageKey(form: DatasetUploadInput): string {
  const targetNode = form.targetNode || "";
  const signature = [
    form.file.name,
    form.file.size,
    form.file.lastModified,
    form.name,
    form.description,
    form.visibility,
    targetNode
  ].join("|");
  return `robotcloud:agent-upload:${signature}`;
}

function isMixedContentAgentUploadSession(session: BackendDatasetUploadSession): boolean {
  if (typeof window === "undefined" || window.location.protocol !== "https:") {
    return false;
  }
  try {
    return new URL(session.upload_url).protocol === "http:";
  } catch {
    return false;
  }
}

function shouldRefreshStoredAgentUploadSession(error: unknown): boolean {
  const status = Number((error as { status?: number }).status);
  if ([400, 401, 404].includes(status)) {
    return true;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    !Number.isFinite(status) &&
    (message.includes("network error") || message.includes("load failed") || message.includes("failed to fetch"))
  );
}

function xhrAgentJson<T>(
  method: string,
  url: string,
  body: Blob | null,
  headers: Record<string, string>,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<T> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => {
      try {
        xhr.abort();
      } catch {
      }
      settle(() => reject(createAbortError(signal)));
    };

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = parseAgentJson<T>(xhr.responseText, "Request failed");
          settle(() => resolve(parsed));
        } catch (error) {
          settle(() => reject(error));
        }
      } else {
        let message = xhr.responseText.trim();
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (typeof parsed.detail === "string" && parsed.detail) {
            message = parsed.detail;
          } else if (typeof parsed.message === "string" && parsed.message) {
            message = parsed.message;
          }
        } catch {
          // ignore
        }
        if (!message) {
          message = `Request failed with status ${xhr.status}`;
        }
        const error = new Error(message) as Error & { status?: number };
        error.status = xhr.status;
        settle(() => reject(error));
      }
    };

    xhr.onerror = () => {
      settle(() => reject(new Error("Network error")));
    };

    xhr.onabort = () => {
      settle(() => reject(createAbortError(signal)));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.open(method, url);
    Object.entries(headers).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    if (body) {
      xhr.setRequestHeader("Content-Type", body.type || "application/octet-stream");
    }
    throwIfAborted(signal);
    xhr.send(body);
  });
}

async function uploadFileToAgentLegacyWithProgress<T>(
  session: BackendDatasetUploadSession,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<T> {
  return xhrAgentJson<T>(
    "POST",
    session.upload_url,
    file,
    agentUploadHeaders(session),
    (loaded, total) => {
      if (total > 0 && onProgress) {
        onProgress(Math.round((loaded / total) * 100));
      }
    },
    signal
  );
}

async function uploadAgentChunkWithRetry(
  session: BackendDatasetUploadSession,
  file: File,
  start: number,
  end: number,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<number> {
  throwIfAborted(signal);
  const chunk = file.slice(start, end + 1, file.type || "application/octet-stream");
  let attempt = 0;
  let lastError: unknown;
  while (attempt < AGENT_UPLOAD_RETRY_LIMIT) {
    throwIfAborted(signal);
    attempt += 1;
    try {
      const result = await xhrAgentJson<AgentUploadChunkResult>(
        "PUT",
        agentUploadEndpoint(session, "chunk"),
        chunk,
        {
          ...agentUploadHeaders(session),
          "Content-Range": `bytes ${start}-${end}/${file.size}`,
          "X-File-Size": String(file.size)
        },
        (loaded) => {
          if (onProgress) {
            onProgress(Math.min(99, Math.round(((start + loaded) / file.size) * 100)));
          }
        },
        signal
      );
      return Math.max(Number(result.uploaded_bytes ?? end + 1), end + 1);
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      lastError = error;
      try {
        const status = await agentFetchJson<AgentUploadStatus>(agentUploadEndpoint(session, "status"), {
          method: "GET",
          headers: agentUploadHeaders(session),
          signal
        });
        const uploadedBytes = Math.max(Number(status.uploaded_bytes ?? 0), 0);
        if (uploadedBytes > start) {
          return Math.min(uploadedBytes, file.size);
        }
      } catch (statusError) {
        lastError = statusError;
      }
      if (attempt < AGENT_UPLOAD_RETRY_LIMIT) {
        await sleep(AGENT_UPLOAD_RETRY_DELAY_MS * attempt, signal);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Upload chunk failed");
}

async function uploadFileToAgentResumableWithProgress(
  session: BackendDatasetUploadSession,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<BackendDatasetUploadComplete> {
  throwIfAborted(signal);
  const headers = agentUploadHeaders(session);
  const chunkSize = Math.max(Number(session.chunk_size ?? DEFAULT_AGENT_UPLOAD_CHUNK_SIZE), 1024 * 1024);
  const status = await agentFetchJson<AgentUploadStatus>(agentUploadEndpoint(session, "status"), {
    method: "GET",
    headers,
    signal
  });
  let uploadedBytes = Math.min(Math.max(Number(status.uploaded_bytes ?? 0), 0), file.size);
  if (onProgress && uploadedBytes > 0) {
    onProgress(Math.min(99, Math.round((uploadedBytes / file.size) * 100)));
  }

  while (uploadedBytes < file.size) {
    throwIfAborted(signal);
    const start = uploadedBytes;
    const end = Math.min(start + chunkSize, file.size) - 1;
    uploadedBytes = await uploadAgentChunkWithRetry(session, file, start, end, onProgress, signal);
  }

  const completed = await agentFetchJson<BackendDatasetUploadComplete>(agentUploadEndpoint(session, "complete"), {
    method: "POST",
    headers: {
      ...headers,
      "X-File-Size": String(file.size)
    },
    signal
  });
  if (onProgress) {
    onProgress(100);
  }
  return completed;
}

async function uploadFileToAgentWithProgress(
  session: BackendDatasetUploadSession,
  file: File,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<BackendDatasetUploadComplete> {
  try {
    return await uploadFileToAgentResumableWithProgress(session, file, onProgress, signal);
  } catch (error) {
    if (isAbortError(error) || (error as { status?: number }).status !== 404) {
      throw error;
    }
    return uploadFileToAgentLegacyWithProgress<BackendDatasetUploadComplete>(session, file, onProgress, signal);
  }
}

function mapAgent(item: BackendAgent): GpuAgent {
  return {
    nodeName: item.node_name,
    ip: item.ip,
    apiPort: item.api_port,
    gpuTotal: item.gpu_total,
    gpuFree: item.gpu_free,
    gpuBusy: item.gpu_busy,
    gpuSlotTotal: item.gpu_slot_total ?? item.gpu_total,
    gpuSlotFree: item.gpu_slot_free ?? item.gpu_free,
    gpuSlotBusy: item.gpu_slot_busy ?? item.gpu_busy,
    status: item.status,
    version: item.version,
    publicBaseUrl: item.public_base_url,
    uploadEnabled: item.upload_enabled,
    canUpload: item.can_upload,
    isDefault: item.is_default,
    lastHeartbeat: item.last_heartbeat
  };
}

export const robotCloudApi = {
  fetchBackendVersion: async (): Promise<BuildVersionInfo> => {
    const data = await request<BackendBuildVersion>("/version");
    return {
      version: data.version,
      buildCommit: data.build_commit,
      buildTime: data.build_time
    };
  },
  loginWithPassword: async (payload: AuthCredentials, options?: LoginOptions): Promise<AuthSession> => {
    const device = getLoginDeviceContext();
    const data = await request<BackendLoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        device_id: device.deviceId,
        device_type: device.deviceType,
        replace_existing_device: Boolean(options?.replaceExistingDevice)
      })
    });

    return {
      token: data.token,
      userId: data.user_id,
      phone: data.phone,
      role: data.role,
      expireAt: data.expire_at
    };
  },
  createPayment: async (targetRole: UserRole, provider: string = "alipay"): Promise<Payment> => {
    const data = await request<BackendPayment>("/payment/create", {
      method: "POST",
      body: JSON.stringify({ target_role: targetRole, provider })
    });
    return {
      paymentId: data.payment_id,
      targetRole: data.target_role,
      amountCents: data.amount_cents,
      currency: data.currency,
      provider: data.provider,
      status: data.status,
      appliedAt: data.applied_at,
      createdAt: data.created_at,
      checkoutUrl: data.checkout_url,
      payCode: data.pay_code
    };
  },
  paymentStatus: async (paymentId: string): Promise<Payment> => {
    const data = await request<BackendPayment>(`/payment/${paymentId}`);
    return {
      paymentId: data.payment_id,
      targetRole: data.target_role,
      amountCents: data.amount_cents,
      currency: data.currency,
      provider: data.provider,
      status: data.status,
      appliedAt: data.applied_at,
      createdAt: data.created_at,
      checkoutUrl: data.checkout_url
    };
  },
  alipayQuery: async (paymentId: string): Promise<Payment> => {
    const data = await request<BackendPayment>(`/payment/alipay/query/${paymentId}`);
    return {
      paymentId: data.payment_id,
      targetRole: data.target_role,
      amountCents: data.amount_cents,
      currency: data.currency,
      provider: data.provider,
      status: data.status,
      appliedAt: data.applied_at,
      createdAt: data.created_at,
      checkoutUrl: data.checkout_url
    };
  },
  mockPaymentCallback: async (paymentId: string, status: "succeeded" | "failed" | "canceled" = "succeeded"): Promise<Payment> => {
    const data = await request<BackendPayment>("/payment/callback/mock", {
      method: "POST",
      body: JSON.stringify({ payment_id: paymentId, status })
    });
    return {
      paymentId: data.payment_id,
      targetRole: data.target_role,
      amountCents: data.amount_cents,
      currency: data.currency,
      provider: data.provider,
      status: data.status,
      appliedAt: data.applied_at,
      createdAt: data.created_at,
      checkoutUrl: data.checkout_url
    };
  },
  upgradePlan: async (targetRole: UserRole, paymentId: string): Promise<{ role: UserRole; expireAt: string | null }> => {
    const data = await request<{ role: UserRole; expire_at: string | null }>("/user/upgrade", {
      method: "POST",
      body: JSON.stringify({ target_role: targetRole, payment_id: paymentId })
    });
    return { role: data.role, expireAt: data.expire_at };
  },
  fetchProfile: async (): Promise<{ userId: number; phone: string; role: UserRole; expireAt: string | null }> => {
    const data = await request<{ user_id: number; phone: string; role: UserRole; expire_at: string | null }>("/user/profile");
    return { userId: data.user_id, phone: data.phone, role: data.role, expireAt: data.expire_at };
  },
  fetchTrainingLog: async (
    params: { taskId: number; offset?: number; limit?: number }
  ): Promise<{ content: string; nextOffset: number; complete: boolean }> => {
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 65536;
    const data = await request<{ content: string; next_offset: number; complete: boolean }>(
      `/training/${params.taskId}/logs?offset=${offset}&limit=${limit}`
    );
    return { content: data.content, nextOffset: data.next_offset, complete: data.complete };
  },
  fetchInferenceLog: async (
    params: { taskId: number; offset?: number; limit?: number }
  ): Promise<{ content: string; nextOffset: number; complete: boolean }> => {
    const offset = params.offset ?? 0;
    const limit = params.limit ?? 65536;
    const data = await request<{ content: string; next_offset: number; complete: boolean }>(
      `/inference/${params.taskId}/logs?offset=${offset}&limit=${limit}`
    );
    return { content: data.content, nextOffset: data.next_offset, complete: data.complete };
  },
  requestOtp: async (phone: string) => {
    const data = await request<{ sent: boolean; code?: string }>("/auth/send_code", {
      method: "POST",
      body: JSON.stringify({ phone })
    });
    return data;
  },
  loginWithCode: async (payload: { phone: string; code: string }, options?: LoginOptions): Promise<AuthSession> => {
    const device = getLoginDeviceContext();
    const data = await request<BackendLoginResponse>("/auth/login_code", {
      method: "POST",
      body: JSON.stringify({
        phone: payload.phone,
        code: payload.code,
        device_id: device.deviceId,
        device_type: device.deviceType,
        replace_existing_device: Boolean(options?.replaceExistingDevice)
      })
    });
    return {
      token: data.token,
      userId: data.user_id,
      phone: data.phone,
      role: data.role,
      expireAt: data.expire_at
    };
  },
  logout: () =>
    request<{ logged_out: boolean }>("/auth/logout", {
      method: "POST"
    }),
  verifyOtp: (payload: OtpPayload) =>
    request<{ user_id: number }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        phone: payload.phone,
        password: payload.password,
        code: payload.code
      })
    }),
  fetchDashboard: async (): Promise<DashboardSummary> => {
    const data = await request<BackendDashboardResponse>("/dashboard/summary");
    return {
      activeJobs: data.active_jobs,
      datasets: data.datasets,
      tier: data.tier,
      gpuHours: data.gpu_hours
    };
  },
  listDatasets: async (): Promise<DatasetSummary[]> => {
    const data = await request<{ items: BackendDataset[]; total: number }>("/dataset/list?page=1&size=50");
    return data.items.map((item) => ({
      id: item.dataset_id,
      name: item.name,
      description: item.description,
      visibility: item.visibility,
      status: item.status,
      createdAt: item.created_at,
      fileName: item.file_name ?? null,
      fileSize: item.file_size ?? null,
      totalFiles: item.total_files ?? null,
      previewAvailable: Boolean(item.preview_available),
      storageBackend: item.storage_backend,
      storageNode: item.storage_node ?? ""
    }));
  },
  listActiveAgents: async (): Promise<{ items: GpuAgent[]; defaultAgentNode: string }> => {
    const data = await request<{ items: BackendAgent[]; total: number; default_agent_node: string }>("/agents/active");
    return {
      items: data.items.map(mapAgent),
      defaultAgentNode: data.default_agent_node
    };
  },
  getUserSettings: async (): Promise<UserSettings> => {
    const data = await request<BackendUserSettings>("/user/settings");
    return { defaultAgentNode: data.default_agent_node };
  },
  updateDefaultAgent: async (nodeName: string): Promise<UserSettings> => {
    const data = await request<BackendUserSettings>("/user/settings", {
      method: "POST",
      body: JSON.stringify({ default_agent_node: nodeName })
    });
    return { defaultAgentNode: data.default_agent_node };
  },
  deleteDataset: async (datasetId: number): Promise<{ deleted: boolean }> =>
    request<{ deleted: boolean }>(`/dataset/${datasetId}/delete`, { method: "POST" }),
  uploadDataset: async (form: DatasetUploadInput & { onProgress?: (percent: number) => void; signal?: AbortSignal }) => {
    const storageKey = agentUploadStorageKey(form);
    const createSession = async () => {
      const created = await request<BackendDatasetUploadSession>("/dataset/upload_session", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          visibility: form.visibility,
          filename: form.file.name,
          target_node: form.targetNode || ""
        })
      });
      writeStoredAgentUploadSession(storageKey, {
        session: created,
        fileName: form.file.name,
        fileSize: form.file.size,
        lastModified: form.file.lastModified,
        name: form.name,
        description: form.description,
        visibility: form.visibility,
        targetNode: form.targetNode || ""
      });
      return created;
    };
    let session = readStoredAgentUploadSession(storageKey);
    const restoredStoredSession = Boolean(session);
    try {
      throwIfAborted(form.signal);
      if (!session) {
        session = await createSession();
      }
      let response: BackendDatasetUploadComplete;
      try {
        response = await uploadFileToAgentWithProgress(session, form.file, form.onProgress, form.signal);
      } catch (error) {
        if (isAbortError(error) || !restoredStoredSession || !shouldRefreshStoredAgentUploadSession(error)) {
          throw error;
        }
        removeStoredAgentUploadSession(storageKey);
        session = await createSession();
        response = await uploadFileToAgentWithProgress(session, form.file, form.onProgress, form.signal);
      }
      removeStoredAgentUploadSession(storageKey);
      const result: DatasetUploadResult = {
        datasetId: response.dataset_id,
        status: response.status,
        fileName: response.file_name,
        fileSize: response.file_size,
        totalFiles: response.total_files
      };
      return result;
    } catch (error) {
      if (isAbortError(error) && uploadAbortReason(form.signal) === "cancel") {
        removeStoredAgentUploadSession(storageKey);
        if (session) {
          try {
            await request<{ deleted: boolean }>(`/dataset/${session.dataset_id}/delete`, { method: "POST" });
          } catch {
          }
        }
      }
      throw error;
    }
  },
  fetchTrainingJobs: async (): Promise<TrainingJob[]> => {
    const data = await request<{ items: BackendTrainingTask[]; total: number }>("/training/list?page=1&size=20");
    return data.items.map((task) => ({
      id: task.task_id,
      datasetId: task.dataset_id,
      model: task.model_type,
      status: task.status,
      progress: Math.round(task.progress * 100),
      logsUrl: task.logs_url
    }));
  },
  deleteTrainingJob: async (taskId: number): Promise<{ deleted: boolean }> =>
    request<{ deleted: boolean }>(`/training/${taskId}/delete`, { method: "POST" }),
  createTrainingJob: async (config: TrainingConfig) => {
    const params = config.params ?? buildTrainingParams(config);
    const payload = {
      dataset_id: Number.parseInt(config.datasetId, 10),
      model_type: config.model,
      params
    };
    return request<{ task_id: number; status: string }>("/training/create", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  },
  fetchInferenceJobs: async (): Promise<InferenceJob[]> => {
    const data = await request<{ items: BackendInferenceTask[]; total: number }>("/inference/list?page=1&size=20");
    return data.items.map((task) => ({
      id: task.task_id,
      datasetId: task.dataset_id ?? null,
      modelId: task.model_id,
      status: task.status,
      progress: task.progress,
      serverHost: task.server_host ?? undefined,
      serverPort: task.server_port ?? undefined,
      checkpointPath: task.checkpoint_path ?? undefined,
      resultPath: task.result_path ?? undefined,
      errorMessage: task.error_message ?? undefined,
      createdAt: task.created_at,
      startedAt: task.started_at ?? undefined
    }));
  },
  runInference: async (params: { modelId: number }) =>
    request<{ task_id: number; status: string }>("/inference/create", {
      method: "POST",
      body: JSON.stringify({ model_id: params.modelId })
    }),
  closeInferenceJob: async (taskId: number): Promise<{ task_id: number; status: string; stopped?: boolean }> =>
    request<{ task_id: number; status: string; stopped?: boolean }>(`/inference/${taskId}/close`, { method: "POST" }),
  deleteInferenceJob: async (taskId: number): Promise<{ deleted: boolean }> =>
    request<{ deleted: boolean }>(`/inference/${taskId}/delete`, { method: "POST" }),
  fetchSimulatorSessions: async (): Promise<SimulatorSession[]> => {
    const data = await request<{ items: BackendSimulationTask[]; total: number }>("/sim/list?page=1&size=20");
    return data.items.map((task) => ({
      id: task.task_id,
      sceneFile: task.scene_file,
      modelId: task.model_id,
      robotType: task.robot_type,
      trainingMode: task.training_mode,
      status: task.status,
      createdAt: task.created_at
    }));
  },
  fetchAdminUsers: async (): Promise<AdminUser[]> => {
    const data = await request<{ items: BackendAdminUser[]; total: number }>("/admin/users?page=1");
    return data.items.map((user) => ({
      id: user.user_id,
      phone: user.phone,
      role: user.role,
      createdAt: user.created_at
    }));
  },
  fetchModels: async (): Promise<Model[]> => {
    const data = await request<{ items: BackendModel[]; total: number }>("/model/list?page=1&size=50");
    return data.items.map((item) => ({
      modelId: item.model_id,
      name: item.name,
      modelType: item.model_type,
      datasetId: item.dataset_id,
      datasetName: item.dataset_name,
      modelPath: item.model_path,
      checkpointPath: item.checkpoint_path,
      createdAt: item.created_at
    }));
  },
  getModel: async (modelId: number): Promise<Model> => {
    const item = await request<BackendModel>(`/model/${modelId}`);
    return {
      modelId: item.model_id,
      name: item.name,
      modelType: item.model_type,
      datasetId: item.dataset_id,
      datasetName: item.dataset_name,
      modelPath: item.model_path,
      checkpointPath: item.checkpoint_path,
      createdAt: item.created_at,
      params: item.params
    };
  },
  deleteModel: async (modelId: number): Promise<{ deleted: boolean }> =>
    request<{ deleted: boolean }>(`/model/${modelId}/delete`, { method: "POST" })
};

export type RobotCloudApi = typeof robotCloudApi;
