import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DatasetsPage from "../app/datasets/page";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";

const pushMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock
  })
}));

jest.mock("@/desktop/preparedDatasetUpload", () => ({
  clearPreparedDatasetUpload: jest.fn(),
  readPreparedDatasetUpload: jest.fn().mockResolvedValue(null)
}));

jest.mock("@/api/client", () => ({
  robotCloudApi: {
    listDatasets: jest.fn(),
    listActiveAgents: jest.fn(),
    uploadDataset: jest.fn(),
    deleteDataset: jest.fn()
  }
}));

const mockedApi = robotCloudApi as jest.Mocked<typeof robotCloudApi>;

function renderDatasetsPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });

  return render(
    <QueryClientProvider client={client}>
      <DatasetsPage />
    </QueryClientProvider>
  );
}

describe("/datasets page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pushMock.mockReset();
    useAuthStore.getState().reset();
    useAuthStore.getState().setAuth({
      token: "token",
      userId: 1,
      phone: "13800000001",
      role: "free",
      expireAt: null
    });
    useLocaleStore.getState().reset();
    mockedApi.listDatasets.mockResolvedValue([]);
    mockedApi.listActiveAgents.mockResolvedValue({
      defaultAgentNode: "gpu-node-1",
      items: [
        {
          nodeName: "gpu-node-1",
          ip: "10.0.0.10",
          apiPort: 5000,
          gpuTotal: 2,
          gpuFree: 1,
          gpuBusy: 1,
          status: "online",
          version: "test",
          publicBaseUrl: "https://agent.example.test",
          uploadEnabled: true,
          canUpload: true,
          isDefault: true,
          lastHeartbeat: null
        }
      ]
    });
  });

  it("aborts the current upload when cancel is clicked", async () => {
    let uploadSignal: AbortSignal | undefined;
    mockedApi.uploadDataset.mockImplementation(
      (input) =>
        new Promise((_, reject) => {
          uploadSignal = input.signal;
          input.signal?.addEventListener("abort", () => reject(new Error("Upload canceled")), { once: true });
        })
    );

    renderDatasetsPage();

    await screen.findByText("gpu-node-1 · Free GPUs: 1/2");
    fireEvent.change(screen.getByLabelText("Dataset Name"), { target: { value: "demo" } });
    fireEvent.change(screen.getByLabelText("Data File"), {
      target: { files: [new File(["content"], "dataset.zip", { type: "application/zip" })] }
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Upload" }));

    await waitFor(() => expect(mockedApi.uploadDataset).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(uploadSignal?.aborted).toBe(true);
      expect(uploadSignal?.reason).toBe("cancel");
      expect(screen.getByText("Upload canceled.")).toBeInTheDocument();
    });
  });
});
