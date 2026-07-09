import {
  cloudAppHref,
  desktopAwareHref,
  isLocalDesktopFrontend,
  isLoopbackFrontend,
  shouldUseLocalDesktopNavigation
} from "@/desktop/navigation";

describe("desktop navigation helpers", () => {
  it("detects packaged Tauri frontend origins", () => {
    expect(isLocalDesktopFrontend({ protocol: "tauri:", hostname: "localhost" } as Location)).toBe(true);
    expect(isLocalDesktopFrontend({ protocol: "http:", hostname: "tauri.localhost" } as Location)).toBe(true);
    expect(isLocalDesktopFrontend({ protocol: "app:", hostname: "local" } as Location)).toBe(true);
    expect(isLocalDesktopFrontend({ protocol: "https:", hostname: "robotcloud.conductor-ai.top" } as Location)).toBe(false);
  });

  it("detects desktop dev loopback origins", () => {
    expect(isLoopbackFrontend({ protocol: "http:", hostname: "127.0.0.1" } as Location)).toBe(true);
    expect(isLoopbackFrontend({ protocol: "http:", hostname: "localhost" } as Location)).toBe(true);
    expect(isLoopbackFrontend({ protocol: "https:", hostname: "robotcloud.conductor-ai.top" } as Location)).toBe(false);
  });

  it("builds cloud app hrefs", () => {
    expect(cloudAppHref("/datasets?source=so101")).toBe("https://robotcloud.conductor-ai.top/datasets?source=so101");
  });

  it("keeps packaged desktop navigation inside the local frontend", () => {
    const localLocation = { protocol: "tauri:", hostname: "localhost" } as Location;

    expect(shouldUseLocalDesktopNavigation(localLocation)).toBe(true);
    expect(desktopAwareHref("/datasets", true, localLocation)).toBe("/datasets");
    expect(desktopAwareHref("/login?next=%2Fso101", false, localLocation)).toBe("/login?next=%2Fso101");
    expect(desktopAwareHref("/so101", true, localLocation)).toBe("/so101");
  });

  it("keeps desktop dev loopback navigation inside the dev frontend", () => {
    const devLocation = { protocol: "http:", hostname: "127.0.0.1" } as Location;

    expect(shouldUseLocalDesktopNavigation(devLocation)).toBe(true);
    expect(desktopAwareHref("/datasets", true, devLocation)).toBe("/datasets");
    expect(desktopAwareHref("/so101", true, devLocation)).toBe("/so101");
  });

  it("uses cloud SO101 URLs in desktop cloud pages so Tauri can intercept them", () => {
    const cloudLocation = { protocol: "https:", hostname: "robotcloud.conductor-ai.top" } as Location;

    expect(desktopAwareHref("/so101", true, cloudLocation)).toBe("https://robotcloud.conductor-ai.top/so101/");
    expect(desktopAwareHref("/datasets", true, cloudLocation)).toBe("/datasets");
  });
});
