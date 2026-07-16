import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "ffmpeg-static", "ffprobe-static", "exifr"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
