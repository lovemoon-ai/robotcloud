import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import {
  AdminUser,
  AuthCredentials,
  AuthSession,
  DashboardSummary,
  DatasetSummary,
  DatasetUploadResult,
  InferenceJob,
  SimulatorSession,
  TrainingConfig,
  TrainingJob
} from "@/types";

const API_BASE = "http://localhost:8000/api/v1";

const mapHeaders = (init: RequestInit | undefined) => {
  if (!init?.headers) return {};
  const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
  return Object.fromEntries(headers.entries());
};

const setAuthenticatedUser = () => {
  const session: AuthSession = {
    token: "token",
    userId: 1,
    phone: "13800000000",
    role: "free",
    expireAt: null
  };
  useAuthStore.getState().setAuth(session);
};

describe("robotCloudApi", () => {
  let mockedFetch: jest.MockedFunction<typeof fetch>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockedFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ code: 0, data: {} }),
      text: jest.fn().mockResolvedValue("")
    }) as unknown as jest.MockedFunction<typeof fetch>;
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch as typeof fetch;
    useAuthStore.getState().reset();
  });

  it("loginWithPassword sends credentials and maps response", async () => {
    const credentials: AuthCredentials = { phone: "123", password: "pwd" };
    const backendPayload = {
      code: 0,
      data: {
        token: "abc",
        user_id: 9,
        phone: "123",
        role: "plus",
        expire_at: "2026-01-01T00:00:00Z"
      }
    };
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(backendPayload)
    } as unknown as Response);

    const result = await robotCloudApi.loginWithPassword(credentials);
    expect(mockedFetch).toHaveBeenCalledWith(`${API_BASE}/auth/login`, expect.any(Object));
    const [, init] = mockedFetch.mock.calls[0];
    expect(mapHeaders(init)).toMatchObject({ "content-type": "application/json" });
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify(credentials));
    expect(result).toEqual({
      token: "abc",
      userId: 9,
      phone: "123",
      role: "plus",
      expireAt: "2026-01-01T00:00:00Z"
    });
  });

  it("requestOtp posts phone number", async () => {
    await robotCloudApi.requestOtp("1380000");
    const [, init] = mockedFetch.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ phone: "1380000" }));
    expect(mapHeaders(init)).toHaveProperty("content-type", "application/json");
  });

  it("verifyOtp forwards payload to register endpoint", async () => {
    await robotCloudApi.verifyOtp({ phone: "138", password: "pwd", code: "1234", invitationCode: "INV-001" });
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/auth/register`);
    expect(JSON.parse(init?.body as string)).toEqual({
      phone: "138",
      password: "pwd",
      code: "1234",
      invitation_code: "INV-001"
    });
  });

  it("registerWithInvitation posts invite payload", async () => {
    await robotCloudApi.registerWithInvitation({ phone: "138", password: "pwd", invitationCode: "INV-ABC" });
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/auth/register_invite`);
    expect(JSON.parse(init?.body as string)).toEqual({
      phone: "138",
      password: "pwd",
      invitation_code: "INV-ABC"
    });
  });

  it("surfaces backend error messages from JSON responses", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: jest.fn().mockResolvedValue('{"detail":"Phone not registered"}')
    } as unknown as Response);

    await expect(robotCloudApi.requestOtp("13800000000")).rejects.toThrow("Phone not registered");
  });

  it("fetchDashboard maps backend data", async () => {
    setAuthenticatedUser();
    const summary = {
      code: 0,
      data: { active_jobs: 2, datasets: 3, tier: "free", gpu_hours: 4.5 }
    };
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(summary)
    } as unknown as Response);

    const result = await robotCloudApi.fetchDashboard();
    expect(result).toEqual<DashboardSummary>({ activeJobs: 2, datasets: 3, tier: "free", gpuHours: 4.5 });
  });

  it("listDatasets converts dataset list", async () => {
    setAuthenticatedUser();
    const backend = {
      code: 0,
      data: {
        items: [
          {
            dataset_id: 1,
            name: "demo",
            description: "desc",
            visibility: "private",
            status: "processing",
            created_at: "2024-01-01T00:00:00Z",
            file_name: "demo.zip",
            file_size: 1024,
            total_files: 3,
            preview_available: true
          }
        ],
        total: 1
      }
    };
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(backend)
    } as unknown as Response);

    const result = await robotCloudApi.listDatasets();
    expect(result).toEqual<Array<DatasetSummary>>([
      {
        id: 1,
        name: "demo",
        description: "desc",
        visibility: "private",
        status: "processing",
        createdAt: "2024-01-01T00:00:00Z",
        fileName: "demo.zip",
        fileSize: 1024,
        totalFiles: 3,
        previewAvailable: true
      }
    ]);
  });

  it("uploadDataset sends multipart form data and maps response", async () => {
    setAuthenticatedUser();
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: {
          dataset_id: 2,
          status: "ready",
          file_name: "dataset.zip",
          file_size: 2048,
          total_files: 5
        }
      })
    } as unknown as Response);
    const file = new File(["content"], "dataset.zip", { type: "application/zip" });
    const result = await robotCloudApi.uploadDataset({
      file,
      name: "demo",
      description: "desc",
      visibility: "public"
    });
    const [, init] = mockedFetch.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    const form = init?.body as FormData;
    expect(form.get("name")).toBe("demo");
    expect(form.get("description")).toBe("desc");
    expect(form.get("visibility")).toBe("public");
    expect(form.get("file")).toBeInstanceOf(File);
    expect(result).toEqual<DatasetUploadResult>({
      datasetId: 2,
      status: "ready",
      fileName: "dataset.zip",
      fileSize: 2048,
      totalFiles: 5
    });
  });

  it("fetchTrainingJobs maps tasks and includes auth header", async () => {
    setAuthenticatedUser();
    const backend = {
      code: 0,
      data: {
        items: [
          {
            task_id: 7,
            dataset_id: 2,
            model_type: "YOLO",
            status: "queued",
            progress: 0.4,
            logs_url: "/logs"
          }
        ],
        total: 1
      }
    };
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(backend)
    } as unknown as Response);

    const result = await robotCloudApi.fetchTrainingJobs();
    expect(result).toEqual<Array<TrainingJob>>([
      {
        id: 7,
        datasetId: 2,
        model: "YOLO",
        status: "queued",
        progress: 40,
        logsUrl: "/logs"
      }
    ]);
    const [, init] = mockedFetch.mock.calls[0];
    expect(mapHeaders(init)).toHaveProperty("authorization", "Bearer token");
  });

  it("createTrainingJob posts transformed payload", async () => {
    setAuthenticatedUser();
    const config: TrainingConfig = { model: "YOLO", datasetId: "1", learningRate: 0.1, epochs: 10, batchSize: 8 };
    await robotCloudApi.createTrainingJob(config);
    const [, init] = mockedFetch.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({
      dataset_id: 1,
      model_type: "YOLO",
      params: { learning_rate: 0.1, epochs: 10, batch_size: 8 }
    });
  });

  it("fetchInferenceJobs maps response", async () => {
    setAuthenticatedUser();
    const backend = {
      code: 0,
      data: {
        items: [
          {
            task_id: 5,
            model_id: 3,
            dataset_id: 2,
            status: "running",
            result_path: null,
            created_at: "2024-01-01T00:00:00Z"
          }
        ],
        total: 1
      }
    };
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(backend)
    } as unknown as Response);

    const result = await robotCloudApi.fetchInferenceJobs();
    expect(result).toEqual<Array<InferenceJob>>([
      { id: 5, modelId: 3, datasetId: 2, status: "running", resultPath: undefined }
    ]);
  });

  it("runInference posts dataset and model ids", async () => {
    setAuthenticatedUser();
    await robotCloudApi.runInference({ datasetId: 2, modelId: 1 });
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/inference/create`);
    expect(JSON.parse(init?.body as string)).toEqual({ model_id: 1, dataset_id: 2 });
  });

  it("fetchSimulatorSessions maps simulation tasks", async () => {
    setAuthenticatedUser();
    const backend = {
      code: 0,
      data: {
        items: [
          {
            task_id: 1,
            scene_file: "warehouse.usd",
            model_id: 10,
            robot_type: "S100",
            training_mode: "reinforcement",
            status: "queued",
            created_at: "2024-01-01T00:00:00Z"
          }
        ],
        total: 1
      }
    };
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(backend)
    } as unknown as Response);

    const result = await robotCloudApi.fetchSimulatorSessions();
    expect(result).toEqual<Array<SimulatorSession>>([
      {
        id: 1,
        sceneFile: "warehouse.usd",
        modelId: 10,
        robotType: "S100",
        trainingMode: "reinforcement",
        status: "queued",
        createdAt: "2024-01-01T00:00:00Z"
      }
    ]);
  });

  it("fetchAdminUsers maps admin data", async () => {
    setAuthenticatedUser();
    const backend = {
      code: 0,
      data: {
        items: [
          {
            user_id: 1,
            phone: "1380000",
            role: "admin",
            created_at: "2024-01-01T00:00:00Z"
          }
        ],
        total: 1
      }
    };
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(backend)
    } as unknown as Response);

    const result = await robotCloudApi.fetchAdminUsers();
    expect(result).toEqual<Array<AdminUser>>([
      { id: 1, phone: "1380000", role: "admin", createdAt: "2024-01-01T00:00:00Z" }
    ]);
  });

  it("throws when backend returns error code", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ code: 1, message: "failed" })
    } as unknown as Response);

    await expect(robotCloudApi.fetchDashboard()).rejects.toThrow("failed");
  });

  it("throws when response not ok", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: jest.fn().mockResolvedValue("server error")
    } as unknown as Response);

    await expect(robotCloudApi.fetchDashboard()).rejects.toThrow("server error");
  });
});
