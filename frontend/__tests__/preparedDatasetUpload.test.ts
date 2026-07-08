import {
  clearPreparedDatasetUpload,
  parsePreparedDatasetUpload,
  readPreparedDatasetUpload,
  writePreparedDatasetUpload
} from "@/desktop/preparedDatasetUpload";

describe("prepared dataset upload state", () => {
  afterEach(() => {
    delete window.robotcloudDesktop;
    window.sessionStorage.clear();
  });

  it("parses valid prepared upload payloads", () => {
    expect(
      parsePreparedDatasetUpload(
        JSON.stringify({
          filePath: "/tmp/robotcloud/prepared_uploads/local_so101.zip",
          fileName: "local_so101.zip",
          fileSize: 1024,
          datasetRoot: "/tmp/robotcloud/datasets/local/so101",
          name: "local/so101",
          description: "SO101 Desktop recording",
          visibility: "private",
          createdAt: "1760000000000",
          stats: {
            datasetRoot: "/tmp/robotcloud/datasets/local/so101",
            fileCount: 4,
            totalBytes: 2048,
            episodeCount: 1,
            totalFrames: 300,
            fps: 30,
            durationSeconds: 10
          }
        })
      )
    ).toMatchObject({
      fileName: "local_so101.zip",
      fileSize: 1024,
      name: "local/so101",
      visibility: "private",
      stats: {
        episodeCount: 1,
        durationSeconds: 10
      }
    });
  });

  it("rejects malformed prepared upload payloads", () => {
    expect(parsePreparedDatasetUpload(null)).toBeNull();
    expect(parsePreparedDatasetUpload("{bad json")).toBeNull();
    expect(
      parsePreparedDatasetUpload(
        JSON.stringify({
          filePath: "/tmp/file.zip",
          fileName: "file.zip",
          fileSize: 1,
          datasetRoot: "/tmp/data",
          name: "local/data",
          description: "invalid",
          visibility: "shared",
          createdAt: "1760000000000"
        })
      )
    ).toBeNull();
  });

  it("uses the desktop bridge when available", async () => {
    const prepared = {
      filePath: "/tmp/robotcloud/prepared_uploads/local_so101.zip",
      fileName: "local_so101.zip",
      fileSize: 1024,
      datasetRoot: "/tmp/robotcloud/datasets/local/so101",
      name: "local/so101",
      description: "SO101 Desktop recording",
      visibility: "private" as const,
      createdAt: "1760000000000"
    };
    const getPreparedUpload = jest.fn().mockResolvedValue(prepared);
    const setPreparedUpload = jest.fn().mockResolvedValue(undefined);
    const clearPreparedUpload = jest.fn().mockResolvedValue(undefined);
    window.robotcloudDesktop = {
      isDesktop: true,
      dataset: {
        getPreparedUpload,
        setPreparedUpload,
        clearPreparedUpload,
        prepareUpload: jest.fn(),
        readPreparedUpload: jest.fn()
      }
    } as unknown as DesktopBridge;

    await expect(readPreparedDatasetUpload()).resolves.toMatchObject({ fileName: "local_so101.zip" });
    await writePreparedDatasetUpload(prepared);
    await clearPreparedDatasetUpload();

    expect(getPreparedUpload).toHaveBeenCalled();
    expect(setPreparedUpload).toHaveBeenCalledWith(prepared);
    expect(clearPreparedUpload).toHaveBeenCalled();
  });
});
