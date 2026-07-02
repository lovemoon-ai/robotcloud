import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { SO101Client, so101TestExports } from "../app/so101/SO101Client";

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
    push: jest.fn(),
    replace: mockReplace,
    prefetch: jest.fn()
  })
}));

afterEach(() => {
  so101TestExports.resetPersistentTerminalForTest();
});

describe("SO101 page environment guard", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReplace.mockClear();
    delete window.robotcloudDesktop;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows startup state and redirects away in a browser", async () => {
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
    const terminalStop = jest.fn().mockResolvedValue({ stopped: true });
    const bridge: DesktopBridge = {
      isDesktop: true,
      status: jest.fn().mockResolvedValue(desktopStatus),
      so101: {
        run: jest.fn(),
        stop: jest.fn(),
        validatePort: jest.fn(),
        validateCamera: jest.fn(),
        previewCamera: jest.fn(),
        onOutput: jest.fn(() => jest.fn()),
        onExit: jest.fn(() => jest.fn())
      },
      terminal: {
        start: terminalStart,
        write: jest.fn().mockResolvedValue({ ok: true }),
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
      terminalStop,
      emitOutput: (data: string) => outputCallback?.({ sessionId: "session-1", data }),
      emitExit: () => exitCallback?.({ sessionId: "session-1", code: 0, signal: null })
    };
  }

  beforeEach(() => {
    mockReplace.mockClear();
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
});

describe("SO101 command generation", () => {
  const { buildActionCommand, initialForm, parseConnectionSettings, serializeConnectionSettings, shellArg } = so101TestExports;

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
});
