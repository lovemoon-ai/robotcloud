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
  stats?: DatasetUploadInspectionState;
};

export type DatasetUploadInspectionState = {
  datasetRoot: string;
  fileCount: number;
  totalBytes: number;
  episodeCount: number;
  totalFrames?: number | null;
  fps?: number | null;
  durationSeconds?: number | null;
};

function isVisibility(value: unknown): value is "public" | "private" {
  return value === "public" || value === "private";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalFiniteNumber(value: unknown): number | null | undefined {
  if (value == null) return value;
  return isFiniteNumber(value) ? value : undefined;
}

function parseDatasetUploadInspection(value: unknown): DatasetUploadInspectionState | undefined {
  const parsed = value && typeof value === "object" ? (value as Partial<DatasetUploadInspectionState>) : null;
  if (
    !parsed ||
    typeof parsed.datasetRoot !== "string" ||
    !isFiniteNumber(parsed.fileCount) ||
    !isFiniteNumber(parsed.totalBytes) ||
    !isFiniteNumber(parsed.episodeCount)
  ) {
    return undefined;
  }

  const totalFrames = optionalFiniteNumber(parsed.totalFrames);
  const fps = optionalFiniteNumber(parsed.fps);
  const durationSeconds = optionalFiniteNumber(parsed.durationSeconds);

  return {
    datasetRoot: parsed.datasetRoot,
    fileCount: parsed.fileCount,
    totalBytes: parsed.totalBytes,
    episodeCount: parsed.episodeCount,
    ...(totalFrames !== undefined ? { totalFrames } : {}),
    ...(fps !== undefined ? { fps } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {})
  };
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
    const stats = parseDatasetUploadInspection(parsed.stats);
    return {
      filePath: parsed.filePath,
      fileName: parsed.fileName,
      fileSize: parsed.fileSize,
      datasetRoot: parsed.datasetRoot,
      name: parsed.name,
      description: parsed.description,
      visibility: parsed.visibility,
      createdAt: parsed.createdAt,
      ...(stats ? { stats } : {})
    };
  } catch {
    return null;
  }
}

function desktopDatasetBridge() {
  if (typeof window === "undefined") return undefined;
  return window.robotcloudDesktop?.dataset;
}

function readPreparedDatasetUploadFromSession(): PreparedDatasetUploadState | null {
  if (typeof sessionStorage === "undefined") return null;
  return parsePreparedDatasetUpload(sessionStorage.getItem(PREPARED_DATASET_UPLOAD_STORAGE_KEY));
}

function writePreparedDatasetUploadToSession(value: PreparedDatasetUploadState): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(PREPARED_DATASET_UPLOAD_STORAGE_KEY, JSON.stringify(value));
}

function clearPreparedDatasetUploadFromSession(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(PREPARED_DATASET_UPLOAD_STORAGE_KEY);
}

export async function readPreparedDatasetUpload(): Promise<PreparedDatasetUploadState | null> {
  const bridge = desktopDatasetBridge();
  if (bridge?.getPreparedUpload) {
    try {
      const prepared = await bridge.getPreparedUpload();
      if (prepared) {
        writePreparedDatasetUploadToSession(prepared);
        return prepared;
      }
    } catch {
      // Fall back to same-origin browser storage for plain web and older desktop builds.
    }
  }
  return readPreparedDatasetUploadFromSession();
}

export async function writePreparedDatasetUpload(value: PreparedDatasetUploadState): Promise<void> {
  writePreparedDatasetUploadToSession(value);
  const bridge = desktopDatasetBridge();
  if (!bridge?.setPreparedUpload) return;
  try {
    await bridge.setPreparedUpload(value);
  } catch {
    // Session storage is still enough for same-origin web flows.
  }
}

export async function clearPreparedDatasetUpload(): Promise<void> {
  clearPreparedDatasetUploadFromSession();
  const bridge = desktopDatasetBridge();
  if (!bridge?.clearPreparedUpload) return;
  try {
    await bridge.clearPreparedUpload();
  } catch {
    // Ignore bridge cleanup failures; stale bridge state is validated before reuse.
  }
}
