import sharp from "sharp";

import { MAX_IMAGE_INPUT_PIXELS } from "@/lib/config";
import { normalizeProcessingSpeedPreset } from "@/lib/processing/types";

import type {
  ImageEncoding,
  ImageEnhancementOptions,
  ImageOutputFormat,
} from "@/lib/media/image-types";

export interface SharpImageMetadata {
  format: string | undefined;
  width: number | undefined;
  height: number | undefined;
  pageHeight: number | undefined;
  pages: number | undefined;
  orientation: number | undefined;
  hasAlpha: boolean | undefined;
}

export interface SharpImageEncodingRequest {
  inputPath: string;
  outputPath: string;
  outputFormat: ImageOutputFormat;
  encoding: ImageEncoding;
  quality: number;
  maxDimension?: number | null;
  jpegBackgroundColor?: string;
  enhancements?: ImageEnhancementOptions;
  warnings: string[];
  sourceMetadata?: SharpImageMetadata;
  speedPreset?: import("@/lib/processing/types").ProcessingSpeedPreset;
}

type SharpImageEncoder = (
  pipeline: sharp.Sharp,
  request: SharpImageEncodingRequest,
) => Promise<void>;

export const IMAGE_OUTPUT_DETAILS: Record<
  ImageOutputFormat,
  { extension: string; mime: string }
> = {
  png: { extension: ".png", mime: "image/png" },
  jpeg: { extension: ".jpg", mime: "image/jpeg" },
  webp: { extension: ".webp", mime: "image/webp" },
  avif: { extension: ".avif", mime: "image/avif" },
  tiff: { extension: ".tiff", mime: "image/tiff" },
  gif: { extension: ".gif", mime: "image/gif" },
};

function openSharpImage(inputPath: string, animated: boolean) {
  return sharp(inputPath, {
    animated,
    failOn: "error",
    limitInputPixels: MAX_IMAGE_INPUT_PIXELS,
    sequentialRead: true,
    unlimited: false,
  });
}

export async function getSharpImageMetadata(
  inputPath: string,
  animated = true,
): Promise<SharpImageMetadata> {
  const metadata = await openSharpImage(inputPath, animated).metadata();
  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    pageHeight: metadata.pageHeight,
    pages: metadata.pages,
    orientation: metadata.orientation,
    hasAlpha: metadata.hasAlpha,
  };
}

async function createEnhancedPipeline(
  inputPath: string,
  enhancements: ImageEnhancementOptions | undefined,
  source: SharpImageMetadata,
  warnings: string[],
) {
  const isAnimated = (source.pages ?? 1) > 1;
  let pipeline = openSharpImage(inputPath, isAnimated);
  if (enhancements?.autoRotate !== false) pipeline = pipeline.autoOrient();
  if (enhancements?.normalizeColorSpace) {
    pipeline = pipeline.toColourspace("srgb").withIccProfile("srgb");
  } else {
    pipeline = pipeline.keepIccProfile();
  }

  if (enhancements && enhancements.denoise > 0) {
    if (isAnimated) {
      warnings.push(
        "アニメーションのフレーム保持を優先し、通常ノイズ軽減は適用しませんでした。",
      );
    } else {
      const kernel = enhancements.denoise <= 3 ? 3 : enhancements.denoise <= 7 ? 5 : 7;
      if (source.hasAlpha) {
        let alpha = openSharpImage(inputPath, false);
        if (enhancements.autoRotate !== false) alpha = alpha.autoOrient();
        const alphaBuffer = await alpha.extractChannel("alpha").png().toBuffer();
        pipeline = pipeline.removeAlpha().median(kernel).joinChannel(alphaBuffer);
      } else {
        pipeline = pipeline.median(kernel);
      }
    }
  }
  if (enhancements && enhancements.gamma !== 1) {
    pipeline = pipeline.gamma(2.2, enhancements.gamma);
  }
  if (enhancements && (enhancements.brightness !== 1 || enhancements.saturation !== 1)) {
    pipeline = pipeline.modulate({
      brightness: enhancements.brightness,
      saturation: enhancements.saturation,
    });
  }
  if (enhancements && enhancements.contrast !== 1) {
    pipeline = pipeline.linear(enhancements.contrast, 128 * (1 - enhancements.contrast));
  }
  if (enhancements?.sharpen) {
    pipeline = pipeline.sharpen({ sigma: 1, m1: 1.2, m2: 2 });
  }
  return pipeline;
}

const IMAGE_ENCODERS: Record<ImageOutputFormat, SharpImageEncoder> = {
  png: async (pipeline, request) => {
    const speed = normalizeProcessingSpeedPreset(request.speedPreset);
    await pipeline
      .png({
        compressionLevel: speed === "fast" ? 6 : 9,
        adaptiveFiltering: true,
        palette: false,
      })
      .toFile(request.outputPath);
  },
  jpeg: async (pipeline, request) => {
    const speed = normalizeProcessingSpeedPreset(request.speedPreset);
    await pipeline
      .jpeg({
        quality: request.quality,
        chromaSubsampling: request.quality >= 90 ? "4:4:4" : "4:2:0",
        mozjpeg: speed !== "fast",
      })
      .toFile(request.outputPath);
  },
  webp: async (pipeline, request) => {
    const speed = normalizeProcessingSpeedPreset(request.speedPreset);
    const effort = speed === "fast" ? 3 : 6;
    await pipeline
      .webp(
        request.encoding === "lossless"
          ? { lossless: true, effort }
          : {
              lossless: false,
              quality: request.quality,
              effort,
              smartSubsample: true,
            },
      )
      .toFile(request.outputPath);
  },
  avif: async (pipeline, request) => {
    const speed = normalizeProcessingSpeedPreset(request.speedPreset);
    const effort = speed === "fast" ? 3 : speed === "maximum-compression" ? 8 : 6;
    await pipeline
      .avif(
        request.encoding === "lossless"
          ? { lossless: true, effort: speed === "balanced" ? 7 : effort }
          : {
              lossless: false,
              quality: request.quality,
              effort,
              chromaSubsampling: "4:2:0",
            },
      )
      .toFile(request.outputPath);
  },
  tiff: async (pipeline, request) => {
    await pipeline
      .tiff({ compression: "lzw", predictor: "horizontal" })
      .toFile(request.outputPath);
  },
  gif: async (pipeline, request) => {
    const speed = normalizeProcessingSpeedPreset(request.speedPreset);
    await pipeline
      .gif({
        effort: speed === "fast" ? 3 : speed === "maximum-compression" ? 10 : 7,
        colours: 256,
        dither: 1,
        interFrameMaxError: 0,
      })
      .toFile(request.outputPath);
    request.warnings.push(
      "GIFは最大256色に量子化されるため、完全な無劣化ではありません。",
    );
  },
};

export async function encodeImageWithSharp(request: SharpImageEncodingRequest) {
  const sourceMetadata =
    request.sourceMetadata ?? (await getSharpImageMetadata(request.inputPath));
  let pipeline = await createEnhancedPipeline(
    request.inputPath,
    request.enhancements,
    sourceMetadata,
    request.warnings,
  );
  const hasAlpha = sourceMetadata.hasAlpha === true;
  if (request.outputFormat === "jpeg" && hasAlpha) {
    const background = /^#[0-9a-f]{6}$/i.test(request.jpegBackgroundColor ?? "")
      ? request.jpegBackgroundColor
      : "#ffffff";
    pipeline = pipeline.flatten({ background });
    request.warnings.push(
      `透明部分はJPEGで保持できないため、背景色${background}に合成しました。`,
    );
  }
  if (request.maxDimension !== null && request.maxDimension !== undefined) {
    pipeline = pipeline.resize({
      width: request.maxDimension,
      height: request.maxDimension,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  await IMAGE_ENCODERS[request.outputFormat](pipeline, request);
  return { sourceMetadata, hasAlpha };
}

export async function prepareSharpAiInput(
  inputPath: string,
  outputPath: string,
  enhancements: ImageEnhancementOptions | undefined,
  sourceMetadata: SharpImageMetadata,
  warnings: string[],
) {
  const pipeline = await createEnhancedPipeline(
    inputPath,
    enhancements,
    sourceMetadata,
    warnings,
  );
  await pipeline.png({ compressionLevel: 6 }).toFile(outputPath);
}

export async function createSharpPreview(inputPath: string, outputPath: string) {
  await openSharpImage(inputPath, false)
    .webp({ quality: 86, effort: 4 })
    .toFile(outputPath);
}
