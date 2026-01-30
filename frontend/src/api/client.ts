import getConfig from "next/config";
import { useAuthStore } from "@/store/useAuthStore";
import {
  AdminUser,
  AuthCredentials,
  AuthSession,
  DashboardSummary,
  DatasetSummary,
  DatasetUploadInput,
  DatasetUploadResult,
  InferenceJob,
  OtpPayload,
  Payment,
  SimulatorSession,
  TrainingConfig,
  TrainingJob,
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

const RAW_API_BASE =
  runtimeConfig?.publicRuntimeConfig?.apiBaseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE;
const API_BASE = RAW_API_BASE.replace(/\/$/, "");

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
  file_name?: string | null;
  file_size?: number | null;
  total_files?: number | null;
  preview_available?: boolean;
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
  dataset_id: number;
  status: string;
  result_path: string | null;
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

function isAuthError(status: number, message: string): boolean {
  const normalized = message.toLowerCase();
  if (status === 401) return true;
  if (status === 400) {
    return (
      normalized.includes("invalid token") ||
      normalized.includes("token required") ||
      normalized.includes("invalid authorization header")
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

function uploadWithProgress<T>(
  url: string,
  body: FormData,
  onProgress?: (percent: number) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const token = useAuthStore.getState().token;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const percent = Math.round((event.loaded / event.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const payload = JSON.parse(xhr.responseText) as ApiResponse<T>;
          if (payload.code !== 0) {
            reject(new Error(payload.message || "Request failed"));
          } else {
            resolve(payload.data);
          }
        } catch {
          reject(new Error("Invalid response format"));
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
        if (isAuthError(xhr.status, message)) {
          try {
            useAuthStore.getState().reset();
          } catch {
            // ignore
          }
        }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error"));
    };

    xhr.open("POST", url);
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }
    xhr.send(body);
  });
}

export const robotCloudApi = {
  loginWithPassword: async (payload: AuthCredentials): Promise<AuthSession> => {
    const data = await request<BackendLoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    return {
      token: data.token,
      userId: data.user_id,
      phone: data.phone,
      role: data.role,
      expireAt: data.expire_at
    };
  },
  createPayment: async (targetRole: UserRole, provider: string = "wechat"): Promise<Payment> => {
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
  requestOtp: async (phone: string) => {
    const data = await request<{ sent: boolean; code?: string }>("/auth/send_code", {
      method: "POST",
      body: JSON.stringify({ phone })
    });
    return data;
  },
  loginWithCode: async (payload: { phone: string; code: string }): Promise<AuthSession> => {
    const data = await request<BackendLoginResponse>("/auth/login_code", {
      method: "POST",
      body: JSON.stringify({
        phone: payload.phone,
        code: payload.code
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
      previewAvailable: Boolean(item.preview_available)
    }));
  },
  uploadDataset: async (form: DatasetUploadInput & { onProgress?: (percent: number) => void }) => {
    const body = new FormData();
    body.append("file", form.file);
    body.append("name", form.name);
    body.append("description", form.description);
    body.append("visibility", form.visibility);
    const response = await uploadWithProgress<{
      dataset_id: number;
      status: string;
      file_name: string;
      file_size: number;
      total_files: number;
    }>(`${API_BASE}/dataset/upload`, body, form.onProgress);
    const result: DatasetUploadResult = {
      datasetId: response.dataset_id,
      status: response.status,
      fileName: response.file_name,
      fileSize: response.file_size,
      totalFiles: response.total_files
    };
    return result;
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
    const payload = {
      dataset_id: Number.parseInt(config.datasetId, 10),
      model_type: config.model,
      params: {
        learning_rate: config.learningRate,
        steps: config.steps,
        batch_size: config.batchSize
      }
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
      datasetId: task.dataset_id,
      modelId: task.model_id,
      status: task.status,
      resultPath: task.result_path ?? undefined
    }));
  },
  runInference: async (params: { modelId: number; datasetId: number }) =>
    request<{ task_id: number; status: string }>("/inference/create", {
      method: "POST",
      body: JSON.stringify({ model_id: params.modelId, dataset_id: params.datasetId })
    }),
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
  }
};

export type RobotCloudApi = typeof robotCloudApi;
