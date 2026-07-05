import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppChrome } from "@/components/AppChrome";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";

let mockPathname = "/dashboard";

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn()
  })
}));

function getMobileNav(container: HTMLElement) {
  const nav = container.querySelector("nav.fixed");
  if (!nav) {
    throw new Error("Mobile navigation was not rendered");
  }
  return nav as HTMLElement;
}

function getDesktopNav(container: HTMLElement) {
  const nav = container.querySelector("#robotcloud-sidebar-primary-nav");
  if (!nav) {
    throw new Error("Desktop navigation was not rendered");
  }
  return nav as HTMLElement;
}

describe("AppChrome language toggle", () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useLocaleStore.getState().reset();
    mockPathname = "/dashboard";
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

  it("keeps Plans out of the primary navigation until Settings is active", () => {
    render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    expect(screen.queryAllByRole("link", { name: "Plans" })).toHaveLength(0);
  });

  it("shows Plans as a secondary Settings item", () => {
    mockPathname = "/settings";

    render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    expect(screen.getAllByRole("link", { name: "Plans" })).toHaveLength(1);
  });

  it("does not render active navigation indicator dots", () => {
    const { container } = render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    expect(container.querySelector("#robotcloud-sidebar-primary-nav .bg-theme-primary")).toBeNull();
    expect(container.querySelector('nav[aria-label="Primary navigation"] .bg-theme-primary')).toBeNull();
  });

  it("merges Datasets and Models in the mobile navigation", () => {
    const { container } = render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    const mobileNav = getMobileNav(container);
    expect(within(mobileNav).getAllByRole("link")).toHaveLength(4);
    expect(within(mobileNav).getByRole("link", { name: "Datasets" })).toHaveAttribute("href", "/datasets");
    expect(within(mobileNav).queryByRole("link", { name: "Models" })).not.toBeInTheDocument();
  });

  it("keeps Datasets, Models, Training, and Inference separate in the desktop navigation", () => {
    const { container } = render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    const desktopNav = getDesktopNav(container);
    expect(within(desktopNav).getByRole("link", { name: "Datasets" })).toHaveAttribute("href", "/datasets");
    expect(within(desktopNav).getByRole("link", { name: "Models" })).toHaveAttribute("href", "/models");
    expect(within(desktopNav).getByRole("link", { name: "Training" })).toHaveAttribute("href", "/train");
    expect(within(desktopNav).getByRole("link", { name: "Inference" })).toHaveAttribute("href", "/inference");
  });

  it("toggles the mobile Datasets item to Models from dataset routes", () => {
    mockPathname = "/datasets";

    const { container } = render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    const mobileNav = getMobileNav(container);
    const datasetsLink = within(mobileNav).getByRole("link", { name: "Switch to Models" });
    expect(datasetsLink).toHaveAttribute("href", "/models");
    expect(datasetsLink).not.toHaveAttribute("aria-current");
    expect(datasetsLink).toHaveAttribute("data-flipped", "false");
  });

  it("flips the mobile Datasets and Models item on model routes", () => {
    mockPathname = "/models";

    const { container } = render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    const mobileNav = getMobileNav(container);
    const modelsLink = within(mobileNav).getByRole("link", { name: "Switch to Datasets" });
    expect(modelsLink).toHaveAttribute("href", "/datasets");
    expect(modelsLink).not.toHaveAttribute("aria-current");
    expect(modelsLink).toHaveAttribute("data-flipped", "true");
    expect(within(mobileNav).queryByRole("link", { name: "Datasets" })).not.toBeInTheDocument();
  });

  it("toggles Training and Inference in the mobile navigation", () => {
    mockPathname = "/train";

    const { container, rerender } = render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    let mobileNav = getMobileNav(container);
    const trainingLink = within(mobileNav).getByRole("link", { name: "Switch to Inference" });
    expect(trainingLink).toHaveAttribute("href", "/inference");
    expect(trainingLink).not.toHaveAttribute("aria-current");
    expect(trainingLink).toHaveAttribute("data-flipped", "false");

    mockPathname = "/inference";
    rerender(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    mobileNav = getMobileNav(container);
    const inferenceLink = within(mobileNav).getByRole("link", { name: "Switch to Training" });
    expect(inferenceLink).toHaveAttribute("href", "/train");
    expect(inferenceLink).not.toHaveAttribute("aria-current");
    expect(inferenceLink).toHaveAttribute("data-flipped", "true");
    expect(within(mobileNav).queryByRole("link", { name: "Training" })).not.toBeInTheDocument();
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
