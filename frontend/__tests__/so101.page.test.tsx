import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import { SO101Client, so101TestExports } from "../app/so101/SO101Client";
import { useAuthStore } from "@/store/useAuthStore";

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("@xterm/xterm", () => ({
  Terminal: class MockTerminal {
    element?: HTMLElement;
    focus = jest.fn();
    resize = jest.fn();
    dispose = jest.fn();

    open(parent: HTMLElement) {
      this.element = document.createElement("div");
      this.element.dataset.testid = "mock-xterm";
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
  so101TestExports.resetPersistentTerminalForTest();
  useAuthStore.getState().reset();
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

  it("redirects unauthenticated users to login before starting SO101 Desktop", async () => {
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
      scriptPath: "/script",
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
    apiBaseUrl: "http://127.0.0.1:8000/api/v1",
    webUrl: "http://127.0.0.1:3000/so101/",
    runtimePath: "/runtime",
    runtimeReady: true,
    runtimeArchivePath: null,
    runtimeArchiveReady: false,
    runtimeError: null,
    scriptPath: "/script",
    scriptReady: true,
    dataDir: "/tmp/robotcloud data"
  };

  function installDesktopBridge() {
    let outputCallback: ((event: TerminalOutputEvent) => void) | null = null;
    let exitCallback: ((event: TerminalExitEvent) => void) | null = null;
    const terminalStart = jest.fn().mockResolvedValue({ sessionId: "session-1", shell: "/bin/zsh" });
    const terminalWrite = jest.fn().mockResolvedValue({ ok: true });
    const terminalStop = jest.fn().mockResolvedValue({ stopped: true });
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
    const bridge: DesktopBridge = {
      isDesktop: true,
      status: jest.fn().mockResolvedValue(desktopStatus),
      so101: {
        run: jest.fn(),
        stop: jest.fn(),
        validatePort: jest.fn(),
        validateCamera,
        previewCamera: jest.fn(),
        onOutput: jest.fn(() => jest.fn()),
        onExit: jest.fn(() => jest.fn())
      },
      dataset: {
        inspectUpload,
        prepareUpload,
        readPreparedUpload: jest.fn()
      },
      terminal: {
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
    window.robotcloudDesktop = bridge;
    return {
      terminalStart,
      terminalWrite,
      terminalStop,
      validateCamera,
      inspectUpload,
      prepareUpload,
      emitOutput: (data: string) => outputCallback?.({ sessionId: "session-1", data }),
      emitExit: () => exitCallback?.({ sessionId: "session-1", code: 0, signal: null })
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

    await waitFor(() => {
      expect(secondRender.getByTestId("mock-xterm")).toHaveTextContent("output while hidden");
    });
    expect(secondRender.getByTestId("mock-xterm")).toHaveTextContent("first output");
    expect(terminalStart).toHaveBeenCalledTimes(1);
    expect(terminalStop).not.toHaveBeenCalled();
  });

  it("inserts action commands without submitting them", async () => {
    const { terminalWrite } = installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.click(view.getByRole("button", { name: "Toggle actions" }));
    fireEvent.click(view.getByRole("button", { name: "Info" }));

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenCalledWith("session-1", `${so101TestExports.CLEAR_CURRENT_TERMINAL_INPUT}lerobot-info`);
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
      fireEvent.click(view.getByRole("button", { name: "Toggle actions" }));
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

    fireEvent.click(view.getByRole("button", { name: "Toggle actions" }));
    fireEvent.click(view.getByRole("button", { name: "Setup follower" }));

    expect(terminalWrite).not.toHaveBeenCalled();

    fireEvent.change(view.getByLabelText("Follower port"), { target: { value: "/dev/cu.usbmodem-follower" } });

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenCalledWith(
        "session-1",
        `${so101TestExports.CLEAR_CURRENT_TERMINAL_INPUT}lerobot-setup-motors --robot.type=so101_follower --robot.port='/dev/cu.usbmodem-follower' --robot.id='so101_follower'`
      );
    });

    fireEvent.change(view.getByLabelText("Robot ID"), { target: { value: "robot-sync" } });

    await waitFor(() => {
      expect(terminalWrite).toHaveBeenLastCalledWith(
        "session-1",
        `${so101TestExports.CLEAR_CURRENT_TERMINAL_INPUT}lerobot-setup-motors --robot.type=so101_follower --robot.port='/dev/cu.usbmodem-follower' --robot.id='robot-sync'`
      );
    });
  });

  it("places the add camera control after the camera cards", async () => {
    installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    const connectionSection = view.getByText("Connection").closest("section");
    expect(connectionSection).not.toBeNull();

    const cameraLabel = within(connectionSection as HTMLElement).getByText("Camera 0");
    const addCameraButton = within(connectionSection as HTMLElement).getByRole("button", { name: "Add camera" });

    expect(cameraLabel.compareDocumentPosition(addCameraButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows direct lerobot-record parameters without an alternate script flow", async () => {
    installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.click(view.getByRole("button", { name: "Toggle actions" }));
    expect(view.queryByRole("button", { name: "Auto record" })).not.toBeInTheDocument();

    const recordSection = view.getByRole("heading", { name: "Record" }).closest("section");
    expect(recordSection).not.toBeNull();
    const recordControls = within(recordSection as HTMLElement);

    expect(recordControls.queryByLabelText("Use LeRobot original collection flow")).not.toBeInTheDocument();
    expect(recordControls.getByLabelText("Episode seconds")).toBeInTheDocument();
    expect(recordControls.getByLabelText("Reset seconds")).toBeInTheDocument();
    expect(recordControls.getByLabelText("Max relative target")).toBeInTheDocument();
    expect(recordControls.queryByLabelText("Min episode seconds")).not.toBeInTheDocument();
    expect(recordControls.queryByLabelText("Max episode seconds")).not.toBeInTheDocument();
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

  it("fills camera width, height, and fps from a successful camera check", async () => {
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
      expect(validateCamera).toHaveBeenCalledWith("0", 0, 0);
    });
    expect(view.getByLabelText("Width")).toHaveValue(1280);
    expect(view.getByLabelText("Height")).toHaveValue(720);
    expect(view.getByLabelText("FPS")).toHaveValue(60);
  });

  it("shows recording stats before preparing an upload", async () => {
    const { inspectUpload, prepareUpload } = installDesktopBridge();

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.click(view.getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(inspectUpload).toHaveBeenCalledWith({
        datasetRoot: "/tmp/robotcloud data/datasets/local/so101_desktop",
        datasetRepoId: "local/so101_desktop"
      });
    });
    expect(prepareUpload).not.toHaveBeenCalled();

    const dialog = view.getByRole("dialog", { name: "Recording upload review" });
    expect(within(dialog).getByText("Episodes")).toBeInTheDocument();
    expect(within(dialog).getByText("Duration")).toBeInTheDocument();
    expect(within(dialog).getByText("10s")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));

    await waitFor(() => {
      expect(prepareUpload).toHaveBeenCalledWith({
        datasetRoot: "/tmp/robotcloud data/datasets/local/so101_desktop",
        datasetRepoId: "local/so101_desktop",
        task: ""
      });
    });
    expect(mockPush).toHaveBeenCalledWith("/datasets?source=so101");
  });

  it("blocks upload when recorded stats do not meet the minimums", async () => {
    const { inspectUpload, prepareUpload } = installDesktopBridge();
    inspectUpload.mockResolvedValue({
      datasetRoot: "/tmp/robotcloud data/datasets/local/so101_desktop",
      fileCount: 2,
      totalBytes: 512,
      episodeCount: 0,
      totalFrames: 10,
      fps: 30,
      durationSeconds: 0.3
    });

    const view = render(<SO101Client />);

    await waitFor(() => {
      expect(view.getByTestId("mock-xterm")).toHaveTextContent("RobotCloud terminal: /bin/zsh");
    });

    fireEvent.click(view.getByRole("button", { name: "Upload" }));

    const dialog = await view.findByRole("dialog", { name: "Recording upload review" });
    expect(within(dialog).getByText("Upload blocked")).toBeInTheDocument();
    expect(within(dialog).getByText("At least 1 recorded episode is required.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Upload" })).toBeDisabled();
    expect(prepareUpload).not.toHaveBeenCalled();
  });
});

describe("SO101 command generation", () => {
  const { buildActionCommand, initialForm, parseConnectionSettings, removeCameraAtIndex, resolvedDatasetRoot, serializeConnectionSettings, shellArg } = so101TestExports;

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
    scriptPath: "/script",
    scriptReady: true,
    dataDir: "/tmp/robotcloud data"
  };

  it("quotes POSIX shell arguments without allowing command substitution", () => {
    expect(shellArg("local/$(touch /tmp/pwn)'x")).toBe("'local/$(touch /tmp/pwn)'\\''x'");
  });

  it("quotes PowerShell arguments without allowing command substitution", () => {
    expect(shellArg("local/$(touch /tmp/pwn)'x", "powershell")).toBe("'local/$(touch /tmp/pwn)''x'");
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

  it("builds default record commands with direct lerobot-record arguments", () => {
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

    expect(command).toContain("lerobot-record");
    expect(command).not.toContain("bash '/script'");
    expect(command).not.toContain("--action");
    expect(command).toContain("--robot.cameras='{ front: {type: opencv, index_or_path: 0, width: 640, height: 480, fps: 30} }'");
    expect(command).toContain("--dataset.episode_time_s=12");
    expect(command).toContain("--dataset.reset_time_s=3");
    expect(command).toContain("--dataset.streaming_encoding=true");
  });

  it("builds find-port commands directly against the lerobot env", () => {
    const command = buildActionCommand("find-port", initialForm, desktopStatus, 1);

    expect(command).toBe("lerobot-find-port");
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
    expect(saved?.cameras[1]).toMatchObject({ id: "1", width: 640, height: 480, fps: 30 });
    expect(saved?.cameras[2]).toMatchObject({ id: "2", width: 640, height: 480, fps: 30 });
  });

  it("round-trips persisted connection settings", () => {
    const serialized = serializeConnectionSettings(
      {
        ...initialForm,
        followerPort: "/dev/follower",
        leaderPort: "/dev/leader",
        robotId: "robot-b",
        teleopId: "leader-b",
        cameras: [
          { id: "0", width: 1280, height: 720, fps: 30 },
          { id: "2", width: 640, height: 480, fps: 15 },
          { id: "3", width: 320, height: 240, fps: 10 }
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
      cameras: [
        { id: "0", width: 1280, height: 720, fps: 30 },
        { id: "2", width: 640, height: 480, fps: 15 },
        { id: "3", width: 320, height: 240, fps: 10 }
      ]
    });
  });

  it("removes added camera cards by compacting later camera settings", () => {
    const cameras = [
      { id: "0", width: 1280, height: 720, fps: 30 },
      { id: "1", width: 640, height: 480, fps: 20 },
      { id: "2", width: 320, height: 240, fps: 10 }
    ] as typeof initialForm.cameras;

    expect(removeCameraAtIndex(cameras, 1)).toEqual([
      { id: "0", width: 1280, height: 720, fps: 30 },
      { id: "2", width: 320, height: 240, fps: 10 },
      { id: "2", width: 640, height: 480, fps: 30 }
    ]);
  });
});
