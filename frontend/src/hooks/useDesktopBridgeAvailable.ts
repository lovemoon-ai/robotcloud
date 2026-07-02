"use client";

import { useEffect, useState } from "react";

export type DesktopBridgeAvailability = "checking" | "available" | "unavailable";

const DESKTOP_BRIDGE_TIMEOUT_MS = 2000;

async function detectDesktopBridge() {
  const bridge = window.robotcloudDesktop;
  if (!bridge?.isDesktop) {
    return false;
  }

  try {
    const status = await bridge.status();
    return Boolean(status.isDesktop);
  } catch {
    return false;
  }
}

export function useDesktopBridgeAvailability() {
  const [availability, setAvailability] = useState<DesktopBridgeAvailability>("checking");

  useEffect(() => {
    let disposed = false;
    let hasResolvedAvailable = false;
    let unavailableTimer: number | null = null;

    const clearUnavailableTimer = () => {
      if (unavailableTimer) {
        window.clearTimeout(unavailableTimer);
        unavailableTimer = null;
      }
    };

    const markAvailable = () => {
      hasResolvedAvailable = true;
      clearUnavailableTimer();
      setAvailability("available");
    };

    const markUnavailable = () => {
      if (!hasResolvedAvailable) {
        setAvailability("unavailable");
      }
    };

    const detect = async () => {
      if (hasResolvedAvailable) {
        return true;
      }

      const bridge = window.robotcloudDesktop;
      if (!bridge?.isDesktop) {
        return false;
      }

      const available = await detectDesktopBridge();
      if (!disposed) {
        if (available) {
          markAvailable();
        } else {
          markUnavailable();
        }
      }
      return available;
    };

    const handleReady = () => {
      void detect();
    };

    void detect();
    window.addEventListener("robotcloud-desktop-ready", handleReady);
    unavailableTimer = window.setTimeout(() => {
      void detect().then((available) => {
        if (!available && !disposed) {
          markUnavailable();
        }
      });
    }, DESKTOP_BRIDGE_TIMEOUT_MS);

    return () => {
      disposed = true;
      window.removeEventListener("robotcloud-desktop-ready", handleReady);
      clearUnavailableTimer();
    };
  }, []);

  return availability;
}

export function useDesktopBridgeAvailable() {
  return useDesktopBridgeAvailability() === "available";
}
