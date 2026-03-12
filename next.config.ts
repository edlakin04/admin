import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No external image domains needed for this admin site
  images: {
    unoptimized: true,
  },

  // Silence the @solana/web3.js punycode deprecation warning
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      punycode: false,
    };
    return config;
  },
};

export default nextConfig;
