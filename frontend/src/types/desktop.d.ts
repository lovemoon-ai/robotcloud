declare global {
type DesktopStatus = {
  isDesktop: boolean;
  platform: string;
  appVersion: string;
  apiBaseUrl: string;
  webUrl: string;
  runtimePath: string | null;
  runtimeReady: boolean;
  runtimeArchivePath: string | null;
  runtimeArchiveReady: boolean;
  runtimeError?: string | null;
  scriptPath: string | null;
  scriptReady: boolean;
  dataDir: string;
};

type So101RunConfig = {
  action: string;
  followerPort?: string;
  leaderPort?: string;
  cameraId?: string;
  cameraIndex?: number;
  width?: number;
  height?: number;
  fps?: number;
  robotId?: string;
  teleopId?: string;
  datasetRepoId?: string;
  datasetRoot?: string;
  episodes?: number;
  episodeTimeS?: number;
  resetTimeS?: number;
  task?: string;
  teleopTimeS?: number;
  maxRelativeTarget?: number;
  displayData?: boolean;
};

type DatasetPrepareUploadConfig = {
  datasetRoot: string;
  datasetRepoId: string;
  task?: string;
};

type PreparedDatasetUpload = {
  filePath: string;
  fileName: string;
  fileSize: number;
  datasetRoot: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  createdAt: string;
};

type ProcessOutputEvent = {
  runId?: string;
  run_id?: string;
  stream: "stdout" | "stderr" | "system";
  data: string;
};

type ProcessExitEvent = {
  runId?: string;
  run_id?: string;
  code: number | null;
  signal: string | null;
};

type ValidationResult = {
  ok: boolean;
  message: string;
};

type TerminalStarted = {
  sessionId: string;
  shell: string;
};

type TerminalOutputEvent = {
  sessionId: string;
  data: string;
};

type TerminalExitEvent = {
  sessionId: string;
  code: number | null;
  signal: string | null;
};

type DesktopBridge = {
  isDesktop: true;
  status: () => Promise<DesktopStatus>;
  so101: {
    run: (config: So101RunConfig) => Promise<{ runId: string }>;
    stop: (runId: string) => Promise<{ stopped: boolean }>;
    validatePort: (value: string) => Promise<ValidationResult>;
    validateCamera: (cameraId: string, width: number, height: number) => Promise<ValidationResult>;
    previewCamera: (cameraId: string, width: number, height: number, fps: number) => Promise<{ runId: string }>;
    onOutput: (callback: (event: ProcessOutputEvent) => void) => () => void;
    onExit: (callback: (event: ProcessExitEvent) => void) => () => void;
  };
  dataset: {
    prepareUpload: (config: DatasetPrepareUploadConfig) => Promise<PreparedDatasetUpload>;
    readPreparedUpload: (filePath: string) => Promise<ArrayBuffer>;
  };
  terminal: {
    start: () => Promise<TerminalStarted>;
    write: (sessionId: string, data: string) => Promise<{ ok: boolean }>;
    resize: (sessionId: string, cols: number, rows: number) => Promise<{ ok: boolean }>;
    stop: (sessionId: string) => Promise<{ stopped: boolean }>;
    onOutput: (callback: (event: TerminalOutputEvent) => void) => () => void;
    onExit: (callback: (event: TerminalExitEvent) => void) => () => void;
  };
};

  interface Window {
    robotcloudDesktop?: DesktopBridge;
  }
}

export {};
