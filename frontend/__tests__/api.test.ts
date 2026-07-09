import { waitFor } from "@testing-library/react";
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

const API_BASE = "http://localhost:6150/api/v1";

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
  let lastXhr: XMLHttpRequest | null = null;
  let nextXhrResponseText: string | null = null;
  let xhrQueue: Array<{ status?: number; responseText?: string; error?: boolean; defer?: boolean }> = [];

  const storedUploadKeys = () =>
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
      (key): key is string => Boolean(key?.startsWith("robotcloud:agent-upload:"))
    );

  beforeEach(() => {
    mockedFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ code: 0, data: {} }),
      text: jest.fn().mockResolvedValue("")
    }) as unknown as jest.MockedFunction<typeof fetch>;
    global.fetch = mockedFetch as unknown as typeof fetch;
    class MockXHR {
      upload = { onprogress: null as null | ((event: ProgressEvent) => void) };
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      onabort: null | (() => void) = null;
      status = 200;
      responseText = "";
      _method = "";
      _url = "";
      _headers: Record<string, string> = {};
      _body: Document | BodyInit | null = null;
      _aborted = false;

      open(method: string, url: string) {
        this._method = method;
        this._url = url;
      }

      setRequestHeader(key: string, value: string) {
        this._headers[key] = value;
      }

      send(body?: Document | BodyInit | null) {
        this._body = body ?? null;
        const queued = xhrQueue.shift();
        if (queued) {
          if (queued.status !== undefined) {
            this.status = queued.status;
          }
          if (queued.responseText !== undefined) {
            this.responseText = queued.responseText;
          }
          if (queued.error) {
            if (this.onerror) {
              this.onerror();
            }
            return;
          }
          if (queued.defer) {
            return;
          }
        } else if (!this.responseText) {
          this.responseText = JSON.stringify({ code: 0, data: {} });
        }
        if (this.onload) {
          this.onload();
        }
      }

      abort() {
        this._aborted = true;
        if (this.onabort) {
          this.onabort();
        }
      }
    }
    global.XMLHttpRequest = jest.fn(() => {
      const instance = new MockXHR() as unknown as XMLHttpRequest;
      if (nextXhrResponseText) {
        (instance as unknown as { responseText: string }).responseText = nextXhrResponseText;
        nextXhrResponseText = null;
      }
      lastXhr = instance;
      return instance;
    }) as unknown as typeof XMLHttpRequest;
  });

  afterEach(() => {
    global.fetch = originalFetch as typeof fetch;
    useAuthStore.getState().reset();
    localStorage.clear();
    lastXhr = null;
    nextXhrResponseText = null;
    xhrQueue = [];
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
    expect(JSON.parse(init?.body as string)).toMatchObject({
      ...credentials,
      device_type: "desktop",
      replace_existing_device: false
    });
    expect(JSON.parse(init?.body as string).device_id).toEqual(expect.any(String));
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
    await robotCloudApi.verifyOtp({ phone: "138", password: "pwd", code: "1234" });
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/auth/register`);
    expect(JSON.parse(init?.body as string)).toEqual({
      phone: "138",
      password: "pwd",
      code: "1234"
    });
  });

  it("loginWithCode sends persisted device context", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: {
          token: "abc",
          user_id: 9,
          phone: "13800000001",
          role: "free",
          expire_at: null
        }
      })
    } as unknown as Response);

    await robotCloudApi.loginWithCode({ phone: "13800000001", code: "000000" });
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/auth/login_code`);
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      phone: "13800000001",
      code: "000000",
      device_type: "desktop",
      replace_existing_device: false
    });
    expect(body.device_id).toEqual(expect.any(String));
  });

  it("loginWithCode can request device replacement", async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: {
          token: "abc",
          user_id: 9,
          phone: "13800000001",
          role: "free",
          expire_at: null
        }
      })
    } as unknown as Response);

    await robotCloudApi.loginWithCode({ phone: "13800000001", code: "000000" }, { replaceExistingDevice: true });
    const [, init] = mockedFetch.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toMatchObject({
      replace_existing_device: true
    });
  });

  it("logout revokes the current backend session", async () => {
    setAuthenticatedUser();
    await robotCloudApi.logout();
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/auth/logout`);
    expect(init?.method).toBe("POST");
    expect(mapHeaders(init)).toHaveProperty("authorization", "Bearer token");
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

  it("createPayment defaults to alipay provider", async () => {
    setAuthenticatedUser();
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: {
          payment_id: "pay_1",
          target_role: "plus",
          amount_cents: 100000,
          currency: "CNY",
          provider: "alipay",
          status: "pending",
          applied_at: null,
          created_at: "2024-01-01T00:00:00Z",
          checkout_url: "https://pay.example.test"
        }
      })
    } as unknown as Response);

    await robotCloudApi.createPayment("plus");
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/payment/create`);
    expect(JSON.parse(init?.body as string)).toEqual({ target_role: "plus", provider: "alipay" });
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
            storage_backend: "agent",
            storage_node: "gpu-node-1",
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
        previewAvailable: true,
        storageBackend: "agent",
        storageNode: "gpu-node-1"
      }
    ]);
  });

  it("listActiveAgents converts active agent list", async () => {
    setAuthenticatedUser();
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: {
          default_agent_node: "gpu-node-1",
          total: 1,
          items: [
            {
              node_name: "gpu-node-1",
              ip: "10.0.0.10",
              api_port: 5000,
              gpu_total: 2,
              gpu_free: 1,
              gpu_busy: 1,
              status: "online",
              version: "1.0.0",
              public_base_url: "https://agent.example.test",
              upload_enabled: true,
              can_upload: true,
              is_default: true,
              last_heartbeat: "2024-01-01T00:00:00Z"
            }
          ]
        }
      })
    } as unknown as Response);

    const result = await robotCloudApi.listActiveAgents();
    expect(result.items[0]).toMatchObject({
      nodeName: "gpu-node-1",
      publicBaseUrl: "https://agent.example.test",
      canUpload: true,
      isDefault: true
    });
    expect(result.defaultAgentNode).toBe("gpu-node-1");
  });

  it("updateDefaultAgent posts user setting", async () => {
    setAuthenticatedUser();
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: { default_agent_node: "gpu-node-2" }
      })
    } as unknown as Response);

    const result = await robotCloudApi.updateDefaultAgent("gpu-node-2");
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/user/settings`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({ default_agent_node: "gpu-node-2" });
    expect(result.defaultAgentNode).toBe("gpu-node-2");
  });

  it("uploadDataset creates a session and uploads the file to the selected agent", async () => {
    setAuthenticatedUser();
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: {
          dataset_id: 2,
          status: "processing",
          upload_url: "https://agent.example.test/api/v1/agent/datasets/upload",
          upload_token: "upload-token",
          expires_at: "2024-01-01T00:15:00Z",
          expires_in: 900,
          chunk_size: 1024,
          node_name: "gpu-node-1",
          file_name: "dataset.zip"
        }
      })
    } as unknown as Response);
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          status: "ok",
          dataset_id: 2,
          file_name: "dataset.zip",
          uploaded_bytes: 0,
          complete: false
        })
      )
    } as unknown as Response);
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          status: "ready",
          dataset_id: 2,
          file_name: "dataset.zip",
          file_size: 7,
          total_files: 5
        })
      )
    } as unknown as Response);
    nextXhrResponseText = JSON.stringify({
      status: "ok",
      dataset_id: 2,
      uploaded_bytes: 7,
      total_size: 7,
      complete: true
    });
    const file = new File(["content"], "dataset.zip", { type: "application/zip" });
    const result = await robotCloudApi.uploadDataset({
      file,
      name: "demo",
      description: "desc",
      visibility: "public",
      targetNode: "gpu-node-1"
    });
    const [sessionUrl, sessionInit] = mockedFetch.mock.calls[0];
    expect(sessionUrl).toBe(`${API_BASE}/dataset/upload_session`);
    expect(JSON.parse(sessionInit?.body as string)).toEqual({
      name: "demo",
      description: "desc",
      visibility: "public",
      filename: "dataset.zip",
      target_node: "gpu-node-1"
    });
    expect(mockedFetch.mock.calls[1][0]).toBe("https://agent.example.test/api/v1/agent/datasets/upload/status");
    expect(mockedFetch.mock.calls[2][0]).toBe("https://agent.example.test/api/v1/agent/datasets/upload/complete");
    const xhr = lastXhr as unknown as {
      _method: string;
      _url: string;
      _headers: Record<string, string>;
      _body: Blob | null;
    };
    expect(xhr._method).toBe("PUT");
    expect(xhr._url).toBe("https://agent.example.test/api/v1/agent/datasets/upload/chunk");
    expect(xhr._headers).toMatchObject({
      Authorization: "Bearer upload-token",
      "X-Dataset-Id": "2",
      "X-Filename": "dataset.zip",
      "Content-Range": "bytes 0-6/7",
      "X-File-Size": "7",
      "Content-Type": "application/zip"
    });
    expect(xhr._body?.size).toBe(7);
    expect(result).toEqual<DatasetUploadResult>({
      datasetId: 2,
      status: "ready",
      fileName: "dataset.zip",
      fileSize: 7,
      totalFiles: 5
    });
  });

  it("pauses a resumable upload and keeps the stored session", async () => {
    setAuthenticatedUser();
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: {
          dataset_id: 4,
          status: "processing",
          upload_url: "https://agent.example.test/api/v1/agent/datasets/upload",
          upload_token: "upload-token",
          expires_at: "2024-01-01T00:15:00Z",
          expires_in: 900,
          chunk_size: 1024,
          node_name: "gpu-node-1",
          file_name: "dataset.zip"
        }
      })
    } as unknown as Response);
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ uploaded_bytes: 0, complete: false }))
    } as unknown as Response);
    xhrQueue = [{ defer: true }];
    const controller = new AbortController();
    const file = new File(["content"], "dataset.zip", { type: "application/zip" });

    const upload = robotCloudApi.uploadDataset({
      file,
      name: "pause",
      description: "desc",
      visibility: "private",
      targetNode: "gpu-node-1",
      signal: controller.signal
    });

    await waitFor(() => expect(lastXhr).not.toBeNull());
    expect(storedUploadKeys()).toHaveLength(1);
    controller.abort("pause");

    await expect(upload).rejects.toThrow("Upload paused");
    expect(storedUploadKeys()).toHaveLength(1);
    expect(mockedFetch.mock.calls.some(([url]) => url === `${API_BASE}/dataset/4/delete`)).toBe(false);
  });

  it("cancels a resumable upload and deletes the unfinished dataset", async () => {
    setAuthenticatedUser();
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: {
          dataset_id: 5,
          status: "processing",
          upload_url: "https://agent.example.test/api/v1/agent/datasets/upload",
          upload_token: "upload-token",
          expires_at: "2024-01-01T00:15:00Z",
          expires_in: 900,
          chunk_size: 1024,
          node_name: "gpu-node-1",
          file_name: "dataset.zip"
        }
      })
    } as unknown as Response);
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ uploaded_bytes: 0, complete: false }))
    } as unknown as Response);
    xhrQueue = [{ defer: true }];
    const controller = new AbortController();
    const file = new File(["content"], "dataset.zip", { type: "application/zip" });

    const upload = robotCloudApi.uploadDataset({
      file,
      name: "cancel",
      description: "desc",
      visibility: "private",
      targetNode: "gpu-node-1",
      signal: controller.signal
    });

    await waitFor(() => expect(lastXhr).not.toBeNull());
    expect(storedUploadKeys()).toHaveLength(1);
    controller.abort("cancel");

    await expect(upload).rejects.toThrow("Upload canceled");
    expect(storedUploadKeys()).toHaveLength(0);
    expect(
      mockedFetch.mock.calls.some(
        ([url, init]) => url === `${API_BASE}/dataset/5/delete` && init?.method === "POST"
      )
    ).toBe(true);
  });

  it("finishes session creation before deleting when cancel is requested early", async () => {
    setAuthenticatedUser();
    let resolveSession!: (response: Response) => void;
    const sessionRequest = new Promise<Response>((resolve) => {
      resolveSession = resolve;
    });
    mockedFetch.mockImplementationOnce(() => sessionRequest);
    const controller = new AbortController();
    const file = new File(["content"], "dataset.zip", { type: "application/zip" });

    const upload = robotCloudApi.uploadDataset({
      file,
      name: "early-cancel",
      description: "desc",
      visibility: "private",
      targetNode: "gpu-node-1",
      signal: controller.signal
    });

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith(`${API_BASE}/dataset/upload_session`, expect.any(Object)));
    const [, sessionInit] = mockedFetch.mock.calls[0];
    expect(sessionInit?.signal).toBeUndefined();
    controller.abort("cancel");
    resolveSession({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: {
          dataset_id: 6,
          status: "processing",
          upload_url: "https://agent.example.test/api/v1/agent/datasets/upload",
          upload_token: "upload-token",
          expires_at: "2024-01-01T00:15:00Z",
          expires_in: 900,
          chunk_size: 1024,
          node_name: "gpu-node-1",
          file_name: "dataset.zip"
        }
      })
    } as unknown as Response);

    await expect(upload).rejects.toThrow("Upload canceled");
    expect(storedUploadKeys()).toHaveLength(0);
    expect(
      mockedFetch.mock.calls.some(
        ([url, init]) => url === `${API_BASE}/dataset/6/delete` && init?.method === "POST"
      )
    ).toBe(true);
  });

  it("retries a chunk when the status probe also fails", async () => {
    setAuthenticatedUser();
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        code: 0,
        data: {
          dataset_id: 3,
          status: "processing",
          upload_url: "https://agent.example.test/api/v1/agent/datasets/upload",
          upload_token: "upload-token",
          expires_at: "2024-01-01T00:15:00Z",
          expires_in: 900,
          chunk_size: 1024,
          node_name: "gpu-node-1",
          file_name: "dataset.zip"
        }
      })
    } as unknown as Response);
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(JSON.stringify({ uploaded_bytes: 0, complete: false }))
    } as unknown as Response);
    mockedFetch.mockRejectedValueOnce(new Error("offline"));
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: jest.fn().mockResolvedValue(
        JSON.stringify({
          status: "ready",
          dataset_id: 3,
          file_name: "dataset.zip",
          file_size: 7,
          total_files: 1
        })
      )
    } as unknown as Response);
    xhrQueue = [
      { error: true },
      {
        responseText: JSON.stringify({
          status: "ok",
          dataset_id: 3,
          uploaded_bytes: 7,
          total_size: 7,
          complete: true
        })
      }
    ];
    const file = new File(["content"], "dataset.zip", { type: "application/zip" });

    const result = await robotCloudApi.uploadDataset({
      file,
      name: "retry",
      description: "desc",
      visibility: "private",
      targetNode: "gpu-node-1"
    });

    expect(global.XMLHttpRequest).toHaveBeenCalledTimes(2);
    expect(result).toEqual<DatasetUploadResult>({
      datasetId: 3,
      status: "ready",
      fileName: "dataset.zip",
      fileSize: 7,
      totalFiles: 1
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
    const config: TrainingConfig = { model: "YOLO", datasetId: "1", learningRate: 0.1, steps: 10, batchSize: 8 };
    await robotCloudApi.createTrainingJob(config);
    const [, init] = mockedFetch.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({
      dataset_id: 1,
      model_type: "YOLO",
      params: { learning_rate: 0.1, steps: 10, batch_size: 8 }
    });
  });

  it("createTrainingJob posts Pi0.5 lightweight fine-tune payload", async () => {
    setAuthenticatedUser();
    const config: TrainingConfig = {
      model: "Pi0.5",
      datasetId: "6",
      learningRate: 0.000025,
      steps: 5000,
      batchSize: 16,
      pi05Preset: "throughput",
      pi05TrainingScope: "expert"
    };
    await robotCloudApi.createTrainingJob(config);
    const [, init] = mockedFetch.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({
      dataset_id: 6,
      model_type: "Pi0.5",
      params: {
        learning_rate: 0.000025,
        steps: 5000,
        batch_size: 16,
        "policy.path": "lerobot/pi05_base",
        "policy.dtype": "bfloat16",
        "policy.train_expert_only": true,
        "policy.gradient_checkpointing": false,
        rename_map: {
          "observation.images.front": "observation.images.base_0_rgb",
          "observation.images.side": "observation.images.left_wrist_0_rgb"
        }
      }
    });
  });

  it("createTrainingJob posts explicit params without merging template defaults", async () => {
    setAuthenticatedUser();
    const params = {
      steps: 5000,
      batch_size: 4,
      "policy.path": "custom/pi05",
      rename_map: {
        "observation.images.front": "observation.images.base_0_rgb",
        "observation.images.left": "observation.images.left_wrist_0_rgb",
        "observation.images.right": "observation.images.right_wrist_0_rgb"
      }
    };
    const config: TrainingConfig = {
      model: "Pi0.5",
      datasetId: "6",
      learningRate: 0.000025,
      steps: 5000,
      batchSize: 8,
      params
    };
    await robotCloudApi.createTrainingJob(config);
    const [, init] = mockedFetch.mock.calls[0];
    expect(JSON.parse(init?.body as string)).toEqual({
      dataset_id: 6,
      model_type: "Pi0.5",
      params
    });
  });

  it("deleteTrainingJob posts to delete endpoint with auth", async () => {
    setAuthenticatedUser();
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ code: 0, data: { deleted: true } })
    } as unknown as Response);
    await robotCloudApi.deleteTrainingJob(7);
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/training/7/delete`);
    expect(init?.method).toBe("POST");
    expect(mapHeaders(init)).toHaveProperty("authorization", "Bearer token");
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
            started_at: "2024-01-01T00:00:05Z",
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
      {
        id: 5,
        modelId: 3,
        datasetId: 2,
        status: "running",
        progress: undefined,
        serverHost: undefined,
        serverPort: undefined,
        checkpointPath: undefined,
        resultPath: undefined,
        errorMessage: undefined,
        createdAt: "2024-01-01T00:00:00Z",
        startedAt: "2024-01-01T00:00:05Z"
      }
    ]);
  });

  it("runInference posts model id only", async () => {
    setAuthenticatedUser();
    await robotCloudApi.runInference({ modelId: 1 });
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/inference/create`);
    expect(JSON.parse(init?.body as string)).toEqual({ model_id: 1 });
  });

  it("deleteInferenceJob posts delete request", async () => {
    setAuthenticatedUser();
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ code: 0, data: { deleted: true } })
    } as unknown as Response);

    await robotCloudApi.deleteInferenceJob(9);
    const [url, init] = mockedFetch.mock.calls[0];
    expect(url).toBe(`${API_BASE}/inference/9/delete`);
    expect(init?.method).toBe("POST");
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
