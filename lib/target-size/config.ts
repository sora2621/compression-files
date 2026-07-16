import type {
  TargetSizeOptions,
  TargetSizePresetDefinition,
  TargetSizePresetId,
} from "./types";

const MB = 1024 * 1024;

function configuredMegabytes(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.round(value * MB) : fallback * MB;
}

export const TARGET_SIZE_PRESETS: Record<TargetSizePresetId, TargetSizePresetDefinition> =
  {
    email: {
      id: "email",
      label: "メール添付用",
      description: "メールサービスで扱いやすい容量",
      targetBytes: configuredMegabytes("TARGET_PRESET_EMAIL_MB", 10),
      targetRatio: null,
    },
    social: {
      id: "social",
      label: "SNS共有用",
      description: "投稿やメッセージ共有向け",
      targetBytes: configuredMegabytes("TARGET_PRESET_SOCIAL_MB", 50),
      targetRatio: null,
    },
    website: {
      id: "website",
      label: "Webサイト掲載用",
      description: "ページ表示速度を重視",
      targetBytes: configuredMegabytes("TARGET_PRESET_WEBSITE_MB", 5),
      targetRatio: null,
    },
    smartphone: {
      id: "smartphone",
      label: "スマートフォン保存用",
      description: "画質と端末容量のバランス",
      targetBytes: configuredMegabytes("TARGET_PRESET_SMARTPHONE_MB", 100),
      targetRatio: null,
    },
    cloud: {
      id: "cloud",
      label: "クラウド保存用",
      description: "元の75%を目安に保存",
      targetBytes: null,
      targetRatio: 0.75,
    },
    half: {
      id: "half",
      label: "元容量の半分",
      description: "元ファイルの50%以下",
      targetBytes: null,
      targetRatio: 0.5,
    },
    "under-100mb": {
      id: "under-100mb",
      label: "100MB以下",
      description: "アップロード上限対策",
      targetBytes: configuredMegabytes("TARGET_PRESET_100_MB", 100),
      targetRatio: null,
    },
    custom: {
      id: "custom",
      label: "カスタム",
      description: "数値と単位を指定",
      targetBytes: configuredMegabytes("TARGET_PRESET_CUSTOM_MB", 25),
      targetRatio: null,
    },
  };

export const TARGET_SIZE_LIMITS = {
  safetyMarginRatio: Number(process.env.TARGET_SIZE_SAFETY_MARGIN_RATIO ?? 0.03),
  containerOverheadRatio: Number(
    process.env.TARGET_SIZE_CONTAINER_OVERHEAD_RATIO ?? 0.015,
  ),
  imageToleranceRatio: Number(process.env.TARGET_SIZE_IMAGE_TOLERANCE_RATIO ?? 0.02),
  imageMaxAttempts: Number(process.env.TARGET_SIZE_IMAGE_MAX_ATTEMPTS ?? 8),
  minimumVideoKbps: Number(process.env.TARGET_SIZE_MIN_VIDEO_KBPS ?? 180),
  sampleSeconds: Number(process.env.TARGET_SIZE_SAMPLE_SECONDS ?? 3),
} as const;

export const AUDIO_BITRATE_CANDIDATES_KBPS = [320, 256, 192, 128, 96, 64] as const;
export const VIDEO_HEIGHT_CANDIDATES = [2160, 1440, 1080, 720, 480] as const;

export const DEFAULT_TARGET_SIZE_OPTIONS: TargetSizeOptions = {
  enabled: false,
  presetId: "half",
  targetBytes: null,
  targetRatio: 0.5,
  unit: "MB",
  audioMode: "auto",
  allowResolutionChange: false,
  allowLossyForPng: false,
  jpegBackground: null,
  minimumQuality: {
    jpeg: 60,
    webp: 55,
    avif: 45,
    videoHeight: 480,
    audioKbps: 64,
  },
};
