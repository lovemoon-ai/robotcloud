import { parsePreparedDatasetUpload } from "@/desktop/preparedDatasetUpload";

describe("prepared dataset upload state", () => {
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
});
