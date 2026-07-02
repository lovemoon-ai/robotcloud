import { fireEvent, render, screen } from "@testing-library/react";
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
});
