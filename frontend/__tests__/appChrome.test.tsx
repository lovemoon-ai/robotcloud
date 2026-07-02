import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppChrome } from "@/components/AppChrome";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn()
  })
}));

describe("AppChrome language toggle", () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useLocaleStore.getState().reset();
    delete window.robotcloudDesktop;
    window.localStorage.removeItem("robotcloud-sidebar-collapsed");
    document.documentElement.lang = "en";
  });

  it("switches login text when toggling languages", () => {
    render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "切换到中文" });
    fireEvent.click(toggle);

    expect(screen.getByRole("link", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to English" })).toBeInTheDocument();
  });

  it("collapses and expands the desktop sidebar from the app logo rail", () => {
    const { container } = render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    const sidebar = container.querySelector('[aria-label="Workspace sidebar"]');
    expect(sidebar).toHaveAttribute("data-collapsed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem("robotcloud-sidebar-collapsed")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    expect(window.localStorage.getItem("robotcloud-sidebar-collapsed")).toBe("0");
  });

  it("hides SO101 Desktop navigation in a browser", () => {
    render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    expect(screen.queryAllByRole("link", { name: "SO101 Desktop" })).toHaveLength(0);
  });

  it("shows SO101 Desktop navigation in RobotCloud Desktop", async () => {
    window.robotcloudDesktop = {
      isDesktop: true,
      status: jest.fn().mockResolvedValue({
        isDesktop: true,
        platform: "darwin",
        appVersion: "test",
        apiBaseUrl: "http://127.0.0.1:8000/api/v1",
        webUrl: "http://127.0.0.1:3000/so101/",
        runtimePath: null,
        runtimeReady: false,
        runtimeArchivePath: null,
        runtimeArchiveReady: false,
        scriptPath: null,
        scriptReady: false,
        dataDir: ""
      }),
      so101: {
        run: jest.fn(),
        stop: jest.fn(),
        onOutput: jest.fn(() => jest.fn()),
        onExit: jest.fn(() => jest.fn())
      },
      terminal: {
        start: jest.fn(),
        write: jest.fn(),
        resize: jest.fn(),
        stop: jest.fn(),
        onOutput: jest.fn(() => jest.fn()),
        onExit: jest.fn(() => jest.fn())
      }
    } as unknown as DesktopBridge;

    render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "SO101 Desktop" }).length).toBeGreaterThan(0);
    });
  });

  it("keeps SO101 Desktop navigation after a successful Desktop detection", async () => {
    jest.useFakeTimers();
    try {
      const status = jest.fn().mockResolvedValueOnce({
        isDesktop: true,
        platform: "darwin",
        appVersion: "test",
        apiBaseUrl: "http://127.0.0.1:8000/api/v1",
        webUrl: "http://127.0.0.1:3000/so101/",
        runtimePath: null,
        runtimeReady: false,
        runtimeArchivePath: null,
        runtimeArchiveReady: false,
        scriptPath: null,
        scriptReady: false,
        dataDir: ""
      });

      window.robotcloudDesktop = {
        isDesktop: true,
        status,
        so101: {
          run: jest.fn(),
          stop: jest.fn(),
          onOutput: jest.fn(() => jest.fn()),
          onExit: jest.fn(() => jest.fn())
        },
        terminal: {
          start: jest.fn(),
          write: jest.fn(),
          resize: jest.fn(),
          stop: jest.fn(),
          onOutput: jest.fn(() => jest.fn()),
          onExit: jest.fn(() => jest.fn())
        }
      } as unknown as DesktopBridge;

      render(
        <AppChrome>
          <div>placeholder</div>
        </AppChrome>
      );

      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getAllByRole("link", { name: "SO101 Desktop" }).length).toBeGreaterThan(0);

      await act(async () => {
        jest.advanceTimersByTime(2000);
        await Promise.resolve();
      });

      expect(status).toHaveBeenCalledTimes(1);
      expect(screen.getAllByRole("link", { name: "SO101 Desktop" }).length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
