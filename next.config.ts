import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server only serves its scripts to localhost unless the origin is
  // allowed here. Phones on the LAN open the app via the PC's IP address.
  allowedDevOrigins: [
    "10.*.*.*",
    "192.168.*.*",
    "172.*.*.*",
    "*.local",
    "*.loca.lt",
    "*.ngrok-free.app",
    "*.trycloudflare.com",
  ],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
