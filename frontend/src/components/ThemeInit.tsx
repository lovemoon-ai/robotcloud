"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/store/useThemeStore";

export function ThemeInit() {
  const { theme } = useThemeStore();

  useEffect(() => {
    // Set initial theme attribute
    document.documentElement.setAttribute("data-theme", theme);
    
    // Add dark class for tailwind dark mode
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  return null;
}
