import path from "path";
import { fileURLToPath } from "url";
import nextEnv from "@next/env";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { loadEnvConfig } = nextEnv;
const dev = process.env.NODE_ENV !== "production";
const repoRoot = path.join(__dirname, "..");

const envFile = process.env.ENV_FILE || ".env";
loadEnvConfig(repoRoot, dev, envFile);
loadEnvConfig(__dirname, dev);
const RAW_API_BASE_URL =
  process.env.PUBLIC_API_BASE_URL ??
  process.env.ROBOTCLOUD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "https://robotcloud.conductor-ai.top/api/v1";
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, "");
const RAW_WEB_BASE_URL =
  process.env.PUBLIC_WEB_BASE_URL ??
  process.env.ROBOTCLOUD_WEB_BASE_URL ??
  process.env.NEXT_PUBLIC_ROBOTCLOUD_WEB_BASE_URL ??
  "https://robotcloud.conductor-ai.top";
const WEB_BASE_URL = RAW_WEB_BASE_URL.replace(/\/$/, "");
const RAW_BASE_PATH = process.env.ROBOTCLOUD_FRONTEND_BASE_PATH ?? "";
const BASE_PATH = RAW_BASE_PATH && RAW_BASE_PATH !== "/" ? RAW_BASE_PATH.replace(/\/$/, "") : "";

const nextConfig = {
  output: "export",
  basePath: BASE_PATH || undefined,
  trailingSlash: true,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE_URL: API_BASE_URL,
    NEXT_PUBLIC_ROBOTCLOUD_WEB_BASE_URL: WEB_BASE_URL,
    NEXT_PUBLIC_ROBOTCLOUD_BASE_PATH: BASE_PATH
  },
  experimental: {
    esmExternals: false
  },
  publicRuntimeConfig: {
    apiBaseUrl: API_BASE_URL
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      "@": path.join(__dirname, "src")
    };
    if (config.cache && config.cache.type === "filesystem") {
      config.cache = false;
    }
    return config;
  }
};

export default nextConfig;
