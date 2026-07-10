const DEFAULT_CLOUD_WEB_BASE_URL = "https://robotcloud.conductor-ai.top";

type LocationLike = Pick<Location, "protocol" | "hostname">;

function currentLocation() {
  return typeof window !== "undefined" ? window.location : undefined;
}

function isSo101Href(href: string) {
  return href === "/so101" || href.startsWith("/so101?") || href.startsWith("/so101/");
}

export function cloudWebBaseUrl() {
  return (process.env.NEXT_PUBLIC_ROBOTCLOUD_WEB_BASE_URL ?? DEFAULT_CLOUD_WEB_BASE_URL).replace(/\/$/, "");
}

export function cloudAppHref(pathname: string) {
  if (/^https?:\/\//i.test(pathname)) {
    return pathname;
  }
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${cloudWebBaseUrl()}${normalizedPath}`;
}

export function isLocalDesktopFrontend(location: LocationLike | undefined = typeof window !== "undefined" ? window.location : undefined) {
  if (!location) {
    return false;
  }
  return (
    location.protocol === "tauri:" ||
    location.hostname === "tauri.localhost" ||
    (location.protocol === "app:" && location.hostname === "local")
  );
}

export function isLoopbackFrontend(location: LocationLike | undefined = currentLocation()) {
  if (!location) {
    return false;
  }
  return (
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "::1" ||
    location.hostname === "[::1]"
  );
}

export function shouldUseLocalDesktopNavigation(location: LocationLike | undefined = currentLocation()) {
  return isLocalDesktopFrontend(location) || isLoopbackFrontend(location);
}

export function desktopAwareHref(
  href: string,
  isDesktopBridgeAvailable: boolean,
  location: LocationLike | undefined = currentLocation()
) {
  if (shouldUseLocalDesktopNavigation(location)) {
    return href;
  }

  if (isDesktopBridgeAvailable && isSo101Href(href)) {
    return cloudAppHref("/so101/");
  }

  return href;
}

export function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href);
}

export function navigateToCloudPath(pathname: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.location.assign(cloudAppHref(pathname));
}
