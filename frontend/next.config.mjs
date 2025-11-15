import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_API_BASE_URL =
  process.env.PUBLIC_API_BASE_URL ??
  process.env.ROBOTCLOUD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8000/api/v1";
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, "");

const nextConfig = {
  reactStrictMode: true,
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
