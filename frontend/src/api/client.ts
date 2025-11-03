import { useAuthStore } from "@/store/useAuthStore";
import {
  AdminUser,
  AuthCredentials,
  AuthSession,
  DashboardSummary,
  DatasetSummary,
  DatasetUploadInput,
  InferenceJob,
  InviteRegistrationPayload,
  OtpPayload,
  SimulatorSession,
  TrainingConfig,
  TrainingJob,
  UserRole
} from "@/types";

const RAW_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";
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
    throw new Error(message);
  }

  const payload = (await response.json()) as ApiResponse<T>;
  if (payload.code !== 0) {
    throw new Error(payload.message || "Request failed");
  }
  return payload.data;
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
  requestOtp: (phone: string) =>
    request<{ sent: boolean }>("/auth/send_code", {
      method: "POST",
      body: JSON.stringify({ phone })
    }),
  verifyOtp: (payload: OtpPayload) =>
    request<{ user_id: number }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        phone: payload.phone,
        password: payload.password,
        code: payload.code,
        invitation_code: payload.invitationCode
      })
    }),
  registerWithInvitation: (payload: InviteRegistrationPayload) =>
    request<{ user_id: number }>("/auth/register_invite", {
      method: "POST",
      body: JSON.stringify({
        phone: payload.phone,
        password: payload.password,
        invitation_code: payload.invitationCode
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
      createdAt: item.created_at
    }));
  },
  uploadDataset: async (form: DatasetUploadInput) => {
    const body = new FormData();
    body.append("file", form.file);
    body.append("name", form.name);
    body.append("description", form.description);
    body.append("visibility", form.visibility);
    return request<{ dataset_id: number; status: string }>("/dataset/upload", {
      method: "POST",
      body
    });
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
  createTrainingJob: async (config: TrainingConfig) => {
    const payload = {
      dataset_id: Number.parseInt(config.datasetId, 10),
      model_type: config.model,
      params: {
        learning_rate: config.learningRate,
        epochs: config.epochs,
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
