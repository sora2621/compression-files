import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";

import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

import { runCommand } from "./process-runner.mjs";

const root = process.cwd();
const fixtureDirectory = join(root, ".benchmark", "fixtures");

const fixtures = {
  smallJpeg: join(fixtureDirectory, "small-jpeg.jpg"),
  largeJpeg: join(fixtureDirectory, "large-jpeg.jpg"),
  transparentPng: join(fixtureDirectory, "transparent.png"),
  webp: join(fixtureDirectory, "source.webp"),
  video10s: join(fixtureDirectory, "video-1080p-10s.mp4"),
  video60s: join(fixtureDirectory, "video-1080p-60s.mp4"),
  video4k: join(fixtureDirectory, "video-4k-5s.mp4"),
  audio: join(fixtureDirectory, "audio-30s.wav"),
  aiImage: join(fixtureDirectory, "ai-source.png"),
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sceneSvg(width, height, transparent = false) {
  const background = transparent ? "none" : "#10263f";
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#00b7c7"/><stop offset="0.5" stop-color="#6c5ce7"/>
          <stop offset="1" stop-color="#ff7675"/>
        </linearGradient>
        <pattern id="p" width="96" height="96" patternUnits="userSpaceOnUse">
          <circle cx="24" cy="24" r="18" fill="url(#g)" fill-opacity="0.82"/>
          <path d="M0 96L96 0" stroke="#fff" stroke-opacity="0.18" stroke-width="8"/>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="${background}"/>
      <rect width="100%" height="100%" fill="url(#p)"/>
      <text x="5%" y="88%" font-family="Arial" font-size="${Math.max(24, Math.round(width / 18))}" fill="#fff">Compression Files benchmark</text>
    </svg>`);
}

async function generateImages() {
  if (!(await exists(fixtures.smallJpeg))) {
    await sharp(sceneSvg(640, 480))
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(fixtures.smallJpeg);
  }
  if (!(await exists(fixtures.largeJpeg))) {
    await sharp(sceneSvg(6000, 4000))
      .jpeg({ quality: 92, mozjpeg: true })
      .toFile(fixtures.largeJpeg);
  }
  if (!(await exists(fixtures.transparentPng))) {
    await sharp(sceneSvg(1920, 1440, true))
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(fixtures.transparentPng);
  }
  if (!(await exists(fixtures.webp))) {
    await sharp(sceneSvg(1920, 1080))
      .webp({ quality: 88, effort: 6 })
      .toFile(fixtures.webp);
  }
  if (!(await exists(fixtures.aiImage))) {
    await sharp(sceneSvg(512, 512)).png({ compressionLevel: 9 }).toFile(fixtures.aiImage);
  }
}

async function generateVideo(path, size, duration) {
  if (await exists(path)) return;
  await runCommand(
    ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=${size}:rate=30:duration=${duration}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=880:sample_rate=48000:duration=${duration}`,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      "-movflags",
      "+faststart",
      path,
    ],
    { timeoutMs: 20 * 60_000 },
  );
}

async function generateAudio() {
  if (await exists(fixtures.audio)) return;
  await runCommand(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=30",
    "-c:a",
    "pcm_s16le",
    fixtures.audio,
  ]);
}

await mkdir(fixtureDirectory, { recursive: true });
if (!ffmpegPath) throw new Error("FFmpeg is unavailable");
await generateImages();
await generateVideo(fixtures.video10s, "1920x1080", 10);
await generateVideo(fixtures.video60s, "1920x1080", 60);
await generateVideo(fixtures.video4k, "3840x2160", 5);
await generateAudio();
console.log(JSON.stringify({ type: "benchmark-fixtures", status: "ready", count: 9 }));
