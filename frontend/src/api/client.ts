import {
  AdminUser,
  AuthCredentials,
  AuthResponse,
  DashboardSummary,
  DatasetSummary,
  InferenceJob,
  OtpPayload,
  SimulatorSession,
  TrainingConfig,
  TrainingJob
} from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "https://api.robotcloud.dev";

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export const robotCloudApi = {
  loginWithPassword: (payload: AuthCredentials) =>
    request<AuthResponse>(`${API_BASE}/auth/login`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  requestOtp: (phone: string) =>
    request<{ expiresIn: number }>(`${API_BASE}/auth/request-otp`, {
      method: "POST",
      body: JSON.stringify({ phone })
    }),
  verifyOtp: (payload: OtpPayload) =>
    request<AuthResponse>(`${API_BASE}/auth/verify-otp`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  fetchDashboard: () => request<DashboardSummary>(`${API_BASE}/dashboard/summary`, { method: "GET" }),
  listDatasets: () => request<DatasetSummary[]>(`${API_BASE}/datasets`, { method: "GET" }),
  uploadDataset: (form: { name: string; modality: string; visibility: "public" | "private" }) =>
    request<DatasetSummary>(`${API_BASE}/datasets`, {
      method: "POST",
      body: JSON.stringify(form)
    }),
  fetchTrainingJobs: () => request<TrainingJob[]>(`${API_BASE}/train/jobs`, { method: "GET" }),
  createTrainingJob: (config: TrainingConfig) =>
    request<TrainingJob>(`${API_BASE}/train/jobs`, {
      method: "POST",
      body: JSON.stringify(config)
    }),
  fetchInferenceJobs: () => request<InferenceJob[]>(`${API_BASE}/inference/jobs`, { method: "GET" }),
  runInference: (datasetId: string) =>
    request<InferenceJob>(`${API_BASE}/inference/jobs`, {
      method: "POST",
      body: JSON.stringify({ datasetId })
    }),
  fetchSimulatorSessions: () => request<SimulatorSession[]>(`${API_BASE}/simulator/sessions`, { method: "GET" }),
  fetchAdminUsers: () => request<AdminUser[]>(`${API_BASE}/admin/users`, { method: "GET" })
};

export type RobotCloudApi = typeof robotCloudApi;
