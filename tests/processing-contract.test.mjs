import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("video metadata removal keeps streams and strips metadata", async () => {
  const source = await readFile(
    new URL("infrastructure/ffmpeg/video-arguments.ts", root),
    "utf8",
  );
  assert.match(source, /"-c",\s*"copy"/);
  assert.match(source, /"-map_metadata",\s*"-1"/);
  assert.match(source, /"-map_chapters",\s*"-1"/);
});

test("video compression maps resolution, codecs, CRF, audio and progress", async () => {
  const [argumentsSource, filters, probe, types, panel, codecSelector, processRoute] =
    await Promise.all([
      readFile(new URL("infrastructure/ffmpeg/video-arguments.ts", root), "utf8"),
      readFile(new URL("infrastructure/ffmpeg/video-filters.ts", root), "utf8"),
      readFile(new URL("infrastructure/ffprobe/media-probe.ts", root), "utf8"),
      readFile(new URL("lib/media/video-types.ts", root), "utf8"),
      readFile(new URL("components/video-settings-panel.tsx", root), "utf8"),
      readFile(new URL("components/output-format/CodecSelector.tsx", root), "utf8"),
      readFile(new URL("app/api/video/process/route.ts", root), "utf8"),
    ]);
  assert.match(probe, /ffprobeStatic\.path/);
  assert.match(filters, /`scale=-2:\$\{targetHeight\}:flags=lanczos`/);
  assert.match(filters, /`fps=\$\{frameRate\}`/);
  assert.match(argumentsSource, /"libx264"/);
  assert.match(argumentsSource, /"libx265"/);
  assert.match(argumentsSource, /speedPreset === "fast"/);
  assert.match(argumentsSource, /"medium"/);
  assert.match(argumentsSource, /"-progress", "pipe:1"/);
  assert.match(argumentsSource, /compression\.audio === "aac128" \? "128k" : "96k"/);
  assert.match(types, /h264: \{ high: 18, balanced: 23, small: 28 \}/);
  assert.match(types, /h265: \{ high: 22, balanced: 26, small: 30 \}/);
  assert.match(types, /vp9: \{ high: 24, balanced: 31, small: 38 \}/);
  assert.match(types, /VideoFrameRate = "original" \| "24" \| "30" \| "60"/);
  assert.match(panel, /2160p（4K）/);
  assert.match(panel, /元のフレームレートを維持/);
  assert.match(codecSelector, /H\.265/);
  assert.match(codecSelector, /libx265/);
  assert.match(processRoute, /type: "progress"/);
  assert.match(processRoute, /type: "complete"/);
});

test("upload route uses content validation and short-lived output", async () => {
  const [route, validation, config] = await Promise.all([
    readFile(new URL("app/api/process/route.ts", root), "utf8"),
    readFile(new URL("lib/validation/media-validation.ts", root), "utf8"),
    readFile(new URL("lib/config.ts", root), "utf8"),
  ]);
  assert.match(route, /validateUploadedFile/);
  assert.match(route, /scheduleJobCleanup/);
  assert.match(validation, /fileTypeFromFile/);
  assert.match(config, /25 \* MB/);
  assert.match(config, /250 \* MB/);
  assert.match(config, /30 \* 60 \* 1000/);
});

test("image pipeline supports every output format and applies EXIF orientation", async () => {
  const [application, sharpInfrastructure] = await Promise.all([
    readFile(new URL("lib/media/image.ts", root), "utf8"),
    readFile(new URL("infrastructure/sharp/image-service.ts", root), "utf8"),
  ]);
  const source = `${application}\n${sharpInfrastructure}`;
  for (const format of ["png", "jpeg", "webp", "avif", "tiff", "gif"]) {
    assert.match(source, new RegExp(`${format}: async`));
  }
  assert.match(source, /\.autoOrient\(\)/);
  assert.match(source, /compressionLevel: speed === "fast" \? 6 : 9/);
  assert.match(source, /\.jpeg\(\{/);
  assert.match(source, /webp: async/);
  assert.match(source, /avif: async/);
  assert.match(source, /lossless: true, effort/);
  assert.match(source, /speed === "balanced" \? 7/);
  assert.match(source, /透明部分はJPEGで保持できない/);
});

test("API validates format, encoding and quality settings", async () => {
  const route = await readFile(new URL("app/api/process/route.ts", root), "utf8");
  assert.match(route, /isImageOutputFormat/);
  assert.match(route, /isImageEncoding/);
  assert.match(route, /normalizeImageQuality/);
  assert.match(route, /INVALID_OUTPUT_FORMAT/);
  assert.match(route, /INVALID_ENCODING/);
  assert.match(route, /INVALID_QUALITY/);
});

test("image settings UI exposes formats, conditional quality and warnings", async () => {
  const [workspace, constants, definitions, warnings] = await Promise.all([
    readFile(new URL("components/compression-app.tsx", root), "utf8"),
    readFile(new URL("features/workspace/constants.ts", root), "utf8"),
    readFile(new URL("shared/media/output-formats.ts", root), "utf8"),
    readFile(new URL("components/output-format/OutputFormatWarning.tsx", root), "utf8"),
  ]);
  const source = `${workspace}\n${constants}\n${definitions}\n${warnings}`;
  for (const format of ["png", "jpeg", "webp", "avif"]) {
    assert.match(source, new RegExp(`value: "${format}"`));
  }
  assert.match(source, /const showQuality/);
  assert.match(source, /type="range"/);
  assert.match(source, /JPEGは透過に対応していません/);
  assert.match(source, /PNGへ変換するとファイルサイズが大きくなる可能性があります/);
  assert.match(source, /メタデータ削除のみ/);
});

test("runtime capabilities are discovered from FFmpeg and Sharp instead of a fixed extension gate", async () => {
  const [capabilities, validation, inspectRoute] = await Promise.all([
    readFile(new URL("lib/capabilities/runtime-capabilities.ts", root), "utf8"),
    readFile(new URL("lib/validation/media-validation.ts", root), "utf8"),
    readFile(new URL("app/api/media/inspect/route.ts", root), "utf8"),
  ]);
  for (const command of [
    "-formats",
    "-demuxers",
    "-muxers",
    "-decoders",
    "-encoders",
    "-filters",
  ]) {
    assert.match(capabilities, new RegExp(`"${command}"`));
  }
  assert.match(capabilities, /CACHE_MS/);
  assert.match(capabilities, /sharp\.format/);
  assert.match(validation, /fileTypeFromFile/);
  assert.match(validation, /probeMedia/);
  assert.match(validation, /EXECUTABLE_REJECTED/);
  assert.doesNotMatch(validation, /ACCEPTED_EXTENSIONS/);
  assert.match(inspectRoute, /source\.bin/);
});

test("standard enhancement, audio, AI and comparison MVP boundaries are implemented", async () => {
  const [
    image,
    sharpInfrastructure,
    videoApplication,
    videoFilters,
    audio,
    ai,
    aiClient,
    app,
  ] = await Promise.all([
    readFile(new URL("lib/media/image.ts", root), "utf8"),
    readFile(new URL("infrastructure/sharp/image-service.ts", root), "utf8"),
    readFile(new URL("lib/media/video.ts", root), "utf8"),
    readFile(new URL("infrastructure/ffmpeg/video-filters.ts", root), "utf8"),
    readFile(new URL("lib/media/audio.ts", root), "utf8"),
    readFile(new URL("lib/ai/real-esrgan.ts", root), "utf8"),
    readFile(new URL("lib/ai/ai-worker-client.ts", root), "utf8"),
    readFile(new URL("components/compression-app.tsx", root), "utf8"),
  ]);
  const imagePipeline = `${image}\n${sharpInfrastructure}`;
  const video = `${videoApplication}\n${videoFilters}`;
  for (const operation of ["median", "modulate", "linear", "gamma", "sharpen"]) {
    assert.match(imagePipeline, new RegExp(`\\.${operation}`));
  }
  for (const filter of ["hqdn3d", "nlmeans", "unsharp", "cas", "colorspace"]) {
    assert.match(video, new RegExp(filter));
  }
  assert.match(audio, /libmp3lame/);
  assert.match(audio, /libopus/);
  assert.match(audio, /pcm_s16le/);
  assert.match(ai, /runPersistentAiJob/);
  assert.match(aiClient, /shell: false/);
  assert.match(app, /ProcessingModeSelector/);
  assert.match(app, /ImageComparison/);
  assert.match(app, /AudioSettingsPanel/);
});

test("post-MVP AI video, GFPGAN, queue, cancellation, previews and recommendations have safe boundaries", async () => {
  const [worker, videoAi, queue, jobsRoute, mediaRoute, app, mediaClient] =
    await Promise.all([
      readFile(new URL("workers/ai_image_worker.py", root), "utf8"),
      readFile(new URL("lib/media/video-ai.ts", root), "utf8"),
      readFile(new URL("lib/jobs/ai-queue.ts", root), "utf8"),
      readFile(new URL("app/api/jobs/[jobId]/route.ts", root), "utf8"),
      readFile(new URL("app/api/media/inspect/route.ts", root), "utf8"),
      readFile(new URL("components/compression-app.tsx", root), "utf8"),
      readFile(new URL("features/upload/media-client.ts", root), "utf8"),
    ]);
  assert.match(worker, /GFPGANer/);
  assert.match(worker, /run_directory/);
  assert.match(videoAi, /frame-%08d\.png/);
  assert.match(videoAi, /runVideoFramesRealEsrgan/);
  assert.match(videoAi, /rm\(inputFrames, \{ recursive: true, force: true \}\)/);
  assert.match(queue, /AI_MAX_CONCURRENCY/);
  assert.match(jobsRoute, /cancelProcessingJob/);
  assert.match(mediaRoute, /generateVideoPreview/);
  assert.match(mediaRoute, /recommendations/);
  assert.match(app, /おすすめ設定を反映しました/);
  assert.match(`${app}\n${mediaClient}`, /\/api\/jobs\//);
});
