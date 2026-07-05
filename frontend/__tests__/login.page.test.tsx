import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    requestOtp: jest.fn(),
    loginWithCode: jest.fn()
  }
}));

const mockedApi = robotCloudApi as jest.Mocked<typeof robotCloudApi>;

describe("/login page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.getState().reset();
    replaceMock.mockReset();
    window.history.pushState({}, "", "/login");
  });

  const fillPhoneAndSendCode = async (phone = "13800000001") => {
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("e.g. 13800001234"), { target: { value: phone } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
    });
  };

  it("sends verification code and logs in with code", async () => {
    mockedApi.requestOtp.mockResolvedValueOnce({ sent: true, code: "000000" });
    mockedApi.loginWithCode.mockResolvedValueOnce({
      token: "token",
      userId: 9,
      phone: "13800000001",
      role: "free",
      expireAt: null
    });

    await fillPhoneAndSendCode();

    await waitFor(() => {
      expect(mockedApi.requestOtp).toHaveBeenCalledWith("13800000001");
    });

    // Enter verification code
    fireEvent.change(screen.getByPlaceholderText("Enter 6-digit code"), { target: { value: "000000" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Login / Register" }));
    });

    await waitFor(() => {
      expect(mockedApi.loginWithCode).toHaveBeenCalledWith({
        phone: "13800000001",
        code: "000000"
      });
    });

    await waitFor(() => {
      expect(useAuthStore.getState().token).toBe("token");
    });
    expect(replaceMock).toHaveBeenCalledWith("/");
  });

  it("redirects to a safe next path after login", async () => {
    mockedApi.requestOtp.mockResolvedValueOnce({ sent: true, code: "000000" });
    mockedApi.loginWithCode.mockResolvedValueOnce({
      token: "token",
      userId: 9,
      phone: "13800000001",
      role: "free",
      expireAt: null
    });
    window.history.pushState({}, "", "/login?next=%2Fso101");

    await fillPhoneAndSendCode();
    fireEvent.change(screen.getByPlaceholderText("Enter 6-digit code"), { target: { value: "000000" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Login / Register" }));
    });

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/so101");
    });
  });

  it("falls back home when next points outside the app", async () => {
    mockedApi.requestOtp.mockResolvedValueOnce({ sent: true, code: "000000" });
    mockedApi.loginWithCode.mockResolvedValueOnce({
      token: "token",
      userId: 9,
      phone: "13800000001",
      role: "free",
      expireAt: null
    });
    window.history.pushState({}, "", "/login?next=%2F%2Fevil.example");

    await fillPhoneAndSendCode();
    fireEvent.change(screen.getByPlaceholderText("Enter 6-digit code"), { target: { value: "000000" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Login / Register" }));
    });

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/");
    });
  });

  it("falls back home when next points back to login", async () => {
    mockedApi.requestOtp.mockResolvedValueOnce({ sent: true, code: "000000" });
    mockedApi.loginWithCode.mockResolvedValueOnce({
      token: "token",
      userId: 9,
      phone: "13800000001",
      role: "free",
      expireAt: null
    });
    window.history.pushState({}, "", "/login/?next=%2Flogin%2F");

    await fillPhoneAndSendCode();
    fireEvent.change(screen.getByPlaceholderText("Enter 6-digit code"), { target: { value: "000000" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Login / Register" }));
    });

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/");
    });
  });

  it("shows error for invalid phone number", async () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText("e.g. 13800001234"), { target: { value: "invalid" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Phone number format is incorrect")).toBeInTheDocument();
    });
  });

  it("logs in after sending code", async () => {
    mockedApi.requestOtp.mockResolvedValueOnce({ sent: true, code: "000000" });
    mockedApi.loginWithCode.mockResolvedValueOnce({
      token: "token",
      userId: 10,
      phone: "13800000001",
      role: "free",
      expireAt: null
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText("e.g. 13800001234"), { target: { value: "13800000001" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send Code" }));
    });

    await waitFor(() => {
      expect(mockedApi.requestOtp).toHaveBeenCalledWith("13800000001");
    });

    fireEvent.change(screen.getByPlaceholderText("Enter 6-digit code"), { target: { value: "000000" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Login / Register" }));
    });

    await waitFor(() => {
      expect(mockedApi.loginWithCode).toHaveBeenCalledWith({
        phone: "13800000001",
        code: "000000"
      });
    });
  });
});
