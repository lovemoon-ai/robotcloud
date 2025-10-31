export type UserTier = "free" | "plus" | "pro";

export interface AuthCredentials {
  phone: string;
  password: string;
}

export interface OtpPayload {
  phone: string;
  code: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    name: string;
    tier: UserTier;
  };
}

export interface DashboardSummary {
  activeJobs: number;
  datasets: number;
  tier: UserTier;
  gpuHours: number;
}

export interface DatasetSummary {
  id: string;
  name: string;
  modality: string;
  samples: number;
  visibility: "public" | "private";
}

export interface TrainingJob {
  id: string;
  model: string;
  status: "pending" | "running" | "succeeded" | "failed";
  progress: number;
}

export interface TrainingConfig {
  model: string;
  datasetId: string;
  learningRate: number;
  epochs: number;
  batchSize: number;
}

export interface InferenceJob {
  id: string;
  datasetId: string;
  status: "queued" | "processing" | "done" | "error";
  accuracy?: number;
}

export interface SimulatorSession {
  id: string;
  environment: string;
  status: "idle" | "running" | "error";
}

export interface AdminUser {
  id: string;
  name: string;
  tier: UserTier;
  lastActive: string;
}
