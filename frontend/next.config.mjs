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
  "http://localhost:6150/api/v1";
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, "");

const nextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE_URL: API_BASE_URL
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
