declare global {
type DesktopStatus = {
  isDesktop: boolean;
  platform: string;
  appVersion: string;
  appBuildCommit?: string;
  appBuildTime?: string;
  lerobotVersion?: string | null;
  bundledLerobotVersion?: string | null;
  lerobotUpdateAvailable?: boolean;
  apiBaseUrl: string;
  webUrl: string;
  runtimePath: string | null;
  runtimeReady: boolean;
  runtimeArchivePath: string | null;
  runtimeArchiveReady: boolean;
  runtimeError?: string | null;
  scriptsDir: string | null;
  scriptReady: boolean;
  dataDir: string;
};

type So101RunConfig = {
  action: string;
  followerPort?: string;
  leaderPort?: string;
  cameraId?: string;
  cameraConfig?: string;
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
  minEpisodeTimeS?: number;
  maxEpisodeTimeS?: number;
  stationaryHoldTimeS?: number;
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

type DatasetUploadInspection = {
  datasetRoot: string;
  fileCount: number;
  totalBytes: number;
  episodeCount: number;
  totalFrames?: number | null;
  fps?: number | null;
  durationSeconds?: number | null;
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
  stats?: DatasetUploadInspection;
};

type DatasetPrepareUploadErrorEvent = {
  message: string;
};

type DesktopAuthSession = {
  token: string;
  userId: number;
  phone: string;
  role: "free" | "plus" | "pro" | "admin";
  expireAt: string | null;
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
  width?: number | null;
  height?: number | null;
  fps?: number | null;
};

type TerminalStarted = {
  sessionId: string;
  shell: string;
  replay?: string;
};

type RuntimeProgressEvent = {
  phase: string;
  message: string;
  command?: string | null;
  stream?: string | null;
  output?: string | null;
  current?: number | null;
  total?: number | null;
};

type RuntimePrepared = {
  runtimePath: string;
  ready: boolean;
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
    validateCamera: (cameraId: string, width: number, height: number, fps: number) => Promise<ValidationResult>;
    previewCamera: (cameraId: string, width: number, height: number, fps: number) => Promise<{ runId: string }>;
    getSettings?: () => Promise<string | null>;
    setSettings?: (settings: string) => Promise<{ ok: boolean }>;
    onOutput: (callback: (event: ProcessOutputEvent) => void) => () => void;
    onExit: (callback: (event: ProcessExitEvent) => void) => () => void;
  };
  dataset: {
    inspectUpload?: (config: DatasetPrepareUploadConfig) => Promise<DatasetUploadInspection>;
    prepareUpload: (config: DatasetPrepareUploadConfig) => Promise<PreparedDatasetUpload>;
    getPreparedUpload?: () => Promise<PreparedDatasetUpload | null>;
    setPreparedUpload?: (prepared: PreparedDatasetUpload) => Promise<void>;
    clearPreparedUpload?: () => Promise<void>;
    readPreparedUpload: (filePath: string) => Promise<ArrayBuffer>;
    onPreparedUpload?: (callback: (prepared: PreparedDatasetUpload) => void) => () => void;
    onPrepareUploadError?: (callback: (event: DatasetPrepareUploadErrorEvent) => void) => () => void;
  };
  auth?: {
    getSession: () => Promise<DesktopAuthSession | null>;
    setSession: (session: DesktopAuthSession) => Promise<void>;
    clearSession: () => Promise<void>;
  };
  runtime?: {
    prepare: () => Promise<RuntimePrepared>;
    update?: () => Promise<RuntimePrepared>;
    onProgress: (callback: (event: RuntimeProgressEvent) => void) => () => void;
  };
  terminal: {
    current?: () => Promise<TerminalStarted | null>;
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
