import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { SO101Client, so101TestExports } from "../app/so101/SO101Client";
import { robotCloudApi } from "@/api/client";
import { inferenceJobServerAddress } from "@/inference/jobs";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";
import { resetDesktopBridgeAvailabilityForTest } from "@/hooks/useDesktopBridgeAvailable";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    element?: HTMLElement;
    focus = jest.fn(() => {
      this.element?.focus();
    });
    resize = jest.fn();
    dispose = jest.fn();

    open(parent: HTMLElement) {
      this.element = document.createElement("div");
      this.element.dataset.testid = "mock-xterm";
      this.element.tabIndex = 0;
      parent.appendChild(this.element);
    }

    write(data: string) {
      if (this.element) {
        this.element.textContent = `${this.element.textContent ?? ""}${data}`;
      }
    }

    onData() {
      return { dispose: jest.fn() };
    }
  }
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    prefetch: jest.fn()
  })
}));

afterEach(() => {
  jest.restoreAllMocks();
  so101TestExports.resetPersistentTerminalForTest();
  resetDesktopBridgeAvailabilityForTest();
  useAuthStore.getState().reset();
  useLocaleStore.getState().reset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  mockPush.mockClear();
});

function authenticate() {
  useAuthStore.getState().setAuth({
    token: "token",
    userId: 1,
    phone: "13800000000",
    role: "free",
    expireAt: null
  });
}

describe("SO101 page environment guard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReplace.mockClear();
    useAuthStore.getState().reset();
    delete window.robotcloudDesktop;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("redirects unauthenticated users to login before starting SO101", async () => {
    const { container } = render(<SO101Client />);

    expect(container).toHaveTextContent("Login required");

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/login?next=%2Fso101");
    });
  });

  it("does not start a local terminal for unauthenticated Desktop users", async () => {
    const status = jest.fn().mockResolvedValue({
      isDesktop: true,
      platform: "macos",
      appVersion: "test",
      apiBaseUrl: "http://127.0.0.1:8000/api/v1",
      webUrl: "http://127.0.0.1:3000/so101/",
      runtimePath: "/runtime",
      runtimeReady: true,
      runtimeArchivePath: null,
      runtimeArchiveReady: false,
      runtimeError: null,
      scriptsDir: "/script",
      scriptReady: true,
      dataDir: "/tmp/robotcloud data"
    });
    const terminalStart = jest.fn().mockResolvedValue({ sessionId: "session-1", shell: "/bin/zsh" });
    window.robotcloudDesktop = {
      isDesktop: true,
      status,
      so101: {
        run: jest.fn(),
        stop: jest.fn(),
        validatePort: jest.fn(),
        validateCamera: jest.fn(),
        previewCamera: jest.fn(),
        onOutput: jest.fn(() => jest.fn()),
        onExit: jest.fn(() => jest.fn())
      },
      dataset: {
        inspectUpload: jest.fn(),
        prepareUpload: jest.fn(),
        readPreparedUpload: jest.fn()
      },
      terminal: {
        start: terminalStart,
        write: jest.fn(),
        resize: jest.fn(),
        stop: jest.fn(),
        onOutput: jest.fn(() => jest.fn()),
        onExit: jest.fn(() => jest.fn())
      }
    };

    const { container } = render(<SO101Client />);

    expect(container).toHaveTextContent("Login required");
    await waitFor(() => {
      expect(status).toHaveBeenCalled();
    });
    expect(mockReplace).toHaveBeenCalledWith("/login?next=%2Fso101");
    expect(terminalStart).not.toHaveBeenCalled();
  });

  it("shows startup state and redirects away in a browser", async () => {
    authenticate();
    const { container } = render(<SO101Client />);

    expect(container).toHaveTextContent("Starting RobotCloud Desktop");
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });

    expect(container).toHaveTextContent("Starting RobotCloud Desktop");
    expect(mockReplace).toHaveBeenCalledWith("/");
  });
});

describe("SO101 terminal session", () => {
  const desktopStatus: DesktopStatus = {
    isDesktop: true,
    platform: "macos",
    appVersion: "test",
    appBuildCommit: "test-commit",
    appBuildTime: "2026-07-08T00:00:00Z",
    lerobotVersion: "0.6.0",
    apiBaseUrl: "http://127.0.0.1:8000/api/v1",
    webUrl: "http://127.0.0.1:3000/so101/",
    runtimePath: "/runtime",
    runtimeReady: true,
    runtimeArchivePath: null,
    runtimeArchiveReady: false,
    runtimeError: null,
    scriptsDir: "/script",
    scriptReady: true,
    dataDir: "/tmp/robotcloud data"
  };

  function installDesktopBridge(options: {
    status?: jest.Mock;
    runtime?: DesktopBridge["runtime"];
    terminalCurrent?: jest.Mock;
    so101Settings?: string | null;
  } = {}) {
    let outputCallback: ((event: TerminalOutputEvent) => void) | null = null;
    let exitCallback: ((event: TerminalExitEvent) => void) | null = null;
    let preparedUploadCallback: ((prepared: PreparedDatasetUpload) => void) | null = null;
    let prepareUploadErrorCallback: ((event: DatasetPrepareUploadErrorEvent) => void) | null = null;
    let persistedSettings = options.so101Settings ?? null;
    const status = options.status ?? jest.fn().mockResolvedValue(desktopStatus);
    const terminalStart = jest.fn().mockResolvedValue({ sessionId: "session-1", shell: "/bin/zsh" });
    const terminalCurrent = options.terminalCurrent ?? jest.fn().mockResolvedValue(null);
    const terminalWrite = jest.fn().mockResolvedValue({ ok: true });
    const terminalStop = jest.fn().mockResolvedValue({ stopped: true });
    const getSettings = jest.fn().mockImplementation(() => Promise.resolve(persistedSettings));
    const setSettings = jest.fn().mockImplementation((settings: string) => {
      persistedSettings = settings;
      return Promise.resolve({ ok: true });
    });
    const validateCamera = jest.fn();
    const inspectUpload = jest.fn().mockResolvedValue({
      datasetRoot: "/tmp/robotcloud data/datasets/local/so101_desktop",
      fileCount: 4,
      totalBytes: 2048,
      episodeCount: 1,
      totalFrames: 300,
      fps: 30,
      durationSeconds: 10
    });
    const prepareUpload = jest.fn().mockResolvedValue({
      filePath: "/tmp/robotcloud data/prepared_uploads/local_so101_desktop.zip",
      fileName: "local_so101_desktop.zip",
      fileSize: 2048,
      datasetRoot: "/tmp/robotcloud data/datasets/local/so101_desktop",
      name: "local/so101_desktop",
      description: "SO101 Desktop recording",
      visibility: "private",
      createdAt: "1760000000000"
    });
    let preparedUploadState: PreparedDatasetUpload | null = null;
    const getPreparedUpload = jest.fn().mockImplementation(() => Promise.resolve(preparedUploadState));
    const setPreparedUpload = jest.fn().mockImplementation((prepared: PreparedDatasetUpload) => {
      preparedUploadState = prepared;
      return Promise.resolve(undefined);
    });
    const bridge: DesktopBridge = {
      isDesktop: true,
      status,
      so101: {
        run: jest.fn(),
        stop: jest.fn(),
        validatePort: jest.fn(),
        validateCamera,
        previewCamera: jest.fn(),
        getSettings,
        setSettings,
        onOutput: jest.fn(() => jest.fn()),
        onExit: jest.fn(() => jest.fn())
      },
      dataset: {
        inspectUpload,
        prepareUpload,
        getPreparedUpload,
        setPreparedUpload,
        readPreparedUpload: jest.fn(),
        onPreparedUpload: jest.fn((callback) => {
          preparedUploadCallback = callback;
          return jest.fn();
        }),
        onPrepareUploadError: jest.fn((callback) => {
          prepareUploadErrorCallback = callback;
          return jest.fn();
        })
      },
      terminal: {
        current: terminalCurrent,
        start: terminalStart,
        write: terminalWrite,
        resize: jest.fn().mockResolvedValue({ ok: true }),
        stop: terminalStop,
        onOutput: jest.fn((callback) => {
          outputCallback = callback;
          return jest.fn();
        }),
        onExit: jest.fn((callback) => {
          exitCallback = callback;
          return jest.fn();
        })
      }
    };
    if (options.runtime) {
      bridge.runtime = options.runtime;
    }
    window.robotcloudDesktop = bridge;
    return {
      status,
      terminalStart,
      terminalCurrent,
      terminalWrite,
      terminalStop,
      getSettings,
      setSettings,
      validateCamera,
      inspectUpload,
      prepareUpload,
      getPreparedUpload,
      setPreparedUpload,
      setStoredPreparedUpload: (prepared: PreparedDatasetUpload | null) => {
        preparedUploadState = prepared;
      },
      emitOutput: (data: string) => outputCallback?.({ sessionId: "session-1", data }),
      emitExit: () => exitCallback?.({ sessionId: "session-1", code: 0, signal: null }),
      emitPreparedUpload: (prepared: PreparedDatasetUpload) => preparedUploadCallback?.(prepared),
      emitPrepareUploadError: (message: string) => prepareUploadErrorCallback?.({ message })
    };
  }

  beforeEach(() => {
    mockReplace.mockClear();
    authenticate();
    delete window.robotcloudDesktop;
  });

  it("keeps the terminal session and buffer when the SO101 tab remounts", async () => {
    const { terminalStart, terminalStop, emitOutput } = installDesktopBridge();

    const firstRender = render(<SO101Client />);

    await waitFor(() => {
      expect(firstRender.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });
    expect(firstRender.getByPlaceholderText("Descripe your task ...")).toHaveValue("");

    act(() => {
      emitOutput("first output\n");
    });

    expect(firstRender.getByTestId("mock-xterm")).toHaveTextContent("first output");
    firstRender.unmount();

    expect(terminalStop).not.toHaveBeenCalled();

    act(() => {
      emitOutput("output while hidden\n");
    });

    const secondRender = render(<SO101Client />);
    expect(secondRender.queryByText("Starting RobotCloud Desktop")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(secondRender.getByTestId("mock-xterm")).toHaveTextContent("output while hidden");
    });
    expect(secondRender.getByTestId("mock-xterm")).toHaveTextContent("first output");
    expect(terminalStart).toHaveBeenCalledTimes(1);
    expect(terminalStop).not.toHaveBeenCalled();
  });

  it("reconnects to the existing desktop terminal session after a full frontend reload", async () => {
    const terminalCurrent = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        sessionId: "session-1",
        shell: "/bin/zsh",
        replay: "output kept by desktop\n"
      });
    const { terminalStart, terminalStop } = installDesktopBridge({ terminalCurrent });

    const firstRender = render(<SO101Client />);

    await waitFor(() => {
      expect(firstRender.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });
    firstRender.unmount();

    so101TestExports.resetPersistentTerminalForTest();
    const secondRender = render(<SO101Client />);

    await waitFor(() => {
      expect(secondRender.getByTestId("mock-xterm")).toHaveTextContent("output kept by desktop");
    });
    expect(terminalCurrent).toHaveBeenCalledTimes(2);
    expect(terminalStart).toHaveBeenCalledTimes(1);
    expect(terminalStop).not.toHaveBeenCalled();
  });

  it("refreshes desktop status after preparing the runtime", async () => {
    const status = jest.fn()
      .mockResolvedValueOnce({
        ...desktopStatus,
        runtimeReady: false,
        runtimeError: "runtime is still preparing"
      })
      .mockResolvedValue(desktopStatus);
    const runtimePrepare = jest.fn().mockResolvedValue({ runtimePath: "/runtime", ready: true });
    const { terminalStart } = installDesktopBridge({
      status,
      runtime: {
        prepare: runtimePrepare,
        onProgress: jest.fn(() => jest.fn())
      }
    });

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });
    await waitFor(() => {
      expect(status.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(runtimePrepare).toHaveBeenCalledTimes(1);
    expect(status.mock.invocationCallOrder.some((order) => order > runtimePrepare.mock.invocationCallOrder[0])).toBe(true);
    expect(terminalStart).toHaveBeenCalledTimes(1);
  });

  it("shows app version metadata in one card without legacy action or cloud API status cards", async () => {
    installDesktopBridge({
      status: jest.fn().mockResolvedValue({
        ...desktopStatus,
        appVersion: "0.2.0",
        appBuildCommit: "abc1234",
        appBuildTime: "2026-07-08T01:02:03Z",
        lerobotVersion: "0.6.0"
      })
    });

    const view = render(<SO101Client />);

    const buildInfo = await view.findByRole("region", { name: "SO101 app version information" });
    await waitFor(() => {
      expect(buildInfo).toHaveTextContent("Version");
      expect(buildInfo).toHaveTextContent("Built-in LeRobot");
      expect(buildInfo).toHaveTextContent("0.6.0");
      expect(buildInfo).toHaveTextContent("App version");
      expect(buildInfo).toHaveTextContent("0.2.0");
      expect(buildInfo).toHaveTextContent("Build commit");
      expect(buildInfo).toHaveTextContent("abc1234");
      expect(buildInfo).toHaveTextContent("Build time");
      expect(buildInfo).toHaveTextContent("2026-07-08T01:02:03Z");
    });
    expect(view.queryByText(/Action commands/i)).not.toBeInTheDocument();
    expect(view.queryByText(/Cloud API/i)).not.toBeInTheDocument();
  });

  it("shows an icon-only runtime update button when the bundled env is newer", async () => {
    const updateAvailableStatus: DesktopStatus = {
      ...desktopStatus,
      lerobotVersion: "0.5.0",
      bundledLerobotVersion: "0.6.0",
      lerobotUpdateAvailable: true,
      runtimeArchivePath: "/runtime/lerobot-env-macos.zip",
      runtimeArchiveReady: true
    };
    let currentStatus = updateAvailableStatus;
    const status = jest.fn().mockImplementation(() => Promise.resolve(currentStatus));
    const runtimePrepare = jest.fn().mockResolvedValue({ runtimePath: "/runtime", ready: true });
    const runtimeUpdate = jest.fn().mockResolvedValue({ runtimePath: "/runtime", ready: true });
    let progressCallback: ((event: RuntimeProgressEvent) => void) | null = null;

    const { terminalWrite } = installDesktopBridge({
      status,
      runtime: {
        prepare: runtimePrepare,
        update: runtimeUpdate,
        onProgress: jest.fn((callback: (event: RuntimeProgressEvent) => void) => {
          progressCallback = callback;
          return jest.fn();
        })
      }
    });
    terminalWrite.mockImplementation((_sessionId: string, data: string) => {
      if (data.includes(so101TestExports.RUNTIME_UPDATE_COMMAND)) {
        currentStatus = {
          ...updateAvailableStatus,
          lerobotVersion: "0.6.0",
          lerobotUpdateAvailable: false
        };
      }
      return Promise.resolve({ ok: true });
    });

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });
    const updateButton = await view.findByRole("button", { name: "Update LeRobot runtime" });
    expect(updateButton).toHaveTextContent("");

    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenCalledWith(
        "session-1",
        `${so101TestExports.CLEAR_CURRENT_TERMINAL_INPUT}${so101TestExports.RUNTIME_UPDATE_COMMAND}\r`
      );
    });
    expect(runtimeUpdate).not.toHaveBeenCalled();

    act(() => {
      progressCallback?.({
        phase: "ready",
        message: "LeRobot runtime is ready.",
        current: null,
        total: null
      });
    });
    await waitFor(() => {
      expect(view.queryByRole("button", { name: "Update LeRobot runtime" })).not.toBeInTheDocument();
    });
  });

  it("localizes the LeRobot recorder mode label", async () => {
    useLocaleStore.getState().setLocale("zh");
    installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });
    expect(view.getByRole("checkbox", { name: /使用 LeRobot 原版录制工具/ })).toBeInTheDocument();
  });

  it("shows runtime preparation commands while waiting", async () => {
    let progressCallback: ((event: RuntimeProgressEvent) => void) | null = null;
    let resolvePrepare: ((value: RuntimePrepared) => void) | null = null;
    const runtimePrepare = jest.fn(() => new Promise<RuntimePrepared>((resolve) => {
      resolvePrepare = resolve;
      progressCallback?.({
        phase: "validating",
        message: "Preparing LeRobot runtime: checking required Python modules...",
        command: "/runtime/bin/python -c 'import datasets, deepdiff, lerobot, rerun, serial, scservo_sdk'",
        stream: "stdout",
        output: "runtime import check ok\n",
        current: null,
        total: null
      });
    }));
    installDesktopBridge({
      runtime: {
        prepare: runtimePrepare,
        onProgress: jest.fn((callback) => {
          progressCallback = callback;
          return jest.fn();
        })
      }
    });

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByText("Preparing LeRobot runtime: checking required Python modules...")).toBeInTheDocument();
    });
    expect(view.container).toHaveTextContent("$ /runtime/bin/python -c 'import datasets, deepdiff, lerobot, rerun, serial, scservo_sdk'");
    expect(view.container).toHaveTextContent("[stdout]");
    expect(view.container).toHaveTextContent("runtime import check ok");
    expect(view.queryByTestId("mock-xterm")).not.toBeInTheDocument();

    await act(async () => {
      resolvePrepare?.({ runtimePath: "/runtime", ready: true });
    });
    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });
    expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud runtime preparation log:");
    expect(view.getByTestId("mock-xterm")).toHaveTextContent("$ /runtime/bin/python -c 'import datasets, deepdiff, lerobot, rerun, serial, scservo_sdk'");
    expect(view.getByTestId("mock-xterm")).toHaveTextContent("runtime import check ok");
  });

  it("shows runtime preparation failure details", async () => {
    const runtimePrepare = jest.fn().mockRejectedValue(new Error("LeRobot runtime archive not found for macos"));
    const { terminalStart } = installDesktopBridge({
      runtime: {
        prepare: runtimePrepare,
        onProgress: jest.fn(() => jest.fn())
      }
    });

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByText("LeRobot runtime preparation failed")).toBeInTheDocument();
    });
    expect(view.getAllByText("LeRobot runtime archive not found for macos").length).toBeGreaterThan(0);
    expect(terminalStart).not.toHaveBeenCalled();
  });

  it("inserts action commands without submitting them", async () => {
    const { terminalWrite } = installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    expect(view.getByRole("button", { name: "Toggle actions" })).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(view.getByRole("button", { name: "Info" }));

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenCalledWith("session-1", `${so101TestExports.CLEAR_CURRENT_TERMINAL_INPUT}python -m lerobot.scripts.lerobot_info`);
    });
    expect(terminalWrite).not.toHaveBeenCalledWith("session-1", "lerobot-info\r");
  });

  it("shows and focuses missing configuration before running an action", async () => {
    const { terminalWrite } = installDesktopBridge();
    const scrollIntoView = jest.fn();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    const originalRequestAnimationFrame = window.requestAnimationFrame;

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    jest.useFakeTimers();
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    try {
      fireEvent.click(view.getByRole("button", { name: "Setup follower" }));

      const input = view.getByLabelText("Follower port");

      await waitFor(() => {
        expect(view.getByRole("alert")).toHaveTextContent("先配置 Follower port");
      });
      expect(input).toHaveFocus();
      expect(input).toHaveClass("border-red-500");
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", inline: "nearest" });
      expect(terminalWrite).not.toHaveBeenCalled();

      act(() => {
        jest.advanceTimersByTime(3000);
      });

      expect(input).not.toHaveClass("border-red-500");

      fireEvent.change(input, { target: { value: "/dev/cu.usbmodem-follower" } });
      expect(view.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      jest.useRealTimers();
      if (originalScrollIntoView) {
        Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView
        });
      } else {
        Reflect.deleteProperty(window.HTMLElement.prototype, "scrollIntoView");
      }
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  it("keeps the selected action command synced with configuration changes", async () => {
    const { terminalWrite } = installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.click(view.getByRole("button", { name: "Setup follower" }));

    expect(terminalWrite).not.toHaveBeenCalled();

    fireEvent.change(view.getByLabelText("Follower port"), { target: { value: "/dev/cu.usbmodem-follower" } });

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenCalledWith(
        "session-1",
        `${so101TestExports.CLEAR_CURRENT_TERMINAL_INPUT}python -m lerobot.scripts.lerobot_setup_motors --robot.type=so101_follower --robot.port='/dev/cu.usbmodem-follower' --robot.id='so101_follower'`
      );
    });

    fireEvent.change(view.getByLabelText("Robot ID"), { target: { value: "robot-sync" } });

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenLastCalledWith(
        "session-1",
        `${so101TestExports.CLEAR_CURRENT_TERMINAL_INPUT}python -m lerobot.scripts.lerobot_setup_motors --robot.type=so101_follower --robot.port='/dev/cu.usbmodem-follower' --robot.id='robot-sync'`
      );
    });
  });

  it("keeps focus in numeric config inputs while syncing and saving the latest command", async () => {
    const { terminalWrite } = installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.change(view.getByLabelText("Follower port"), { target: { value: "/dev/cu.usbmodem-follower" } });
    fireEvent.change(view.getByLabelText("Leader port"), { target: { value: "/dev/cu.usbmodem-leader" } });
    fireEvent.change(view.getByLabelText("Task label"), { target: { value: "Pick the cube" } });

    fireEvent.click(view.getByRole("button", { name: "Record" }));

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenCalledWith(
        "session-1",
        expect.stringContaining("--dataset.num_episodes=50")
      );
    });

    const episodesInput = view.getByLabelText("Episodes");
    episodesInput.focus();
    expect(episodesInput).toHaveFocus();

    fireEvent.change(episodesInput, { target: { value: "7" } });

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenLastCalledWith(
        "session-1",
        expect.stringContaining("--dataset.num_episodes=7")
      );
    });
    expect(episodesInput).toHaveFocus();

    await waitFor(() => {
      expect(so101TestExports.parseConnectionSettings(window.localStorage.getItem("robotcloud-so101-connection"))?.episodes).toBe(7);
    });
  });

  it("runs auto record without requiring a saved pose first", async () => {
    const { terminalWrite } = installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    // Switch the record card to the RobotCloud auto recorder (uncheck the lerobot option).
    fireEvent.click(view.getByRole("checkbox", { name: /original LeRobot recorder/ }));
    fireEvent.change(view.getByLabelText("Follower port"), { target: { value: "/dev/cu.usbmodem-follower" } });
    fireEvent.change(view.getByLabelText("Leader port"), { target: { value: "/dev/cu.usbmodem-leader" } });
    fireEvent.change(view.getByLabelText("Task label"), { target: { value: "Pick the cube" } });

    fireEvent.click(view.getByRole("button", { name: "Record" }));

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenCalledWith(
        "session-1",
        expect.stringContaining("python '/script/robotcloud_auto_record.py'")
      );
    });
    expect(terminalWrite).toHaveBeenLastCalledWith(
      "session-1",
      expect.stringContaining("--min_episode_time_s=2")
    );
    expect(terminalWrite).toHaveBeenLastCalledWith(
      "session-1",
      expect.stringContaining("--stationary_hold_time_s=2")
    );
    expect(view.queryByText(/请先运行/)).not.toBeInTheDocument();
    expect(view.getByRole("button", { name: "Save pose" })).toBeInTheDocument();
  });

  it("places the add camera control after the camera cards", async () => {
    installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    const camerasSection = view.getByRole("heading", { name: "Cameras" }).closest("section");
    expect(camerasSection).not.toBeNull();

    const cameraLabel = within(camerasSection as HTMLElement).getByText("Camera 0");
    const addCameraButton = within(camerasSection as HTMLElement).getByRole("button", { name: "Add camera" });
    const cameraSectionControls = within(camerasSection as HTMLElement);
    const cameraCard = cameraLabel.closest(".rounded-md") as HTMLElement;
    const cameraControls = within(cameraCard);

    expect(cameraLabel.compareDocumentPosition(addCameraButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cameraControls.getByLabelText("Name")).toHaveValue("front");
    expect(
      cameraControls.getByLabelText("Name").compareDocumentPosition(cameraControls.getByLabelText("Camera id/path")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(cameraSectionControls.getByLabelText("Width")).toHaveAttribute("type", "text");
    expect(cameraSectionControls.getByLabelText("Width")).toHaveValue("640");
    expect(cameraSectionControls.getByLabelText("Height")).toHaveValue("480");
    expect(cameraSectionControls.getByLabelText("FPS")).toHaveValue("30");
  });

  it("uses a right panel line navigation to jump between cards", async () => {
    installDesktopBridge();
    const scrollIntoView = jest.fn();
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView
    });

    try {
      const view = render(<SO101Client />);

      await waitFor(() => {
        expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
      });

      const panelNav = view.getByRole("navigation", { name: "SO101 panel sections" });
      expect(within(panelNav).getByRole("button", { name: "Show Commands card" })).toBeInTheDocument();
      fireEvent.click(within(panelNav).getByRole("button", { name: "Show Cameras card" }));

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start", inline: "nearest" });
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
          configurable: true,
          value: originalScrollIntoView
        });
      } else {
        Reflect.deleteProperty(window.HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  it("writes an infer action command from the current cards", async () => {
    const { terminalWrite } = installDesktopBridge();
    jest.spyOn(robotCloudApi, "fetchInferenceJobs").mockResolvedValue([
      {
        id: 14,
        datasetId: null,
        modelId: 14,
        status: "running",
        serverHost: "h20.conductor-ai.top",
        serverPort: 5161,
        checkpointPath: "backend/storage/train_runs/task_14/checkpoints/last/pretrained_model",
        createdAt: "2026-07-09T00:00:00Z",
        startedAt: "2026-07-09T00:00:01Z"
      }
    ]);

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.change(view.getByLabelText("Follower port"), { target: { value: "/dev/tty.usbmodem58FA1019921" } });
    fireEvent.change(view.getByLabelText("Task label"), { target: { value: "Put dice into the cup." } });
    fireEvent.click(view.getByRole("button", { name: "Add camera" }));

    fireEvent.click(view.getByRole("button", { name: "Infer" }));

    await waitFor(() => {
      expect(robotCloudApi.fetchInferenceJobs).toHaveBeenCalled();
      expect(terminalWrite).toHaveBeenCalledWith(
        "session-1",
        expect.stringContaining("python -m lerobot.async_inference.robot_client")
      );
    });
    expect(terminalWrite).toHaveBeenLastCalledWith(
      "session-1",
      expect.stringContaining("--server_address='h20.conductor-ai.top:5161'")
    );
    expect(terminalWrite).toHaveBeenLastCalledWith(
      "session-1",
      expect.stringContaining("--robot.port='/dev/tty.usbmodem58FA1019921'")
    );
    expect(terminalWrite).toHaveBeenLastCalledWith(
      "session-1",
      expect.stringContaining("--robot.cameras='{ front: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}, side: {type: opencv, index_or_path: 1, width: 640, height: 480, fps: 30} }'")
    );
    expect(terminalWrite).toHaveBeenLastCalledWith(
      "session-1",
      expect.stringContaining("--pretrained_name_or_path='backend/storage/train_runs/task_14/checkpoints/last/pretrained_model'")
    );
    expect(terminalWrite).toHaveBeenLastCalledWith(
      "session-1",
      expect.stringContaining("--policy_device='cuda'")
    );
    expect(terminalWrite).toHaveBeenLastCalledWith(
      "session-1",
      expect.stringContaining("--actions_per_chunk=50 --chunk_size_threshold=0.5 --aggregate_fn_name='weighted_average' --debug_visualize_queue_size=True")
    );
  });

  it("blocks infer action until an inference job is running", async () => {
    const { terminalWrite } = installDesktopBridge();
    jest.spyOn(robotCloudApi, "fetchInferenceJobs").mockResolvedValue([
      {
        id: 15,
        datasetId: null,
        modelId: 15,
        status: "queued",
        createdAt: "2026-07-09T00:00:00Z"
      }
    ]);

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.change(view.getByLabelText("Follower port"), { target: { value: "/dev/tty.usbmodem58FA1019921" } });
    fireEvent.change(view.getByLabelText("Task label"), { target: { value: "Put dice into the cup." } });
    fireEvent.click(view.getByRole("button", { name: "Infer" }));

    await waitFor(() => {
      expect(view.getByText(/Inference job #15 当前是 queued/)).toBeInTheDocument();
    });
    expect(terminalWrite).not.toHaveBeenCalledWith(
      "session-1",
      expect.stringContaining("lerobot.async_inference.robot_client")
    );
  });

  it("shows direct lerobot-record parameters without an alternate script flow", async () => {
    installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    expect(view.queryByRole("button", { name: "Auto record" })).not.toBeInTheDocument();

    const recordSection = view.getByRole("heading", { name: "Record" }).closest("section");
    expect(recordSection).not.toBeNull();
    const recordControls = within(recordSection as HTMLElement);

    expect(recordControls.queryByLabelText("Use LeRobot original collection flow")).not.toBeInTheDocument();
    expect(recordControls.getByLabelText("Episode seconds")).toBeInTheDocument();
    expect(recordControls.getByLabelText("Reset seconds")).toBeInTheDocument();
    expect(recordControls.queryByLabelText("Max relative target")).not.toBeInTheDocument();
    expect(recordControls.getByLabelText("Episodes")).toHaveAttribute("type", "text");
    expect(recordControls.getByLabelText("Episode seconds")).toHaveAttribute("type", "text");
    expect(recordControls.getByLabelText("Reset seconds")).toHaveAttribute("type", "text");
    expect(recordControls.getByLabelText("Episodes")).toHaveValue("50");
    expect(recordControls.getByRole("checkbox", { name: /original LeRobot recorder/ })).toBeChecked();
    expect(recordControls.queryByLabelText("Min episode seconds")).not.toBeInTheDocument();
    expect(recordControls.queryByLabelText("Max episode seconds")).not.toBeInTheDocument();
    expect(recordControls.queryByLabelText("Stationary action seconds")).not.toBeInTheDocument();
  });

  it("restores persisted record card settings from local storage", async () => {
    installDesktopBridge();
    window.localStorage.setItem(
      "robotcloud-so101-connection",
      so101TestExports.serializeConnectionSettings(
        {
          ...so101TestExports.initialForm,
          datasetRepoId: "local/persisted",
          datasetRoot: "/tmp/persisted dataset",
          episodes: 4,
          episodeTimeS: 12,
          minEpisodeTimeS: 4,
          maxEpisodeTimeS: 45,
          stationaryHoldTimeS: 5,
          resetTimeS: 3,
          task: "Pick persisted cube",
          useLerobotRecorder: false,
          displayData: false
        },
        1
      )
    );

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    const recordSection = view.getByRole("heading", { name: "Record" }).closest("section");
    expect(recordSection).not.toBeNull();
    const recordControls = within(recordSection as HTMLElement);

    await waitFor(() => {
      expect(recordControls.getByLabelText("Dataset repo id")).toHaveValue("local/persisted");
    });
    expect(recordControls.getByLabelText("Dataset root")).toHaveValue("/tmp/persisted dataset");
    expect(recordControls.getByLabelText("Episodes")).toHaveValue("4");
    expect(recordControls.getByLabelText("Min episode seconds")).toHaveValue("4");
    expect(recordControls.getByLabelText("Max episode seconds")).toHaveValue("45");
    expect(recordControls.getByLabelText("Stationary action seconds")).toHaveValue("5");
    expect(recordControls.queryByLabelText("Max relative target")).not.toBeInTheDocument();
    expect(recordControls.getByLabelText("Task label")).toHaveValue("Pick persisted cube");
    expect(recordControls.getByRole("checkbox", { name: /Display LeRobot data windows/ })).not.toBeChecked();

    const lerobotRecorder = recordControls.getByRole("checkbox", { name: /original LeRobot recorder/ });
    expect(lerobotRecorder).not.toBeChecked();

    fireEvent.click(lerobotRecorder);
    expect(recordControls.getByLabelText("Episode seconds")).toHaveValue("12");
    expect(recordControls.getByLabelText("Reset seconds")).toHaveValue("3");
  });

  it("restores SO101 settings from the desktop bridge and saves updates back to it", async () => {
    const persistedSettings = so101TestExports.serializeConnectionSettings(
      {
        ...so101TestExports.initialForm,
        followerPort: "/dev/persisted-follower",
        leaderPort: "/dev/persisted-leader",
        datasetRepoId: "local/desktop-persisted",
        episodes: 6,
        task: "Persist across desktop navigation",
        inferServerAddress: "custom-h20:5161",
        inferPolicyType: "pi0fast",
        inferPolicyDevice: "mps",
        inferPretrainedNameOrPath: "/models/custom",
        inferActionsPerChunk: "25",
        inferChunkSizeThreshold: "0.25",
        inferAggregateFnName: "mean"
      },
      1
    );
    const { getSettings, setSettings } = installDesktopBridge({ so101Settings: persistedSettings });

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByLabelText("Follower port")).toHaveValue("/dev/persisted-follower");
    });
    expect(getSettings).toHaveBeenCalled();
    expect(view.getByLabelText("Leader port")).toHaveValue("/dev/persisted-leader");
    expect(view.getByLabelText("Dataset repo id")).toHaveValue("local/desktop-persisted");
    expect(view.getByLabelText("Episodes")).toHaveValue("6");
    expect(view.getByLabelText("server_address")).toHaveValue("custom-h20:5161");
    expect(view.getByLabelText("policy_type")).toHaveValue("pi0fast");
    expect(view.getByLabelText("policy_device")).toHaveValue("mps");
    expect(view.getByLabelText("pretrained_name_or_path")).toHaveValue("/models/custom");
    expect(view.getByLabelText("actions_per_chunk")).toHaveValue("25");
    expect(view.getByLabelText("chunk_size_threshold")).toHaveValue("0.25");
    expect(view.getByLabelText("aggregate_fn_name")).toHaveValue("mean");

    fireEvent.change(view.getByLabelText("Episodes"), { target: { value: "9" } });

    await waitFor(() => {
      const savedRaw = setSettings.mock.calls[setSettings.mock.calls.length - 1]?.[0];
      expect(so101TestExports.parseConnectionSettings(savedRaw)?.episodes).toBe(9);
    });
  });

  it("can start a new terminal after the previous session exits", async () => {
    const { terminalStart, terminalStop, emitExit } = installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    act(() => {
      emitExit();
    });

    expect(view.getByText("Closed")).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "New terminal" }));

    await waitFor(() => {
      expect(terminalStart).toHaveBeenCalledTimes(2);
    });
    expect(terminalStop).not.toHaveBeenCalled();
  });

  it("validates a filled camera profile without overwriting camera fields", async () => {
    const { validateCamera } = installDesktopBridge();
    validateCamera.mockResolvedValue({
      ok: true,
      message: "Camera is available: 0 (1280x720 @ 60 fps)",
      width: 1280,
      height: 720,
      fps: 60
    });

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    const checkButton = view
      .getAllByRole("button", { name: "Check" })
      .find((button) => !button.hasAttribute("disabled"));
    expect(checkButton).toBeDefined();
    fireEvent.click(checkButton as HTMLElement);

    await waitFor(() => {
      expect(validateCamera).toHaveBeenCalledWith("0", 640, 480, 30);
    });
    expect(view.getByLabelText("Width")).toHaveValue("640");
    expect(view.getByLabelText("Height")).toHaveValue("480");
    expect(view.getByLabelText("FPS")).toHaveValue("30");
  });

  it("fills blank camera dimensions from a successful camera check", async () => {
    const { validateCamera } = installDesktopBridge();
    validateCamera.mockResolvedValue({
      ok: true,
      message: "Camera is available: 0 (1280x720 @ 60 fps)",
      width: 1280,
      height: 720,
      fps: 60
    });

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.change(view.getByLabelText("Width"), { target: { value: "" } });
    fireEvent.change(view.getByLabelText("Height"), { target: { value: "" } });

    const checkButton = view
      .getAllByRole("button", { name: "Check" })
      .find((button) => !button.hasAttribute("disabled"));
    expect(checkButton).toBeDefined();
    fireEvent.click(checkButton as HTMLElement);

    await waitFor(() => {
      expect(validateCamera).toHaveBeenCalledWith("0", 0, 0, 0);
    });
    expect(view.getByLabelText("Width")).toHaveValue("1280");
    expect(view.getByLabelText("Height")).toHaveValue("720");
    expect(view.getByLabelText("FPS")).toHaveValue("30");
  });

  it("runs dataset upload packaging through the terminal card", async () => {
    const { inspectUpload, prepareUpload, setPreparedUpload, terminalWrite, emitPreparedUpload } = installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.click(view.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenCalledWith(
        "session-1",
        `${so101TestExports.CLEAR_CURRENT_TERMINAL_INPUT}${so101TestExports.PREPARE_UPLOAD_COMMAND} '${encodeURIComponent(JSON.stringify({
          datasetRoot: "/tmp/robotcloud data/datasets/local/so101_desktop",
          datasetRepoId: "local/so101_desktop",
          task: ""
        }))}'\r`
      );
    });
    expect(inspectUpload).not.toHaveBeenCalled();
    expect(prepareUpload).not.toHaveBeenCalled();

    act(() => {
      emitPreparedUpload({
        filePath: "/tmp/robotcloud data/prepared_uploads/local_so101_desktop.zip",
        fileName: "local_so101_desktop.zip",
        fileSize: 2048,
        datasetRoot: "/tmp/robotcloud data/datasets/local/so101_desktop",
        name: "local/so101_desktop",
        description: "SO101 Desktop recording",
        visibility: "private",
        createdAt: "1760000000000"
      });
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/datasets?source=so101");
    });
    expect(setPreparedUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "local_so101_desktop.zip",
        name: "local/so101_desktop"
      })
    );
  });

  it("recovers a completed terminal upload after the SO101 page remounts", async () => {
    const {
      getPreparedUpload,
      prepareUpload,
      setPreparedUpload,
      setStoredPreparedUpload,
      terminalWrite
    } = installDesktopBridge();
    const prepared: PreparedDatasetUpload = {
      filePath: "/tmp/robotcloud data/prepared_uploads/local_so101_desktop.zip",
      fileName: "local_so101_desktop.zip",
      fileSize: 2048,
      datasetRoot: "/tmp/robotcloud data/datasets/local/so101_desktop",
      name: "local/so101_desktop",
      description: "SO101 Desktop recording",
      visibility: "private",
      createdAt: "1760000000000"
    };

    const firstView = render(<SO101Client />);

    await waitFor(() => {
      expect(firstView.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });
    fireEvent.click(firstView.getByRole("button", { name: "Upload" }));
    await waitFor(() => {
      expect(terminalWrite).toHaveBeenCalledWith(
        "session-1",
        expect.stringContaining(`${so101TestExports.PREPARE_UPLOAD_COMMAND} `)
      );
    });

    firstView.unmount();
    setStoredPreparedUpload(prepared);
    render(<SO101Client />);

    await waitFor(() => {
      expect(getPreparedUpload).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/datasets?source=so101");
    });
    expect(setPreparedUpload).toHaveBeenCalledWith(expect.objectContaining({
      fileName: "local_so101_desktop.zip",
      name: "local/so101_desktop"
    }));
    expect(prepareUpload).not.toHaveBeenCalled();
  });

  it("shows terminal upload errors without invoking the blocking prepare bridge", async () => {
    const { inspectUpload, prepareUpload, emitPrepareUploadError } = installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.click(view.getByRole("button", { name: "Upload" }));

    act(() => {
      emitPrepareUploadError("Upload blocked: At least 1 recorded episode is required.");
    });

    await waitFor(() => {
      expect(view.getByText("Upload blocked: At least 1 recorded episode is required.")).toBeInTheDocument();
    });
    expect(inspectUpload).not.toHaveBeenCalled();
    expect(prepareUpload).not.toHaveBeenCalled();
  });
});

describe("SO101 command generation", () => {
  const { buildActionCommand, buildPrepareUploadCommand, initialForm, parseConnectionSettings, removeCameraAtIndex, resolvedDatasetRoot, serializeConnectionSettings, shellArg } = so101TestExports;

  const desktopStatus: DesktopStatus = {
    isDesktop: true,
    platform: "macos",
    appVersion: "test",
    apiBaseUrl: "http://127.0.0.1:8000/api/v1",
    webUrl: "http://127.0.0.1:3000/so101/",
    runtimePath: "/runtime",
    runtimeReady: true,
    runtimeArchivePath: null,
    runtimeArchiveReady: false,
    runtimeError: null,
    scriptsDir: "/script",
    scriptReady: true,
    dataDir: "/tmp/robotcloud data"
  };

  it("quotes POSIX shell arguments without allowing command substitution", () => {
    expect(shellArg("local/$(touch /tmp/pwn)'x")).toBe("'local/$(touch /tmp/pwn)'\\''x'");
  });

  it("quotes PowerShell arguments without allowing command substitution", () => {
    expect(shellArg("local/$(touch /tmp/pwn)'x", "powershell")).toBe("'local/$(touch /tmp/pwn)''x'");
  });

  it("builds upload packaging as a terminal control command", () => {
    const command = buildPrepareUploadCommand(
      {
        datasetRoot: "/tmp/robotcloud data/datasets/local/so101",
        datasetRepoId: "local/so101",
        task: "Pick 'the' cube"
      },
      desktopStatus
    );

    const payload = encodeURIComponent(JSON.stringify({
      datasetRoot: "/tmp/robotcloud data/datasets/local/so101",
      datasetRepoId: "local/so101",
      task: "Pick 'the' cube"
    }));
    expect(command).toBe(
      `${so101TestExports.PREPARE_UPLOAD_COMMAND} ${shellArg(payload)}`
    );
  });

  it("resolves default dataset roots with platform-specific path separators", () => {
    expect(
      resolvedDatasetRoot(
        { ...initialForm, datasetRepoId: "local/so101_desktop" },
        { ...desktopStatus, platform: "macos", dataDir: "/tmp/robotcloud data/" }
      )
    ).toBe("/tmp/robotcloud data/datasets/local/so101_desktop");

    expect(
      resolvedDatasetRoot(
        { ...initialForm, datasetRepoId: "local/so101_desktop" },
        {
          ...desktopStatus,
          platform: "windows",
          dataDir: "C:\\Users\\duino\\AppData\\Roaming\\RobotCloud\\so101-data\\"
        }
      )
    ).toBe("C:\\Users\\duino\\AppData\\Roaming\\RobotCloud\\so101-data\\datasets\\local\\so101_desktop");
  });

  it("keeps explicit dataset roots unchanged", () => {
    expect(
      resolvedDatasetRoot(
        { ...initialForm, datasetRoot: "D:\\robot data\\episodes" },
        { ...desktopStatus, platform: "windows" }
      )
    ).toBe("D:\\robot data\\episodes");
  });

  it("builds record commands with escaped user controlled values", () => {
    const command = buildActionCommand(
      "record",
      {
        ...initialForm,
        followerPort: "/dev/cu.usbmodem$(touch /tmp/port)",
        leaderPort: "/dev/cu.usbmodem-leader",
        robotId: "robot'one",
        teleopId: "leader",
        datasetRepoId: "local/$(touch /tmp/repo)",
        task: "Pick 'the' cube $(touch /tmp/task)"
      },
      desktopStatus,
      1
    );

    expect(command).toContain("--robot.port='/dev/cu.usbmodem$(touch /tmp/port)'");
    expect(command).toContain("--robot.id='robot'\\''one'");
    expect(command).toContain("--dataset.repo_id='local/$(touch /tmp/repo)'");
    expect(command).toContain("--dataset.single_task='Pick '\\''the'\\'' cube $(touch /tmp/task)'");
    expect(command).not.toContain('"local/$(touch /tmp/repo)"');
  });

  it("builds default record commands through the lerobot python module", () => {
    const command = buildActionCommand(
      "record",
      {
        ...initialForm,
        followerPort: "/dev/cu.usbmodem-follower",
        leaderPort: "/dev/cu.usbmodem-leader",
        robotId: "robot-one",
        teleopId: "leader-one",
        datasetRepoId: "local/auto_dataset",
        episodeTimeS: 12,
        resetTimeS: 3,
        task: "Pick the cube"
      },
      desktopStatus,
      1
    );

    expect(command).toContain("python -m lerobot.scripts.lerobot_record");
    expect(command).not.toContain("lerobot-record");
    expect(command).not.toContain("bash '/script'");
    expect(command).not.toContain("--action");
    expect(command).toContain("--robot.cameras='{ front: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30} }'");
    expect(command).toContain("--dataset.episode_time_s=12");
    expect(command).toContain("--dataset.reset_time_s=3");
    expect(command).toContain("--dataset.streaming_encoding=true");
  });

  it("builds infer commands through the async robot client module", () => {
    const command = buildActionCommand(
      "infer",
      {
        ...initialForm,
        followerPort: "/dev/tty.usbmodem58FA1019921",
        robotId: "so101_follower",
        task: "Put dice into the cup."
      },
      desktopStatus,
      2
    );

    expect(command).toBe(
      "python -m lerobot.async_inference.robot_client " +
        "--server_address='h20.conductor-ai.top:5161' " +
        "--robot.type=so101_follower --robot.port='/dev/tty.usbmodem58FA1019921' --robot.id='so101_follower' " +
        "--robot.cameras='{ front: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}, side: {type: opencv, index_or_path: 1, width: 640, height: 480, fps: 30} }' " +
        "--task='Put dice into the cup.' --policy_type='pi05' --policy_device='cuda' " +
        "--pretrained_name_or_path='backend/storage/train_runs/task_14/checkpoints/last/pretrained_model' " +
        "--actions_per_chunk=50 --chunk_size_threshold=0.5 --aggregate_fn_name='weighted_average' --debug_visualize_queue_size=True"
    );
  });

  it("normalizes infer server URLs before building robot client commands", () => {
    const command = buildActionCommand(
      "infer",
      {
        ...initialForm,
        followerPort: "/dev/tty.usbmodem58FA1019921",
        inferServerAddress: "https://h20.conductor-ai.top:5162/",
        task: "Put dice into the cup."
      },
      desktopStatus,
      1
    );

    expect(command).toContain("--server_address='h20.conductor-ai.top:5162'");
    expect(command).not.toContain("--server_address='https://");
  });

  it("uses camera names as infer camera keys", () => {
    const command = buildActionCommand(
      "infer",
      {
        ...initialForm,
        followerPort: "/dev/follower",
        task: "Pick",
        cameras: [
          { ...initialForm.cameras[0], name: "base_0_rgb", id: "0" },
          { ...initialForm.cameras[1], name: "left_wrist_0_rgb", id: "1" },
          { ...initialForm.cameras[2], name: "third camera", id: "2" }
        ]
      },
      desktopStatus,
      3
    );

    expect(command).toContain(
      "--robot.cameras='{ base_0_rgb: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30}, left_wrist_0_rgb: {type: opencv, index_or_path: 1, width: 640, height: 480, fps: 30}, \"third camera\": {type: opencv, index_or_path: 2, width: 640, height: 480, fps: 30} }'"
    );
  });

  it("builds find-port commands through the lerobot python module", () => {
    const command = buildActionCommand("find-port", initialForm, desktopStatus, 1);

    expect(command).toBe("python -m lerobot.scripts.lerobot_find_port");
  });

  it("builds a minimal teleop command without camera or visualization args", () => {
    const command = buildActionCommand(
      "teleop",
      {
        ...initialForm,
        followerPort: "/dev/tty.usbmodem58FA1019921",
        leaderPort: "/dev/tty.usbmodem5AAF2179591",
        robotId: "so101_follower",
        teleopId: "so101_leader"
      },
      desktopStatus,
      1
    );

    expect(command).toBe(
      "python -m lerobot.scripts.lerobot_teleoperate " +
        "--robot.type=so101_follower --robot.port='/dev/tty.usbmodem58FA1019921' --robot.id='so101_follower' " +
        "--teleop.type=so101_leader --teleop.port='/dev/tty.usbmodem5AAF2179591' --teleop.id='so101_leader'"
    );
    expect(command).not.toContain("--robot.cameras");
    expect(command).not.toContain("--robot.max_relative_target");
    expect(command).not.toContain("--fps");
    expect(command).not.toContain("--display_data");
  });

  it("builds a save pose command from the bundled script path", () => {
    const status: DesktopStatus = { ...desktopStatus, scriptsDir: "/opt/app/resources/scripts" };
    const command = buildActionCommand(
      "save-pose",
      {
        ...initialForm,
        followerPort: "/dev/f",
        leaderPort: "/dev/l",
        robotId: "so101_follower",
        teleopId: "so101_leader"
      },
      status,
      1
    );

    expect(command).toBe(
      "python '/opt/app/resources/scripts/robotcloud_save_pose.py' " +
        "--robot.type=so101_follower --robot.port='/dev/f' --robot.id='so101_follower' " +
        "--teleop.type=so101_leader --teleop.port='/dev/l' --teleop.id='so101_leader' --fps=30"
    );
  });

  it("builds an auto-record command via robotcloud_auto_record.py when the lerobot recorder is off", () => {
    const status: DesktopStatus = { ...desktopStatus, scriptsDir: "/opt/app/resources/scripts" };
    const command = buildActionCommand(
      "record",
      {
        ...initialForm,
        useLerobotRecorder: false,
        followerPort: "/dev/f",
        leaderPort: "/dev/l",
        datasetRepoId: "local/auto",
        task: "Pick",
        minEpisodeTimeS: 3,
        maxEpisodeTimeS: 45,
        stationaryHoldTimeS: 6
      },
      status,
      1
    );

    expect(command).toContain("python '/opt/app/resources/scripts/robotcloud_auto_record.py'");
    expect(command).toContain("--min_episode_time_s=3");
    expect(command).toContain("--max_episode_time_s=45");
    expect(command).toContain("--stationary_hold_time_s=6");
    expect(command).toContain("--robot.cameras=");
    expect(command).not.toContain("--dataset.episode_time_s");
    expect(command).not.toContain("--dataset.reset_time_s");
    expect(command).not.toContain("lerobot");
  });

  it("builds Windows LeRobot actions through python modules", () => {
    const windowsStatus: DesktopStatus = {
      ...desktopStatus,
      platform: "windows",
      dataDir: "C:\\Users\\duino\\AppData\\Roaming\\RobotCloud\\so101-data"
    };

    expect(buildActionCommand("info", initialForm, windowsStatus, 1)).toBe(
      "python -m lerobot.scripts.lerobot_info"
    );
    expect(buildActionCommand("find-port", initialForm, windowsStatus, 1)).toBe(
      "python -m lerobot.scripts.lerobot_find_port"
    );

    const recordCommand = buildActionCommand(
      "record",
      {
        ...initialForm,
        followerPort: "COM3",
        leaderPort: "COM4",
        datasetRepoId: "local/auto_dataset",
        task: "Pick the cube"
      },
      windowsStatus,
      1
    );

    expect(recordCommand).toContain("python -m lerobot.scripts.lerobot_record");
    expect(recordCommand).toContain("--robot.port='COM3'");
    expect(recordCommand).toContain("--dataset.root='C:\\Users\\duino\\AppData\\Roaming\\RobotCloud\\so101-data\\datasets\\local\\auto_dataset'");
    expect(recordCommand).not.toContain("lerobot-record");
    expect(recordCommand).not.toContain(".exe");
  });

  it("rejects invalid record numbers before writing a command", () => {
    expect(() =>
      buildActionCommand(
        "record",
        {
          ...initialForm,
          followerPort: "/dev/cu.usbmodem-follower",
          leaderPort: "/dev/cu.usbmodem-leader",
          episodes: 0
        },
        desktopStatus,
        1
      )
    ).toThrow("先配置 Episodes");

    expect(() =>
      buildActionCommand(
        "record",
        {
          ...initialForm,
          followerPort: "/dev/cu.usbmodem-follower",
          leaderPort: "/dev/cu.usbmodem-leader",
          episodeTimeS: Number.NaN
        },
        desktopStatus,
        1
      )
    ).toThrow("先配置 Episode seconds");

    expect(() =>
      buildActionCommand(
        "record",
        {
          ...initialForm,
          followerPort: "/dev/cu.usbmodem-follower",
          leaderPort: "/dev/cu.usbmodem-leader",
          task: "Pick",
          resetTimeS: -1
        },
        desktopStatus,
        1
      )
    ).toThrow("先配置 Reset seconds");

    expect(() =>
      buildActionCommand(
        "record",
        {
          ...initialForm,
          useLerobotRecorder: false,
          followerPort: "/dev/cu.usbmodem-follower",
          leaderPort: "/dev/cu.usbmodem-leader",
          task: "Pick",
          stationaryHoldTimeS: 0
        },
        desktopStatus,
        1
      )
    ).toThrow("先配置 Stationary action seconds");
  });

  it("normalizes saved connection settings from local storage payloads", () => {
    const saved = parseConnectionSettings(
      JSON.stringify({
        followerPort: "/dev/follower",
        leaderPort: "/dev/leader",
        robotId: "robot-a",
        teleopId: "leader-a",
        cameraCount: 99,
        cameras: [{ id: "2", width: 800, height: 600, fps: 15 }]
      })
    );

    expect(saved).toMatchObject({
      followerPort: "/dev/follower",
      leaderPort: "/dev/leader",
      robotId: "robot-a",
      teleopId: "leader-a",
      cameraCount: 3
    });
    expect(saved?.cameras[0]).toMatchObject({ id: "2", width: 800, height: 600, fps: 15 });
    expect(saved?.cameras[0]).toMatchObject({ name: "front" });
    expect(saved?.cameras[1]).toMatchObject({ name: "side", id: "1", width: 640, height: 480, fps: 30 });
    expect(saved?.cameras[2]).toMatchObject({ name: "wrist", id: "2", width: 640, height: 480, fps: 30 });
  });

  it("migrates legacy and incorrect saved defaults to the current SO101 defaults", () => {
    const saved = parseConnectionSettings(
      JSON.stringify({
        episodes: 1,
        cameras: [
          { id: "0", width: 480, height: 640, fps: 30 },
          { id: "custom", width: 800, height: 600, fps: 15 }
        ]
      })
    );

    expect(saved).toMatchObject({
      episodes: 50,
      cameras: [
        { name: "front", id: "0", width: 640, height: 480, fps: 30 },
        { name: "side", id: "custom", width: 800, height: 600, fps: 15 },
        { name: "wrist", id: "2", width: 640, height: 480, fps: 30 }
      ]
    });
  });

  it("normalizes persisted infer server URLs", () => {
    const serialized = serializeConnectionSettings(
      {
        ...initialForm,
        inferServerAddress: "https://h20.conductor-ai.top:5162/"
      },
      1
    );

    expect(JSON.parse(serialized).inferServerAddress).toBe("h20.conductor-ai.top:5162");
    expect(
      parseConnectionSettings(JSON.stringify({ inferServerAddress: "https://h20.conductor-ai.top:5162/" }))
        ?.inferServerAddress
    ).toBe("h20.conductor-ai.top:5162");
  });

  it("normalizes inference job server host URLs", () => {
    expect(
      inferenceJobServerAddress({
        id: 14,
        datasetId: null,
        modelId: 14,
        status: "running",
        serverHost: "https://h20.conductor-ai.top",
        serverPort: 5162,
        createdAt: "2026-07-09T00:00:00Z"
      })
    ).toBe("h20.conductor-ai.top:5162");
    expect(
      inferenceJobServerAddress({
        id: 15,
        datasetId: null,
        modelId: 14,
        status: "running",
        serverHost: "https://h20.conductor-ai.top:5162",
        serverPort: 5161,
        createdAt: "2026-07-09T00:00:00Z"
      })
    ).toBe("h20.conductor-ai.top:5161");
  });

  it("round-trips persisted SO101 settings", () => {
    const serialized = serializeConnectionSettings(
      {
        ...initialForm,
        followerPort: "/dev/follower",
        leaderPort: "/dev/leader",
        robotId: "robot-b",
        teleopId: "leader-b",
        datasetRepoId: "local/persisted",
        datasetRoot: "/tmp/persisted dataset",
        episodes: 4,
        episodeTimeS: 12,
        minEpisodeTimeS: 4,
        maxEpisodeTimeS: 45,
        stationaryHoldTimeS: 5,
        resetTimeS: 3,
        displayData: false,
        useLerobotRecorder: false,
        task: "Pick persisted cube",
        inferServerAddress: "custom-h20:5161",
        inferPolicyType: "pi0fast",
        inferPolicyDevice: "mps",
        inferPretrainedNameOrPath: "/models/custom",
        inferActionsPerChunk: "20",
        inferChunkSizeThreshold: "0.25",
        inferAggregateFnName: "mean",
        cameras: [
          { name: "front", id: "0", width: 1280, height: 720, fps: 30 },
          { name: "side", id: "2", width: 640, height: 480, fps: 15 },
          { name: "wrist", id: "3", width: 320, height: 240, fps: 10 }
        ]
      },
      2
    );

    expect(parseConnectionSettings(serialized)).toMatchObject({
      followerPort: "/dev/follower",
      leaderPort: "/dev/leader",
      robotId: "robot-b",
      teleopId: "leader-b",
      cameraCount: 2,
      datasetRepoId: "local/persisted",
      datasetRoot: "/tmp/persisted dataset",
      episodes: 4,
      episodeTimeS: 12,
      minEpisodeTimeS: 4,
      maxEpisodeTimeS: 45,
      stationaryHoldTimeS: 5,
      resetTimeS: 3,
      displayData: false,
      useLerobotRecorder: false,
      task: "Pick persisted cube",
      inferServerAddress: "custom-h20:5161",
      inferPolicyType: "pi0fast",
      inferPolicyDevice: "mps",
      inferPretrainedNameOrPath: "/models/custom",
      inferActionsPerChunk: "20",
      inferChunkSizeThreshold: "0.25",
      inferAggregateFnName: "mean",
      cameras: [
        { name: "front", id: "0", width: 1280, height: 720, fps: 30 },
        { name: "side", id: "2", width: 640, height: 480, fps: 15 },
        { name: "wrist", id: "3", width: 320, height: 240, fps: 10 }
      ]
    });
  });

  it("removes added camera cards by compacting later camera settings", () => {
    const cameras = [
      { name: "front", id: "0", width: 1280, height: 720, fps: 30 },
      { name: "side", id: "1", width: 640, height: 480, fps: 20 },
      { name: "wrist", id: "2", width: 320, height: 240, fps: 10 }
    ] as typeof initialForm.cameras;

    expect(removeCameraAtIndex(cameras, 1)).toEqual([
      { name: "front", id: "0", width: 1280, height: 720, fps: 30 },
      { name: "wrist", id: "2", width: 320, height: 240, fps: 10 },
      { name: "wrist", id: "2", width: 640, height: 480, fps: 30 }
    ]);
  });
});
