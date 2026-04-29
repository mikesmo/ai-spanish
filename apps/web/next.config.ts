import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ["@ai-spanish/assets", "@ai-spanish/logic", "@ai-spanish/ai"],
  webpack(config) {
    config.resolve.extensions = [
      ".web.tsx",
      ".web.ts",
      ".web.js",
      ...config.resolve.extensions,
    ];
    return config;
  },
};

export default nextConfig;
