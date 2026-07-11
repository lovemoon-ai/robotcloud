import { render, screen } from "@testing-library/react";
import RobotPage from "../app/robot/page";
import { resetDesktopBridgeAvailabilityForTest } from "@/hooks/useDesktopBridgeAvailable";
import { useLocaleStore } from "@/store/useLocaleStore";

afterEach(() => {
  resetDesktopBridgeAvailabilityForTest();
  useLocaleStore.getState().reset();
});

describe("Robot page", () => {
  it("renders the SO101 launcher", () => {
    render(<RobotPage />);

    expect(screen.getByRole("heading", { name: "Robot" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "SO101" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /SO101/ })).toHaveAttribute("href", "/so101");
  });
});
