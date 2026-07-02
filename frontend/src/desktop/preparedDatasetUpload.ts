export const PREPARED_DATASET_UPLOAD_STORAGE_KEY = "robotcloud:prepared-dataset-upload";

export type PreparedDatasetUploadState = {
  filePath: string;
  fileName: string;
  fileSize: number;
  datasetRoot: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  createdAt: string;
};

function isVisibility(value: unknown): value is "public" | "private" {
  return value === "public" || value === "private";
}

export function parsePreparedDatasetUpload(raw: string | null): PreparedDatasetUploadState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PreparedDatasetUploadState>;
    if (
      typeof parsed.filePath !== "string" ||
      typeof parsed.fileName !== "string" ||
      typeof parsed.datasetRoot !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.description !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.fileSize !== "number" ||
      !Number.isFinite(parsed.fileSize) ||
      !isVisibility(parsed.visibility)
    ) {
      return null;
    }
    return {
      filePath: parsed.filePath,
      fileName: parsed.fileName,
      fileSize: parsed.fileSize,
      datasetRoot: parsed.datasetRoot,
      name: parsed.name,
      description: parsed.description,
      visibility: parsed.visibility,
      createdAt: parsed.createdAt
    };
  } catch {
    return null;
  }
}

export function readPreparedDatasetUpload(): PreparedDatasetUploadState | null {
  if (typeof sessionStorage === "undefined") return null;
  return parsePreparedDatasetUpload(sessionStorage.getItem(PREPARED_DATASET_UPLOAD_STORAGE_KEY));
}

export function writePreparedDatasetUpload(value: PreparedDatasetUploadState): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(PREPARED_DATASET_UPLOAD_STORAGE_KEY, JSON.stringify(value));
}

export function clearPreparedDatasetUpload(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(PREPARED_DATASET_UPLOAD_STORAGE_KEY);
}
