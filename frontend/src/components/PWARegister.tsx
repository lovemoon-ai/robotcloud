"use client";

import { useEffect } from "react";

export function PWARegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    const isSecureContext =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isSecureContext) {
      return;
    }

    const register = () => {
      if (cancelled) {
        return;
      }
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration can fail in private mode or restricted webviews.
      });
    };

    let cancelled = false;
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
