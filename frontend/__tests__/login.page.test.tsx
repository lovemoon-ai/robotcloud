import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import LoginPage from "../app/login/page";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";

const replaceMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock
  })
}));

jest.mock("@/api/client", () => ({
  robotCloudApi: {
    loginWithPassword: jest.fn(),
    requestOtp: jest.fn(),
    verifyOtp: jest.fn(),
    registerWithInvitation: jest.fn()
  }
}));

const mockedApi = robotCloudApi as jest.Mocked<typeof robotCloudApi>;

describe("/login page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.getState().reset();
    replaceMock.mockReset();
  });

  const fillCredentialsAndSubmit = async (phone = "13800000001", password = "secret123") => {
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("例如：13800001234"), { target: { value: phone } });
    fireEvent.change(screen.getByPlaceholderText("至少 8 位字符"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
  };

  it("logs in existing users with password", async () => {
    mockedApi.loginWithPassword.mockResolvedValueOnce({
      token: "token",
      userId: 9,
      phone: "13800000001",
      role: "free",
      expireAt: null
    });

    await fillCredentialsAndSubmit();

    await waitFor(() => {
      expect(useAuthStore.getState().token).toBe("token");
    });
    expect(mockedApi.loginWithPassword).toHaveBeenCalledWith({ phone: "13800000001", password: "secret123" });
    expect(screen.getByText("欢迎回来，13800000001！")).toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("prompts for invitation code and completes registration when account missing", async () => {
    mockedApi.loginWithPassword
      .mockRejectedValueOnce(new Error("Phone not registered"))
      .mockResolvedValueOnce({
        token: "fresh-token",
        userId: 10,
        phone: "13800000001",
        role: "free",
        expireAt: null
      });
    mockedApi.registerWithInvitation.mockResolvedValue({ user_id: 10 });

    await fillCredentialsAndSubmit();

    expect(replaceMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByText("检测到新手机号，请输入邀请码完成注册。")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("请输入邀请码"), { target: { value: "INV-2024" } });
    fireEvent.click(screen.getByRole("button", { name: "提交注册" }));

    await waitFor(() => {
      expect(mockedApi.registerWithInvitation).toHaveBeenCalledWith({
        phone: "13800000001",
        password: "secret123",
        invitationCode: "INV-2024"
      });
      expect(mockedApi.loginWithPassword).toHaveBeenCalledTimes(2);
      expect(useAuthStore.getState().token).toBe("fresh-token");
      expect(replaceMock).toHaveBeenCalledWith("/");
    });
  });
});
