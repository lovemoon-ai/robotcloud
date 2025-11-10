export interface AuthCredentials {
  phone: string;
  password: string;
}

export interface OtpPayload {
  phone: string;
  password: string;
  code: string;
  invitationCode: string;
}

export interface InviteRegistrationPayload {
  phone: string;
  password: string;
  invitationCode: string;
}

export type UserRole = "free" | "plus" | "pro" | "admin";

export interface AuthSession {
  token: string;
  userId: number;
  phone: string;
  role: UserRole;
  expireAt: string | null;
}

export interface DashboardSummary {
  activeJobs: number;
  datasets: number;
  tier: UserRole;
  gpuHours: number;
}

export interface DatasetSummary {
  id: number;
  name: string;
  description: string;
  visibility: "public" | "private";
  status: string;
  createdAt: string;
  fileName?: string | null;
  fileSize?: number | null;
  totalFiles?: number | null;
  previewAvailable: boolean;
}

export interface DatasetUploadInput {
  file: File;
  name: string;
  description: string;
  visibility: "public" | "private";
}

export interface DatasetUploadResult {
  datasetId: number;
  status: string;
  fileName: string;
  fileSize: number;
  totalFiles: number;
}

export interface TrainingJob {
  id: number;
  model: string;
  status: string;
  progress: number;
  datasetId: number;
  logsUrl: string;
}

export interface TrainingLogChunk {
  content: string;
  nextOffset: number;
  complete: boolean;
}

export interface TrainingConfig {
  model: string;
  datasetId: string;
  learningRate: number;
  steps: number;
  batchSize: number;
}

export interface InferenceJob {
  id: number;
  datasetId: number;
  modelId: number;
  status: string;
  resultPath?: string | null;
}

export interface SimulatorSession {
  id: number;
  sceneFile: string;
  modelId: number;
  robotType: string;
  trainingMode: string;
  status: string;
  createdAt: string;
}

export interface AdminUser {
  id: number;
  phone: string;
  role: UserRole;
  createdAt: string;
}
