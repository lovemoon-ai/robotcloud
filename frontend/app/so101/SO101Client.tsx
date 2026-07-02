"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { useDesktopBridgeAvailable } from "@/hooks/useDesktopBridgeAvailable";

type FormState = {
  followerPort: string;
  leaderPort: string;
  cameraId: string;
  width: number;
  height: number;
  fps: number;
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

type LogLine = {
  id: string;
  text: string;
  stream: "stdout" | "stderr" | "system";
};

type PortInfo = {
  device: string;
  name?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  hwid?: string | null;
};

type CameraInfo = {
  id?: string | number;
  type?: string;
  name?: string;
  default_stream_profile?: {
    width?: number;
    height?: number;
    fps?: number;
  };
  [key: string]: unknown;
};

const initialForm: FormState = {
  followerPort: "",
  leaderPort: "",
  cameraId: "",
  width: 640,
  height: 480,
  fps: 30,
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
  task: "SO-101 desktop teleoperation"
};

const quickActions = [
  { id: "ports", label: "Detect ports", description: "Use LeRobot find-port helpers to list USB serial devices." },
  { id: "cameras", label: "Detect cameras", description: "Use LeRobot camera discovery and load connection metadata." },
  { id: "setup-follower", label: "Setup follower", description: "Assign or check follower motor IDs." },
  { id: "setup-leader", label: "Setup leader", description: "Assign or check leader motor IDs." },
  { id: "calibrate-follower", label: "Calibrate follower", description: "Run LeRobot follower calibration." },
  { id: "calibrate-leader", label: "Calibrate leader", description: "Run LeRobot leader calibration." },
  { id: "teleop", label: "Teleoperate", description: "Run bounded SO101 teleoperation." },
  { id: "record", label: "Record dataset", description: "Record LeRobot episodes locally." }
];

function toRunConfig(action: string, form: FormState) {
  return {
    action,
    followerPort: form.followerPort,
    leaderPort: form.leaderPort,
    cameraId: form.cameraId,
    width: form.width,
    height: form.height,
    fps: form.fps,
    robotId: form.robotId,
    teleopId: form.teleopId,
    datasetRepoId: form.datasetRepoId,
    datasetRoot: form.datasetRoot,
    episodes: form.episodes,
    episodeTimeS: form.episodeTimeS,
    resetTimeS: form.resetTimeS,
    teleopTimeS: form.teleopTimeS,
    maxRelativeTarget: form.maxRelativeTarget,
    displayData: form.displayData,
    task: form.task
  };
}

function appendLog(setter: Dispatch<SetStateAction<LogLine[]>>, stream: LogLine["stream"], text: string) {
  setter((current) => [
    ...current.slice(-399),
    {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      stream,
      text
    }
  ]);
}

function markerPayload(text: string, marker: string) {
  for (const line of text.split(/\r?\n/)) {
    const markerIndex = line.indexOf(marker);
    if (markerIndex >= 0) return line.slice(markerIndex + marker.length).trim();
  }
  return null;
}

function portLabel(port: PortInfo) {
  return [port.device, port.description, port.manufacturer].filter(Boolean).join(" - ");
}

function cameraLabel(camera: CameraInfo) {
  const id = camera.id ?? camera.name ?? "";
  const profile = camera.default_stream_profile;
  const profileLabel = profile ? `${profile.width ?? "?"}x${profile.height ?? "?"}@${profile.fps ?? "?"}` : "";
  return [camera.type, id, profileLabel].filter(Boolean).join(" - ");
}

function cameraId(camera: CameraInfo) {
  const id = camera.id ?? camera.name ?? "";
  return String(id);
}

export function SO101Client() {
  const router = useRouter();
  const isDesktop = useDesktopBridgeAvailable();
  const [bridgeChecked, setBridgeChecked] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [detectedPorts, setDetectedPorts] = useState<PortInfo[]>([]);
  const [detectedCameras, setDetectedCameras] = useState<CameraInfo[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const terminalContainerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<{ write: (data: string) => void; dispose: () => void; resize: (cols: number, rows: number) => void; onData: (cb: (data: string) => void) => { dispose: () => void } } | null>(null);
  const terminalSessionRef = useRef<string | null>(null);
  const desktop = typeof window !== "undefined" ? window.robotcloudDesktop : undefined;
  const bridgeReady = isDesktop || Boolean(desktop?.isDesktop);

  useEffect(() => {
    if (bridgeReady) {
      setBridgeChecked(true);
      return;
    }

    const timer = window.setTimeout(() => {
      setBridgeChecked(true);
      router.replace("/");
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [bridgeReady, router]);

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
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
    const nextStatus = await window.robotcloudDesktop.status();
    setStatus(nextStatus);
  }, []);

  const applyDetectionMarkers = useCallback((text: string) => {
    const portsPayload = markerPayload(text, "ROBOTCLOUD_PORTS_JSON=");
    if (portsPayload) {
      try {
        const ports = JSON.parse(portsPayload) as PortInfo[];
        const devices = ports.map((port) => port.device).filter(Boolean);
        setDetectedPorts(ports);
        setForm((current) => ({
          ...current,
          followerPort: current.followerPort || devices[0] || "",
          leaderPort: current.leaderPort || devices.find((device) => device !== (current.followerPort || devices[0])) || ""
        }));
      } catch (error) {
        appendLog(setLogs, "stderr", `Could not parse detected ports: ${String(error)}\n`);
      }
    }

    const camerasPayload = markerPayload(text, "ROBOTCLOUD_CAMERAS_JSON=");
    if (camerasPayload) {
      try {
        const cameras = JSON.parse(camerasPayload) as CameraInfo[];
        const firstCamera = cameras[0];
        setDetectedCameras(cameras);
        if (firstCamera) {
          const profile = firstCamera.default_stream_profile;
          setForm((current) => ({
            ...current,
            cameraId: current.cameraId || cameraId(firstCamera),
            width: profile?.width || current.width,
            height: profile?.height || current.height,
            fps: profile?.fps || current.fps
          }));
        }
      } catch (error) {
        appendLog(setLogs, "stderr", `Could not parse detected cameras: ${String(error)}\n`);
      }
    }
  }, []);

  useEffect(() => {
    if (!bridgeReady) return;
    refreshStatus().catch((error) => appendLog(setLogs, "stderr", String(error)));
  }, [bridgeReady, refreshStatus]);

  useEffect(() => {
    if (!bridgeReady || !window.robotcloudDesktop) return;
    const offOutput = window.robotcloudDesktop.so101.onOutput((event) => {
      applyDetectionMarkers(event.data);
      appendLog(setLogs, event.stream, event.data);
    });
    const offExit = window.robotcloudDesktop.so101.onExit((event) => {
      appendLog(setLogs, "system", `\n[process ${event.runId} exited: code=${event.code ?? "null"} signal=${event.signal ?? "null"}]\n`);
      setActiveRunId((current) => (current === event.runId ? null : current));
      refreshStatus().catch(() => undefined);
    });
    return () => {
      offOutput();
      offExit();
    };
  }, [applyDetectionMarkers, bridgeReady, refreshStatus]);

  useEffect(() => {
    if (!bridgeReady || !window.robotcloudDesktop || !terminalContainerRef.current || terminalRef.current) return;
    let disposed = false;
    let terminalInputDisposable: { dispose: () => void } | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function startTerminal() {
      const [{ Terminal }, session] = await Promise.all([
        import("@xterm/xterm"),
        window.robotcloudDesktop!.terminal.start()
      ]);
      if (disposed || !terminalContainerRef.current) {
        await window.robotcloudDesktop?.terminal.stop(session.sessionId).catch(() => undefined);
        return;
      }
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
      });
      term.open(terminalContainerRef.current);
      term.write(`RobotCloud terminal: ${session.shell}\r\n`);
      terminalSessionRef.current = session.sessionId;
      setTerminalSessionId(session.sessionId);

      const resizeTerminal = () => {
        const container = terminalContainerRef.current;
        const currentSessionId = terminalSessionRef.current;
        if (!container || !currentSessionId) return;
        const cols = Math.max(40, Math.floor(container.clientWidth / 8));
        const rows = Math.max(10, Math.floor(container.clientHeight / 17));
        term.resize(cols, rows);
        window.robotcloudDesktop?.terminal.resize(currentSessionId, cols, rows).catch(() => undefined);
      };

      terminalInputDisposable = term.onData((data) => {
        const currentSessionId = terminalSessionRef.current;
        if (currentSessionId) {
          window.robotcloudDesktop?.terminal.write(currentSessionId, data);
        }
      });
      terminalRef.current = term;
      resizeObserver = new ResizeObserver(resizeTerminal);
      resizeObserver.observe(terminalContainerRef.current);
      resizeTerminal();
      setTerminalReady(true);
    }

    startTerminal().catch((error) => appendLog(setLogs, "stderr", `Terminal failed: ${String(error)}\n`));
    return () => {
      disposed = true;
      const sessionId = terminalSessionRef.current;
      if (sessionId) {
        window.robotcloudDesktop?.terminal.stop(sessionId).catch(() => undefined);
      }
      terminalInputDisposable?.dispose();
      resizeObserver?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      terminalSessionRef.current = null;
      setTerminalSessionId(null);
      setTerminalReady(false);
    };
  }, [bridgeReady]);

  useEffect(() => {
    if (!bridgeReady || !window.robotcloudDesktop) return;
    const offOutput = window.robotcloudDesktop.terminal.onOutput((event) => {
      if (event.sessionId === terminalSessionRef.current) {
        terminalRef.current?.write(event.data);
      }
    });
    const offExit = window.robotcloudDesktop.terminal.onExit((event) => {
      if (event.sessionId === terminalSessionRef.current) {
        terminalRef.current?.write(`\r\n[terminal exited: code=${event.code ?? "null"}]\r\n`);
        setTerminalReady(false);
        setTerminalSessionId(null);
      }
    });
    return () => {
      offOutput();
      offExit();
    };
  }, [bridgeReady]);

  const runAction = async (action: string) => {
    if (!window.robotcloudDesktop) {
      appendLog(setLogs, "stderr", "RobotCloud Desktop bridge is not available.\n");
      return;
    }
    setLogs([]);
    appendLog(setLogs, "system", `[starting ${action}]\n`);
    const result = await window.robotcloudDesktop.so101.run(toRunConfig(action, form));
    setActiveRunId(result.runId);
  };

  const stopAction = async () => {
    if (!activeRunId || !window.robotcloudDesktop) return;
    const stoppedRunId = activeRunId;
    const result = await window.robotcloudDesktop.so101.stop(stoppedRunId);
    if (result.stopped) {
      appendLog(setLogs, "system", `\n[stop requested for ${stoppedRunId}]\n`);
      setActiveRunId(null);
    }
  };

  const submitCustomCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const command = String(data.get("command") ?? "").trim();
    if (!command || !terminalSessionId || !window.robotcloudDesktop) return;
    window.robotcloudDesktop.terminal.write(terminalSessionId, `${command}\r`);
    event.currentTarget.reset();
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
      <main className="space-y-4">
        <h1 className="text-3xl font-bold text-body">SO101 Desktop Workbench</h1>
        <p className="text-sm text-muted">
          {bridgeChecked
            ? "This page is available from RobotCloud Desktop."
            : "Checking RobotCloud Desktop bridge..."}
        </p>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold text-body">SO101 Desktop Workbench</h1>
            <p className="text-sm text-muted">
              Local SO101 setup, calibration, teleoperation, dataset recording, and RobotCloud integration.
            </p>
          </div>
          <button
            type="button"
            onClick={() => refreshStatus()}
            className="rounded-md border border-theme px-3 py-2 text-sm font-semibold accent-text transition hover:accent-bg"
          >
            Refresh status
          </button>
        </div>
        {!bridgeReady ? (
          <p className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
            Desktop bridge is not available. Open this page from the RobotCloud Desktop app to control local hardware.
          </p>
        ) : null}
      </header>

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

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <section className="rounded-lg border border-theme bg-card p-5">
            <h2 className="text-xl font-semibold accent-text">Connection</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="text-muted">Follower port</span>
                <input
                  value={form.followerPort}
                  onChange={(e) => updateField("followerPort", e.target.value)}
                  list="so101-detected-ports"
                  placeholder="Run Detect ports"
                  className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body"
                />
              </label>
              <label className="text-sm">
                <span className="text-muted">Leader port</span>
                <input
                  value={form.leaderPort}
                  onChange={(e) => updateField("leaderPort", e.target.value)}
                  list="so101-detected-ports"
                  placeholder="Run Detect ports"
                  className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body"
                />
              </label>
              <label className="text-sm">
                <span className="text-muted">Camera id/path</span>
                <input
                  value={form.cameraId}
                  onChange={(e) => updateField("cameraId", e.target.value)}
                  list="so101-detected-cameras"
                  placeholder="Run Detect cameras"
                  className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body"
                />
              </label>
              <label className="text-sm">
                <span className="text-muted">FPS</span>
                <input type="number" value={form.fps} onChange={(e) => updateField("fps", Number(e.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Width</span>
                <input type="number" value={form.width} onChange={(e) => updateField("width", Number(e.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Height</span>
                <input type="number" value={form.height} onChange={(e) => updateField("height", Number(e.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
            </div>
            <datalist id="so101-detected-ports">
              {detectedPorts.map((port) => (
                <option key={port.device} value={port.device} label={portLabel(port)} />
              ))}
            </datalist>
            <datalist id="so101-detected-cameras">
              {detectedCameras.map((camera) => {
                const id = cameraId(camera);
                return <option key={id} value={id} label={cameraLabel(camera)} />;
              })}
            </datalist>
            {detectedPorts.length || detectedCameras.length ? (
              <div className="mt-4 space-y-2 text-xs text-muted">
                {detectedPorts.length ? (
                  <p>Ports: {detectedPorts.map((port) => portLabel(port)).join("; ")}</p>
                ) : null}
                {detectedCameras.length ? (
                  <p>Cameras: {detectedCameras.map((camera) => cameraLabel(camera)).join("; ")}</p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="rounded-lg border border-theme bg-card p-5">
            <h2 className="text-xl font-semibold accent-text">Capture</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="text-muted">Dataset repo id</span>
                <input value={form.datasetRepoId} onChange={(e) => updateField("datasetRepoId", e.target.value)} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Dataset root</span>
                <input value={form.datasetRoot} onChange={(e) => updateField("datasetRoot", e.target.value)} placeholder="Auto if empty" className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Episodes</span>
                <input type="number" value={form.episodes} onChange={(e) => updateField("episodes", Number(e.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Episode seconds</span>
                <input type="number" value={form.episodeTimeS} onChange={(e) => updateField("episodeTimeS", Number(e.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Teleop seconds</span>
                <input type="number" value={form.teleopTimeS} onChange={(e) => updateField("teleopTimeS", Number(e.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm">
                <span className="text-muted">Max relative target</span>
                <input type="number" step="0.5" value={form.maxRelativeTarget} onChange={(e) => updateField("maxRelativeTarget", Number(e.target.value))} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="text-muted">Task label</span>
                <input value={form.task} onChange={(e) => updateField("task", e.target.value)} className="mt-1 w-full rounded-md border border-theme bg-surface p-2 text-body" />
              </label>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" checked={form.displayData} onChange={(e) => updateField("displayData", e.target.checked)} />
                Display LeRobot data windows
              </label>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border border-theme bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold accent-text">Actions</h2>
              <button
                type="button"
                onClick={stopAction}
                disabled={!activeRunId}
                className="rounded-md border border-red-500/50 px-3 py-2 text-sm font-semibold text-red-400 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Stop current run
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => runAction(action.id)}
                  disabled={!bridgeReady || Boolean(activeRunId)}
                  className="rounded-lg border border-theme bg-surface p-3 text-left transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="block font-semibold accent-text">{action.label}</span>
                  <span className="mt-1 block text-xs text-muted">{action.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-theme bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-semibold accent-text">Command Output</h2>
              <span className="text-xs text-muted">{activeRunId ? `Running ${activeRunId}` : "Idle"}</span>
            </div>
            <pre className="mt-4 h-72 overflow-auto rounded-md bg-[#07111f] p-3 text-xs leading-relaxed text-[#d9e8f2]">
              {logs.length ? logs.map((line) => line.text).join("") : "No command output yet."}
            </pre>
          </section>

          <section className="rounded-lg border border-theme bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold accent-text">Terminal</h2>
              <span className="text-xs text-muted">{terminalReady ? "Ready" : "Starting"}</span>
            </div>
            <div ref={terminalContainerRef} className="mt-4 h-72 overflow-hidden rounded-md border border-theme bg-[#07111f] p-2" />
            <form onSubmit={submitCustomCommand} className="mt-3 flex gap-2">
              <input name="command" placeholder="Type a command and press Enter" className="min-w-0 flex-1 rounded-md border border-theme bg-surface p-2 text-sm text-body" />
              <button type="submit" disabled={!terminalReady} className="rounded-md gradient-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                Send
              </button>
            </form>
          </section>
        </div>
      </section>
    </main>
  );
}
