"use client";

import { useEffect, useState } from "react";

export function useDesktopBridgeAvailable() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let disposed = false;

    const detect = async () => {
      const bridge = window.robotcloudDesktop;
      if (!bridge) {
        setAvailable(false);
        return;
      }

      try {
        const status = await bridge.status();
        if (!disposed) {
          setAvailable(Boolean(status.isDesktop));
        }
      } catch {
        if (!disposed) {
          setAvailable(false);
        }
      }
    };

    void detect();
    window.addEventListener("robotcloud-desktop-ready", detect);
    const timer = window.setTimeout(() => void detect(), 500);

    return () => {
      disposed = true;
      window.removeEventListener("robotcloud-desktop-ready", detect);
      window.clearTimeout(timer);
    };
  }, []);

  return available;
}
