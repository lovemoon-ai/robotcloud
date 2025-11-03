import { fireEvent, render, screen } from "@testing-library/react";
import { AppChrome } from "@/components/AppChrome";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";

describe("AppChrome language toggle", () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useLocaleStore.getState().reset();
    document.documentElement.lang = "zh";
  });

  it("switches login text when toggling languages", () => {
    render(
      <AppChrome>
        <div>placeholder</div>
      </AppChrome>
    );

    expect(screen.getByRole("link", { name: "登录" })).toBeInTheDocument();

    const toggle = screen.getByRole("switch", { name: "切换到英文界面" });
    fireEvent.click(toggle);

    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Switch to Chinese interface" })).toBeInTheDocument();
  });
});
