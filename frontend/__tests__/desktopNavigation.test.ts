import { cloudAppHref, desktopAwareHref, isLocalDesktopFrontend } from "@/desktop/navigation";

describe("desktop navigation helpers", () => {
  it("detects packaged Tauri frontend origins", () => {
    expect(isLocalDesktopFrontend({ protocol: "tauri:", hostname: "localhost" } as Location)).toBe(true);
    expect(isLocalDesktopFrontend({ protocol: "http:", hostname: "tauri.localhost" } as Location)).toBe(true);
    expect(isLocalDesktopFrontend({ protocol: "https:", hostname: "robotcloud.conductor-ai.top" } as Location)).toBe(false);
  });

  it("builds cloud app hrefs", () => {
    expect(cloudAppHref("/datasets?source=so101")).toBe("https://robotcloud.conductor-ai.top/datasets?source=so101");
  });

  it("sends local desktop non-SO101 navigation to the cloud", () => {
    const localLocation = { protocol: "tauri:", hostname: "localhost" } as Location;

    expect(desktopAwareHref("/datasets", true, localLocation)).toBe("https://robotcloud.conductor-ai.top/datasets");
    expect(desktopAwareHref("/login?next=%2Fso101", false, localLocation)).toBe(
      "https://robotcloud.conductor-ai.top/login?next=%2Fso101"
    );
    expect(desktopAwareHref("/so101", true, localLocation)).toBe("/so101");
  });

  it("uses cloud SO101 URLs in desktop cloud pages so Tauri can intercept them", () => {
    expect(desktopAwareHref("/so101", true)).toBe("https://robotcloud.conductor-ai.top/so101/");
    expect(desktopAwareHref("/datasets", true)).toBe("/datasets");
  });
});
