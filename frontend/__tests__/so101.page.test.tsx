import { act, render } from "@testing-library/react";
import { SO101Client, so101TestExports } from "../app/so101/SO101Client";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: mockReplace,
    prefetch: jest.fn()
  })
}));

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
