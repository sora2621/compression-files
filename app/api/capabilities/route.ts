import { NextResponse } from "next/server";

import { getRuntimeCapabilities } from "@/lib/capabilities/runtime-capabilities";
import { errorResponse } from "@/lib/errors";
import { getImageOptimizationToolCapabilities } from "@/lib/optimization/tool-capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [capabilities, imageTools] = await Promise.all([
      getRuntimeCapabilities(),
      getImageOptimizationToolCapabilities(),
    ]);
    return NextResponse.json(
      {
        ...capabilities,
        optimization: {
          imageTools,
          videoQuality: {
            libvmaf: capabilities.ffmpeg.filters.includes("libvmaf"),
            av1: capabilities.ffmpeg.encoders.some((encoder) =>
              ["libaom-av1", "libsvtav1"].includes(encoder),
            ),
            h265: capabilities.ffmpeg.encoders.includes("libx265"),
            h264: capabilities.ffmpeg.encoders.includes("libx264"),
          },
        },
      },
      {
        headers: { "Cache-Control": "private, max-age=300" },
      },
    );
  } catch (error) {
    const response = errorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
