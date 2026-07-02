"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDesktopBridgeAvailability } from "@/hooks/useDesktopBridgeAvailable";

type CameraForm = {
  id: string;
  width: number;
  height: number;
  fps: number;
};

type FormState = {
  followerPort: string;
  leaderPort: string;
  cameras: [CameraForm, CameraForm, CameraForm];
  robotId: string;
  teleopId: string;
  datasetRepoId: string;
  datasetRoot: string;
  episodes: number;
  episodeTimeS: number;
  resetTimeS: number;
  teleopTimeS: number;
  maxRelativeTarget: number;
  displayData: boolean;
  task: string;
};

type TerminalPhase = "starting" | "ready" | "failed" | "closed";
type CheckPhase = "idle" | "checking" | "valid" | "invalid";
type CheckState = { phase: CheckPhase; message: string };
type PortKey = "followerPort" | "leaderPort";
type TerminalDisposable = { dispose: () => void };
type TerminalHandle = {
  write: (data: string) => void;
  focus: () => void;
  dispose: () => void;
  resize: (cols: number, rows: number) => void;
  onData: (cb: (data: string) => void) => TerminalDisposable;
  open: (element: HTMLElement) => void;
  element?: HTMLElement;
};
type TerminalStoreSnapshot = { phase: TerminalPhase; error: string | null };
type ActionId =
  | "info"
  | "setup-follower"
  | "setup-leader"
  | "calibrate-follower"
  | "calibrate-leader"
  | "teleop"
  | "record";

type ShellDialect = "posix" | "powershell";

const CONNECTION_STORAGE_KEY = "robotcloud-so101-connection";
const DEFAULT_CAMERA_COUNT = 1;
const MAX_CAMERAS = 3;
const cameraKeys = ["front", "side", "wrist"] as const;
const cameraLabels = ["Camera 0", "Camera 1", "Camera 2"] as const;

const initialCamera: CameraForm = {
  id: "",
  width: 640,
  height: 480,
  fps: 30
};

function defaultCamera(index: number): CameraForm {
  return {
    ...initialCamera,
    id: String(index)
  };
}

const initialForm: FormState = {
  followerPort: "",
  leaderPort: "",
  cameras: [
    defaultCamera(0),
    defaultCamera(1),
    defaultCamera(2)
  ],
  robotId: "so101_follower",
  teleopId: "so101_leader",
  datasetRepoId: "local/so101_desktop",
  datasetRoot: "",
  episodes: 1,
  episodeTimeS: 10,
  resetTimeS: 2,
  teleopTimeS: 5,
  maxRelativeTarget: 5,
  displayData: false,
  task: ""
};

const idleCheck: CheckState = { phase: "idle", message: "" };

const actions: Array<{ id: ActionId; label: string }> = [
  { id: "info", label: "Info" },
  { id: "setup-follower", label: "Setup follower" },
  { id: "setup-leader", label: "Setup leader" },
  { id: "calibrate-follower", label: "Calibrate follower" },
  { id: "calibrate-leader", label: "Calibrate leader" },
  { id: "teleop", label: "Teleoperate" },
  { id: "record", label: "Record" }
];

function shellDialect(status: DesktopStatus | null): ShellDialect {
  return status?.platform === "windows" ? "powershell" : "posix";
}

export function shellArg(value: string, dialect: ShellDialect = "posix") {
  if (dialect === "powershell") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function cameraRef(value: string) {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function requireValue(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`先配置 ${label}`);
  return trimmed;
}

function requireNumber(value: number, label: string, options: { integer?: boolean; min?: number } = {}) {
  const min = options.min ?? Number.MIN_VALUE;
  if (!Number.isFinite(value) || value < min || (options.integer && !Number.isInteger(value))) {
    throw new Error(`先配置 ${label}`);
  }
  return value;
}

function resolvedDatasetRoot(form: FormState, status: DesktopStatus | null) {
  const explicitRoot = form.datasetRoot.trim();
  if (explicitRoot) return explicitRoot;
  if (!status?.dataDir) return "";
  return `${status.dataDir.replace(/\/$/, "")}/datasets/${form.datasetRepoId}`;
}

function clampCameraCount(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_CAMERA_COUNT;
  return Math.min(MAX_CAMERAS, Math.max(DEFAULT_CAMERA_COUNT, Math.trunc(numeric)));
}

function toNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeCamera(value: unknown, index: number): CameraForm {
  const source = value && typeof value === "object" ? (value as Partial<CameraForm>) : {};
  const fallback = defaultCamera(index);
  return {
    id: typeof source.id === "string" ? source.id : fallback.id,
    width: toNumber(source.width, fallback.width),
    height: toNumber(source.height, fallback.height),
    fps: toNumber(source.fps, fallback.fps)
  };
}

export function parseConnectionSettings(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<FormState> & { cameraCount?: number };
    const camerasSource = Array.isArray(parsed.cameras) ? parsed.cameras : [];
    return {
      followerPort: typeof parsed.followerPort === "string" ? parsed.followerPort : initialForm.followerPort,
      leaderPort: typeof parsed.leaderPort === "string" ? parsed.leaderPort : initialForm.leaderPort,
      robotId: typeof parsed.robotId === "string" ? parsed.robotId : initialForm.robotId,
      teleopId: typeof parsed.teleopId === "string" ? parsed.teleopId : initialForm.teleopId,
      cameras: [
        normalizeCamera(camerasSource[0], 0),
        normalizeCamera(camerasSource[1], 1),
        normalizeCamera(camerasSource[2], 2)
      ] as [CameraForm, CameraForm, CameraForm],
      cameraCount: clampCameraCount(parsed.cameraCount)
    };
  } catch {
    return null;
  }
}

export function serializeConnectionSettings(form: FormState, cameraCount: number) {
  return JSON.stringify({
    followerPort: form.followerPort,
    leaderPort: form.leaderPort,
    robotId: form.robotId,
    teleopId: form.teleopId,
    cameras: form.cameras,
    cameraCount: clampCameraCount(cameraCount)
  });
}

function cameraConfigArg(form: FormState, cameraCount: number, quote: (value: string) => string, required = false) {
  const entries = form.cameras
    .slice(0, cameraCount)
    .map((camera, index) => ({ camera, key: cameraKeys[index] ?? cameraKeys[0] }))
    .filter(({ camera }) => camera.id.trim())
    .map(({ camera, key }) => {
      return `${key}: {type: opencv, index_or_path: ${cameraRef(camera.id)}, width: ${camera.width}, height: ${camera.height}, fps: ${camera.fps}}`;
    });

  if (!entries.length) {
    if (required) throw new Error("先配置 Camera 0");
    return null;
  }
  return `--robot.cameras=${quote(`{ ${entries.join(", ")} }`)}`;
}

export function buildActionCommand(action: ActionId, form: FormState, status: DesktopStatus | null, cameraCount: number) {
  const quote = (value: string) => shellArg(value, shellDialect(status));
  const followerPort = () => requireValue(form.followerPort, "Follower port");
  const leaderPort = () => requireValue(form.leaderPort, "Leader port");
  const robotId = () => requireValue(form.robotId, "Robot ID");
  const teleopId = () => requireValue(form.teleopId, "Teleop ID");

  switch (action) {
    case "info":
      return "lerobot-info";
    case "setup-follower":
      return [
        "lerobot-setup-motors",
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`
      ].join(" ");
    case "setup-leader":
      return [
        "lerobot-setup-motors",
        "--teleop.type=so101_leader",
        `--teleop.port=${quote(leaderPort())}`
      ].join(" ");
    case "calibrate-follower":
      return [
        "lerobot-calibrate",
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`,
        `--robot.id=${quote(robotId())}`
      ].join(" ");
    case "calibrate-leader":
      return [
        "lerobot-calibrate",
        "--teleop.type=so101_leader",
        `--teleop.port=${quote(leaderPort())}`,
        `--teleop.id=${quote(teleopId())}`
      ].join(" ");
    case "teleop":
      return [
        "lerobot-teleoperate",
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`,
        `--robot.id=${quote(robotId())}`,
        "--teleop.type=so101_leader",
        `--teleop.port=${quote(leaderPort())}`,
        `--teleop.id=${quote(teleopId())}`
      ].join(" ");
    case "record": {
      const repoId = requireValue(form.datasetRepoId, "Dataset repo id");
      const datasetRoot = resolvedDatasetRoot(form, status);
      const episodes = requireNumber(form.episodes, "Episodes", { integer: true, min: 1 });
      const episodeTimeS = requireNumber(form.episodeTimeS, "Episode seconds", { min: Number.MIN_VALUE });
      const resetTimeS = requireNumber(form.resetTimeS, "Reset seconds", { min: 0 });
      const cameraArg = cameraConfigArg(form, cameraCount, quote, true);
      if (!cameraArg) throw new Error("先配置 Camera 0");
      const parts = [
        "lerobot-record",
        "--robot.type=so101_follower",
        `--robot.port=${quote(followerPort())}`,
        `--robot.id=${quote(robotId())}`,
        cameraArg,
        "--teleop.type=so101_leader",
        `--teleop.port=${quote(leaderPort())}`,
        `--teleop.id=${quote(teleopId())}`,
        `--display_data=${form.displayData ? "true" : "false"}`,
        `--dataset.repo_id=${quote(repoId)}`,
        `--dataset.num_episodes=${episodes}`,
        `--dataset.single_task=${quote(requireValue(form.task, "Task label"))}`,
        "--dataset.push_to_hub=false",
        `--dataset.episode_time_s=${episodeTimeS}`,
        `--dataset.reset_time_s=${resetTimeS}`,
      ];
      if (datasetRoot) parts.splice(10, 0, `--dataset.root=${quote(datasetRoot)}`);
      if (shellDialect(status) === "powershell") {
        return `Remove-Item -Recurse -Force ~/.cache/huggingface/lerobot/${quote(repoId)} -ErrorAction SilentlyContinue; ${parts.join(" ")}`;
      }
      return `rm -rf ~/.cache/huggingface/lerobot/${quote(repoId)} && ${parts.join(" ")}`;
    }
  }
}

export const so101TestExports = {
  initialForm,
  parseConnectionSettings,
  serializeConnectionSettings,
  buildActionCommand,
  shellArg,
  resetPersistentTerminalForTest
};

function statusLabel(phase: TerminalPhase) {
  if (phase === "ready") return "Ready";
  if (phase === "failed") return "Failed";
  if (phase === "closed") return "Closed";
  return "Starting";
}

const persistentTerminalStore: {
  term: TerminalHandle | null;
  sessionId: string | null;
  shell: string | null;
  phase: TerminalPhase;
  error: string | null;
  starting: Promise<void> | null;
  inputDisposable: TerminalDisposable | null;
  offOutput: (() => void) | null;
  offExit: (() => void) | null;
  resizeObserver: ResizeObserver | null;
  host: HTMLDivElement | null;
  listeners: Set<() => void>;
} = {
  term: null,
  sessionId: null,
  shell: null,
  phase: "starting",
  error: null,
  starting: null,
  inputDisposable: null,
  offOutput: null,
  offExit: null,
  resizeObserver: null,
  host: null,
  listeners: new Set()
};

function persistentTerminalSnapshot(): TerminalStoreSnapshot {
  return {
    phase: persistentTerminalStore.phase,
    error: persistentTerminalStore.error
  };
}

function notifyPersistentTerminalListeners() {
  persistentTerminalStore.listeners.forEach((listener) => listener());
}

function subscribePersistentTerminal(listener: () => void) {
  persistentTerminalStore.listeners.add(listener);
  return () => {
    persistentTerminalStore.listeners.delete(listener);
  };
}

function setPersistentTerminalState(phase: TerminalPhase, error: string | null) {
  persistentTerminalStore.phase = phase;
  persistentTerminalStore.error = error;
  notifyPersistentTerminalListeners();
}

function setPersistentTerminalError(error: string | null) {
  persistentTerminalStore.error = error;
  notifyPersistentTerminalListeners();
}

function disconnectPersistentTerminalResize() {
  persistentTerminalStore.resizeObserver?.disconnect();
  persistentTerminalStore.resizeObserver = null;
}

function resizePersistentTerminal(container: HTMLDivElement) {
  const term = persistentTerminalStore.term;
  const sessionId = persistentTerminalStore.sessionId;
  if (!term || !sessionId) return;
  const cols = Math.max(40, Math.floor(container.clientWidth / 8));
  const rows = Math.max(14, Math.floor(container.clientHeight / 17));
  term.resize(cols, rows);
  window.robotcloudDesktop?.terminal.resize(sessionId, cols, rows).catch(() => undefined);
}

function attachPersistentTerminal(container: HTMLDivElement) {
  const term = persistentTerminalStore.term;
  if (!term) return;
  persistentTerminalStore.host = container;
  if (term.element) {
    container.replaceChildren(term.element);
  }
  disconnectPersistentTerminalResize();
  if (typeof ResizeObserver === "undefined") {
    resizePersistentTerminal(container);
  } else {
    persistentTerminalStore.resizeObserver = new ResizeObserver(() => resizePersistentTerminal(container));
    persistentTerminalStore.resizeObserver.observe(container);
    resizePersistentTerminal(container);
  }
  term.focus();
}

function ensurePersistentTerminalListeners(bridge: DesktopBridge) {
  if (!persistentTerminalStore.offOutput) {
    persistentTerminalStore.offOutput = bridge.terminal.onOutput((event) => {
      if (event.sessionId === persistentTerminalStore.sessionId) {
        persistentTerminalStore.term?.write(event.data);
      }
    });
  }

  if (!persistentTerminalStore.offExit) {
    persistentTerminalStore.offExit = bridge.terminal.onExit((event) => {
      if (event.sessionId === persistentTerminalStore.sessionId) {
        persistentTerminalStore.term?.write(`\r\n[terminal exited: code=${event.code ?? "null"}]\r\n`);
        persistentTerminalStore.sessionId = null;
        setPersistentTerminalState("closed", persistentTerminalStore.error);
      }
    });
  }
}

function ensurePersistentTerminal(bridge: DesktopBridge, container: HTMLDivElement) {
  persistentTerminalStore.host = container;
  ensurePersistentTerminalListeners(bridge);

  if (persistentTerminalStore.term) {
    attachPersistentTerminal(container);
    notifyPersistentTerminalListeners();
    return;
  }

  if (persistentTerminalStore.starting) {
    persistentTerminalStore.starting.then(() => {
      if (persistentTerminalStore.host) {
        attachPersistentTerminal(persistentTerminalStore.host);
      }
    });
    return;
  }

  setPersistentTerminalState("starting", null);
  persistentTerminalStore.starting = (async () => {
    const [{ Terminal }, session] = await Promise.all([
      import("@xterm/xterm"),
      bridge.terminal.start()
    ]);
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#07111f",
        foreground: "#d9e8f2",
        cursor: "#78dcca",
        selectionBackground: "#28465f"
      }
    }) as TerminalHandle;
    const host = persistentTerminalStore.host ?? container;
    persistentTerminalStore.term = term;
    persistentTerminalStore.sessionId = session.sessionId;
    persistentTerminalStore.shell = session.shell;
    term.open(host);
    term.write(`RobotCloud terminal: ${session.shell}\r\n`);
    persistentTerminalStore.inputDisposable = term.onData((data) => {
      const sessionId = persistentTerminalStore.sessionId;
      if (sessionId) {
        window.robotcloudDesktop?.terminal.write(sessionId, data).catch(() => undefined);
      }
    });
    if (persistentTerminalStore.host) {
      attachPersistentTerminal(persistentTerminalStore.host);
    }
    setPersistentTerminalState("ready", null);
  })()
    .catch((error) => {
      setPersistentTerminalState("failed", String(error));
    })
    .finally(() => {
      persistentTerminalStore.starting = null;
    });
}

function disposePersistentTerminalInstance() {
  disconnectPersistentTerminalResize();
  persistentTerminalStore.inputDisposable?.dispose();
  const terminalElement = persistentTerminalStore.term?.element;
  persistentTerminalStore.term?.dispose();
  terminalElement?.remove();
  persistentTerminalStore.term = null;
  persistentTerminalStore.sessionId = null;
  persistentTerminalStore.shell = null;
  persistentTerminalStore.inputDisposable = null;
}

function restartPersistentTerminal(bridge: DesktopBridge, container: HTMLDivElement) {
  disposePersistentTerminalInstance();
  setPersistentTerminalState("starting", null);
  ensurePersistentTerminal(bridge, container);
}

function resetPersistentTerminalForTest() {
  disposePersistentTerminalInstance();
  persistentTerminalStore.offOutput?.();
  persistentTerminalStore.offExit?.();
  persistentTerminalStore.phase = "starting";
  persistentTerminalStore.error = null;
  persistentTerminalStore.starting = null;
  persistentTerminalStore.offOutput = null;
  persistentTerminalStore.offExit = null;
  persistentTerminalStore.host = null;
  persistentTerminalStore.listeners.clear();
}

function CheckButton({
  state,
  onClick,
  disabled
}: {
  state: CheckState;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || state.phase === "checking"}
        className="rounded-md border border-theme px-3 py-2 text-xs font-semibold accent-text transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.phase === "checking" ? "Checking" : "Check"}
      </button>
      {state.phase === "valid" ? <span className="text-lg font-bold text-green-500">✓</span> : null}
      {state.phase === "invalid" ? <span className="text-sm font-semibold text-red-400">!</span> : null}
    </div>
  );
}

export function SO101Client() {
  const router = useRouter();
  const desktopBridgeAvailability = useDesktopBridgeAvailability();
  const [form, setForm] = useState<FormState>(initialForm);
  const [cameraCount, setCameraCount] = useState(DEFAULT_CAMERA_COUNT);
  const [connectionLoaded, setConnectionLoaded] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [terminalState, setTerminalState] = useState<TerminalStoreSnapshot>(() => persistentTerminalSnapshot());
  const [terminalContainerEl, setTerminalContainerEl] = useState<HTMLDivElement | null>(null);
  const [portChecks, setPortChecks] = useState<Record<PortKey, CheckState>>({
    followerPort: idleCheck,
    leaderPort: idleCheck
  });
  const [cameraChecks, setCameraChecks] = useState<[CheckState, CheckState, CheckState]>([
    idleCheck,
    idleCheck,
    idleCheck
  ]);
  const [previewingCamera, setPreviewingCamera] = useState<number | null>(null);
  const terminalPhase = terminalState.phase;
  const terminalError = terminalState.error;
  const bridgeReady = desktopBridgeAvailability === "available";

  useEffect(() => {
    const syncTerminalState = () => setTerminalState(persistentTerminalSnapshot());
    syncTerminalState();
    return subscribePersistentTerminal(syncTerminalState);
  }, []);

  useEffect(() => {
    const saved = parseConnectionSettings(window.localStorage.getItem(CONNECTION_STORAGE_KEY));
    if (saved) {
      setForm((current) => ({
        ...current,
        followerPort: saved.followerPort,
        leaderPort: saved.leaderPort,
        robotId: saved.robotId,
        teleopId: saved.teleopId,
        cameras: saved.cameras
      }));
      setCameraCount(saved.cameraCount);
    }
    setConnectionLoaded(true);
  }, []);

  useEffect(() => {
    if (!connectionLoaded) return;
    window.localStorage.setItem(
      CONNECTION_STORAGE_KEY,
      serializeConnectionSettings(form, cameraCount)
    );
  }, [cameraCount, connectionLoaded, form]);

  useEffect(() => {
    if (desktopBridgeAvailability === "unavailable") {
      router.replace("/");
    }
  }, [desktopBridgeAvailability, router]);

  const updateField = <K extends keyof Omit<FormState, "cameras">>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "followerPort" || key === "leaderPort") {
      setPortChecks((current) => ({ ...current, [key]: idleCheck }));
    }
  };

  const updateCamera = <K extends keyof CameraForm>(index: number, key: K, value: CameraForm[K]) => {
    setForm((current) => {
      const cameras = [...current.cameras] as [CameraForm, CameraForm, CameraForm];
      cameras[index] = { ...cameras[index], [key]: value };
      return { ...current, cameras };
    });
    setCameraChecks((current) => {
      const next = [...current] as [CheckState, CheckState, CheckState];
      next[index] = idleCheck;
      return next;
    });
  };

  const addCamera = () => {
    const nextCount = Math.min(MAX_CAMERAS, cameraCount + 1);
    if (nextCount === cameraCount) return;
    const addedIndex = nextCount - 1;
    setForm((currentForm) => {
      const cameras = [...currentForm.cameras] as [CameraForm, CameraForm, CameraForm];
      if (!cameras[addedIndex].id.trim()) {
        cameras[addedIndex] = defaultCamera(addedIndex);
      }
      return { ...currentForm, cameras };
    });
    setCameraCount(nextCount);
  };

  const terminalContainerRef = useCallback((node: HTMLDivElement | null) => {
    setTerminalContainerEl(node);
  }, []);

  const restartTerminal = () => {
    if (!window.robotcloudDesktop || !terminalContainerEl) return;
    restartPersistentTerminal(window.robotcloudDesktop, terminalContainerEl);
  };

  const refreshStatus = useCallback(async () => {
    if (!window.robotcloudDesktop) {
      setStatus({
        isDesktop: false,
        platform: "browser",
        appVersion: "browser",
        apiBaseUrl: "https://robotcloud.conductor-ai.top/api/v1",
        webUrl: "",
        runtimePath: null,
        runtimeReady: false,
        runtimeArchivePath: null,
        runtimeArchiveReady: false,
        runtimeError: null,
        scriptPath: null,
        scriptReady: false,
        dataDir: ""
      });
      return;
    }
    setStatus(await window.robotcloudDesktop.status());
  }, []);

  useEffect(() => {
    if (!bridgeReady) return;
    refreshStatus().catch((error) => setPersistentTerminalError(String(error)));
  }, [bridgeReady, refreshStatus]);

  useEffect(() => {
    if (!bridgeReady || !window.robotcloudDesktop || !terminalContainerEl) return;
    ensurePersistentTerminal(window.robotcloudDesktop, terminalContainerEl);
    return () => {
      if (persistentTerminalStore.host === terminalContainerEl) {
        persistentTerminalStore.host = null;
      }
      disconnectPersistentTerminalResize();
    };
  }, [bridgeReady, terminalContainerEl]);

  const writeTerminalCommand = async (command: string) => {
    const sessionId = persistentTerminalStore.sessionId;
    if (!sessionId || !window.robotcloudDesktop) {
      throw new Error("Terminal is not ready.");
    }
    await window.robotcloudDesktop.terminal.write(sessionId, `${command}\r`);
    persistentTerminalStore.term?.focus();
  };

  const runAction = async (action: ActionId) => {
    try {
      setPersistentTerminalError(null);
      await writeTerminalCommand(buildActionCommand(action, form, status, cameraCount));
    } catch (error) {
      setPersistentTerminalError(String(error));
    }
  };

  const checkPort = async (key: PortKey) => {
    if (!window.robotcloudDesktop) return;
    setPortChecks((current) => ({ ...current, [key]: { phase: "checking", message: "" } }));
    try {
      const result = await window.robotcloudDesktop.so101.validatePort(form[key]);
      setPortChecks((current) => ({
        ...current,
        [key]: { phase: result.ok ? "valid" : "invalid", message: result.message }
      }));
    } catch (error) {
      setPortChecks((current) => ({
        ...current,
        [key]: { phase: "invalid", message: String(error) }
      }));
    }
  };

  const checkCamera = async (index: number) => {
    if (!window.robotcloudDesktop) return;
    const camera = form.cameras[index];
    setCameraChecks((current) => {
      const next = [...current] as [CheckState, CheckState, CheckState];
      next[index] = { phase: "checking", message: "" };
      return next;
    });
    try {
      const result = await window.robotcloudDesktop.so101.validateCamera(camera.id, camera.width, camera.height);
      setCameraChecks((current) => {
        const next = [...current] as [CheckState, CheckState, CheckState];
        next[index] = { phase: result.ok ? "valid" : "invalid", message: result.message };
        return next;
      });
    } catch (error) {
      setCameraChecks((current) => {
        const next = [...current] as [CheckState, CheckState, CheckState];
        next[index] = { phase: "invalid", message: String(error) };
        return next;
      });
    }
  };

  const previewCamera = async (index: number) => {
    if (!window.robotcloudDesktop) return;
    const camera = form.cameras[index];
    setPreviewingCamera(index);
    try {
      await window.robotcloudDesktop.so101.previewCamera(camera.id, camera.width, camera.height, camera.fps);
      setCameraChecks((current) => {
        const next = [...current] as [CheckState, CheckState, CheckState];
        next[index] = { phase: "valid", message: "Preview opened." };
        return next;
      });
    } catch (error) {
      setCameraChecks((current) => {
        const next = [...current] as [CheckState, CheckState, CheckState];
        next[index] = { phase: "invalid", message: String(error) };
        return next;
      });
    } finally {
      setPreviewingCamera(null);
    }
  };

  const statusCards = useMemo(
    () => [
      { label: "Runtime", value: status?.runtimeReady ? "ready" : "missing", detail: status?.runtimeError ?? status?.runtimePath ?? "not found" },
      { label: "SO101 script", value: status?.scriptReady ? "ready" : "missing", detail: status?.scriptPath ?? "not found" },
      { label: "Data folder", value: "local", detail: status?.dataDir || "pending" },
      { label: "Cloud API", value: "online", detail: status?.apiBaseUrl ?? "https://robotcloud.conductor-ai.top/api/v1" }
    ],
    [status]
  );

  if (!bridgeReady) {
    return (
      <main className="flex min-h-[calc(100vh-10rem)] items-center justify-center">
        <section className="w-full max-w-md rounded-lg border border-theme bg-card p-5 text-center">
          <p className="text-sm font-semibold accent-text">Starting RobotCloud Desktop</p>
          <p className="mt-2 text-xs text-muted">Waiting for the local desktop bridge.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-body">SO101 Desktop Workbench</h1>
        <button
          type="button"
          onClick={() => refreshStatus()}
          className="rounded-md border border-theme px-3 py-2 text-sm font-semibold accent-text transition hover:accent-bg"
        >
          Refresh status
        </button>
      </header>

      <section className="rounded-lg border border-theme bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold accent-text">Terminal</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{statusLabel(terminalPhase)}</span>
            {terminalPhase === "closed" || terminalPhase === "failed" ? (
              <button
                type="button"
                onClick={restartTerminal}
                className="rounded-md border border-theme px-3 py-1.5 text-xs font-semibold accent-text transition hover:accent-bg"
              >
                New terminal
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setActionsOpen((current) => !current)}
              aria-expanded={actionsOpen}
              aria-label="Toggle actions"
              className="flex h-8 w-8 items-center justify-center rounded-md border border-theme text-lg font-semibold accent-text transition hover:accent-bg"
            >
              {actionsOpen ? "-" : "+"}
            </button>
          </div>
        </div>
        {actionsOpen ? (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => runAction(action.id)}
                disabled={terminalPhase !== "ready"}
                className="shrink-0 rounded-md border border-theme bg-surface px-3 py-2 text-sm font-semibold accent-text transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
        <div
          ref={terminalContainerRef}
          onClick={() => persistentTerminalStore.term?.focus()}
          className="mt-4 h-[30rem] overflow-hidden rounded-md border border-theme bg-[#07111f] p-2"
        />
        {terminalError ? <p className="mt-3 text-xs text-red-400">{terminalError}</p> : null}
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-lg border border-theme bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold accent-text">Connection</h2>
              <button
                type="button"
                onClick={addCamera}
                disabled={cameraCount >= MAX_CAMERAS}
                aria-label="Add camera"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-theme text-lg font-semibold accent-text transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
            </div>
            <div className="mt-4 grid gap-4">
              {([
                ["followerPort", "Follower port"],
                ["leaderPort", "Leader port"]
              ] as Array<[PortKey, string]>).map(([key, label]) => (
                <div key={key}>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-0 flex-1 text-sm">
                      <span className="text-muted">{label}</span>
                      <input
                        value={form[key]}
                        onChange={(event) => updateField(key, event.target.value)}
                        placeholder="/dev/cu.usbmodem..."
                        className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body"
                      />
                    </label>
                    <CheckButton state={portChecks[key]} onClick={() => checkPort(key)} disabled={!form[key].trim()} />
                  </div>
                  {portChecks[key].message ? <p className="mt-1 text-xs text-muted">{portChecks[key].message}</p> : null}
                </div>
              ))}

              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <span className="text-muted">Robot ID</span>
                  <input
                    value={form.robotId}
                    onChange={(event) => updateField("robotId", event.target.value)}
                    className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body"
                  />
                </label>
                <label className="text-sm">
                  <span className="text-muted">Teleop ID</span>
                  <input
                    value={form.teleopId}
                    onChange={(event) => updateField("teleopId", event.target.value)}
                    className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body"
                  />
                </label>
              </div>

              {form.cameras.slice(0, cameraCount).map((camera, index) => (
                <div key={cameraLabels[index]} className="rounded-md border border-theme bg-surface p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="min-w-0 flex-1 text-sm">
                      <span className="text-muted">{cameraLabels[index]} id/path</span>
                      <input
                        value={camera.id}
                        onChange={(event) => updateCamera(index, "id", event.target.value)}
                        placeholder={String(index)}
                        className="mt-1 w-full rounded-md border border-theme bg-card p-2 text-body"
                      />
                    </label>
                    <CheckButton
                      state={cameraChecks[index]}
                      onClick={() => checkCamera(index)}
                      disabled={!camera.id.trim()}
                    />
                    <button
                      type="button"
                      onClick={() => previewCamera(index)}
                      disabled={!camera.id.trim() || previewingCamera === index}
                      className="rounded-md border border-theme px-3 py-2 text-xs font-semibold accent-text transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {previewingCamera === index ? "Opening" : "Preview"}
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <label className="text-xs text-muted">
                      Width
                      <input
                        type="number"
                        value={camera.width}
                        onChange={(event) => updateCamera(index, "width", Number(event.target.value))}
                        className="mt-1 w-full rounded-md border border-theme bg-card p-2 text-body"
                      />
                    </label>
                    <label className="text-xs text-muted">
                      Height
                      <input
                        type="number"
                        value={camera.height}
                        onChange={(event) => updateCamera(index, "height", Number(event.target.value))}
                        className="mt-1 w-full rounded-md border border-theme bg-card p-2 text-body"
                      />
                    </label>
                    <label className="text-xs text-muted">
                      FPS
                      <input
                        type="number"
                        value={camera.fps}
                        onChange={(event) => updateCamera(index, "fps", Number(event.target.value))}
                        className="mt-1 w-full rounded-md border border-theme bg-card p-2 text-body"
                      />
                    </label>
                  </div>
                  {cameraChecks[index].message ? <p className="mt-2 text-xs text-muted">{cameraChecks[index].message}</p> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-theme bg-card p-5">
            <h2 className="text-xl font-semibold accent-text">Record</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="text-muted">Dataset repo id</span>
                <input value={form.datasetRepoId} onChange={(event) => updateField("datasetRepoId", event.target.value)} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Dataset root</span>
                <input value={form.datasetRoot} onChange={(event) => updateField("datasetRoot", event.target.value)} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Episodes</span>
                <input type="number" value={form.episodes} onChange={(event) => updateField("episodes", Number(event.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Episode seconds</span>
                <input type="number" value={form.episodeTimeS} onChange={(event) => updateField("episodeTimeS", Number(event.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Teleop seconds</span>
                <input type="number" value={form.teleopTimeS} onChange={(event) => updateField("teleopTimeS", Number(event.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Max relative target</span>
                <input type="number" step="0.5" value={form.maxRelativeTarget} onChange={(event) => updateField("maxRelativeTarget", Number(event.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="text-muted">Task label</span>
                <input
                  value={form.task}
                  onChange={(event) => updateField("task", event.target.value)}
                  placeholder="Descripe your task ..."
                  className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={form.displayData} onChange={(event) => updateField("displayData", event.target.checked)} />
                Display LeRobot data windows
              </label>
            </div>
          </section>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {statusCards.map((card) => (
          <div key={card.label} className="rounded-lg border border-theme bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs uppercase tracking-wide text-muted">{card.label}</span>
              <span className="rounded border border-theme px-2 py-0.5 text-xs accent-text">{card.value}</span>
            </div>
            <p className="mt-2 break-all text-xs text-muted">{card.detail}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
