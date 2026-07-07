import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SettingsPage from "../app/settings/page";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";
import { useThemeStore } from "@/store/useThemeStore";

const replaceMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock
  })
}));

jest.mock("@/api/client", () => ({
  robotCloudApi: {
    fetchBackendVersion: jest.fn(),
    listActiveAgents: jest.fn(),
    getUserSettings: jest.fn(),
    updateDefaultAgent: jest.fn(),
    logout: jest.fn()
  }
}));

const mockedApi = robotCloudApi as jest.Mocked<typeof robotCloudApi>;

function renderSettingsPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

describe("/settings page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.getState().reset();
    useAuthStore.getState().setAuth({
      token: "token",
      userId: 1,
      phone: "13800000001",
      role: "free",
      expireAt: null
    });
    useLocaleStore.getState().reset();
    useThemeStore.getState().setTheme("dark");
    mockedApi.listActiveAgents.mockResolvedValue({
      items: [],
      defaultAgentNode: ""
    });
    mockedApi.getUserSettings.mockResolvedValue({
      defaultAgentNode: ""
    });
    mockedApi.fetchBackendVersion.mockResolvedValue({
      version: "0.1.0",
      buildCommit: "test-commit",
      buildTime: "2026-01-01T00:00:00Z"
    });
    mockedApi.logout.mockResolvedValue({ logged_out: true });
  });

  it("keeps account, language, and theme controls in settings", async () => {
    renderSettingsPage();

    expect(screen.getByText("13800000001")).toBeInTheDocument();
    expect(await screen.findByText("test-commit")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(useThemeStore.getState().theme).toBe("light");

    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(useLocaleStore.getState().locale).toBe("zh");

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    await waitFor(() => {
      expect(mockedApi.logout).toHaveBeenCalled();
      expect(useAuthStore.getState().token).toBeUndefined();
      expect(replaceMock).toHaveBeenCalledWith("/login");
    });
  });
});
