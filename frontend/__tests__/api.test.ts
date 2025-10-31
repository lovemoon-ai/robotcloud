import { robotCloudApi } from "@/api/client";
import { AuthResponse, DashboardSummary } from "@/types";

describe("robotCloudApi", () => {
  let mockedFetch: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    mockedFetch = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({}),
      text: jest.fn().mockResolvedValue("")
    } as unknown as Response);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("loginWithPassword posts credentials", async () => {
    const mockResponse: AuthResponse = {
      token: "token",
      user: { id: "1", name: "Alice", tier: "plus" }
    };
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(mockResponse)
    } as unknown as Response);

    const result = await robotCloudApi.loginWithPassword({ phone: "123", password: "pwd" });
    expect(mockedFetch).toHaveBeenCalledWith("https://api.robotcloud.dev/auth/login", expect.any(Object));
    const [, init] = mockedFetch.mock.calls[0];
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init!.body as string)).toEqual({ phone: "123", password: "pwd" });
    expect(result).toEqual(mockResponse);
  });

  it("requestOtp posts phone", async () => {
    await robotCloudApi.requestOtp("1380000");
    const [, init] = mockedFetch.mock.calls[0];
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init!.body as string)).toEqual({ phone: "1380000" });
  });

  it("verifyOtp posts payload", async () => {
    await robotCloudApi.verifyOtp({ phone: "138", code: "1234" });
    const [, init] = mockedFetch.mock.calls[0];
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init!.body as string)).toEqual({ phone: "138", code: "1234" });
  });

  it("fetchDashboard returns summary", async () => {
    const summary: DashboardSummary = { activeJobs: 1, datasets: 2, tier: "free", gpuHours: 3 };
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(summary)
    } as unknown as Response);

    await expect(robotCloudApi.fetchDashboard()).resolves.toEqual(summary);
  });

  it("listDatasets issues GET", async () => {
    await robotCloudApi.listDatasets();
    const [, init] = mockedFetch.mock.calls[0];
    expect(init).toMatchObject({ method: "GET" });
  });

  it("uploadDataset posts form", async () => {
    await robotCloudApi.uploadDataset({ name: "demo", modality: "image", visibility: "public" });
    const [, init] = mockedFetch.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({ name: "demo", modality: "image", visibility: "public" });
  });

  it("fetchTrainingJobs hits endpoint", async () => {
    await robotCloudApi.fetchTrainingJobs();
    expect(mockedFetch).toHaveBeenCalledWith("https://api.robotcloud.dev/train/jobs", expect.any(Object));
  });

  it("createTrainingJob posts config", async () => {
    await robotCloudApi.createTrainingJob({ model: "YOLO", datasetId: "1", learningRate: 0.1, epochs: 10, batchSize: 8 });
    const [, init] = mockedFetch.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({
      model: "YOLO",
      datasetId: "1",
      learningRate: 0.1,
      epochs: 10,
      batchSize: 8
    });
  });

  it("fetchInferenceJobs uses GET", async () => {
    await robotCloudApi.fetchInferenceJobs();
    const [, init] = mockedFetch.mock.calls[0];
    expect(init).toMatchObject({ method: "GET" });
  });

  it("runInference posts datasetId", async () => {
    await robotCloudApi.runInference("dataset-1");
    const [, init] = mockedFetch.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({ datasetId: "dataset-1" });
  });

  it("fetchSimulatorSessions uses GET", async () => {
    await robotCloudApi.fetchSimulatorSessions();
    const [, init] = mockedFetch.mock.calls[0];
    expect(init).toMatchObject({ method: "GET" });
  });

  it("fetchAdminUsers uses GET", async () => {
    await robotCloudApi.fetchAdminUsers();
    const [, init] = mockedFetch.mock.calls[0];
    expect(init).toMatchObject({ method: "GET" });
  });

  it("throws error when response not ok", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue("server error")
    } as unknown as Response);

    await expect(robotCloudApi.fetchDashboard()).rejects.toThrow("server error");
  });
});
