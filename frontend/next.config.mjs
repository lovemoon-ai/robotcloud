import { fileURLToPath } from 'url';
import { dirname } from 'path';

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    esmExternals: false
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      '@': fileURLToPath(new URL('./src', import.meta.url))
    };
    return config;
  }
};

export default nextConfig;
