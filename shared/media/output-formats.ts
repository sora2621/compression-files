export type MediaCategory = "image" | "video" | "audio";

export type ImageOutputFormatValue = "jpeg" | "png" | "webp" | "avif" | "tiff" | "gif";
export type VideoOutputFormatValue = "mp4" | "webm" | "mkv" | "mov";
export type AudioOutputFormatValue =
  "mp3" | "m4a" | "aac" | "opus" | "ogg" | "wav" | "flac";
export type OutputFormatValue =
  ImageOutputFormatValue | VideoOutputFormatValue | AudioOutputFormatValue;
export type OutputFormatForCategory<C extends MediaCategory> = C extends "image"
  ? ImageOutputFormatValue
  : C extends "video"
    ? VideoOutputFormatValue
    : AudioOutputFormatValue;

export type OutputFormatRecommendation =
  "互換性重視" | "容量重視" | "画質重視" | "透過対応" | "編集向け" | "長期保存向け";

export type OutputFormatDefinition = {
  value: OutputFormatValue;
  extension: string;
  mediaCategory: MediaCategory;
  mimeType: string;
  label: string;
  description: string;
  compatibility: "高" | "中" | "限定的";
  estimatedSize: "小さめ" | "標準" | "大きめ";
  estimatedTime: "速い" | "標準" | "遅め";
  recommendations: OutputFormatRecommendation[];
  supportedVideoCodecs?: string[];
  supportedAudioCodecs?: string[];
  supportsTransparency?: boolean;
  supportsLossless?: boolean;
  ffmpegMuxers?: string[];
  ffmpegEncoders?: string[];
};

export const OUTPUT_FORMAT_DEFINITIONS = [
  {
    value: "jpeg",
    extension: "jpg",
    mediaCategory: "image",
    mimeType: "image/jpeg",
    label: "JPEG",
    description: "写真向け。幅広い環境で表示できますが透過には非対応です。",
    compatibility: "高",
    estimatedSize: "標準",
    estimatedTime: "速い",
    recommendations: ["互換性重視"],
    supportsTransparency: false,
    supportsLossless: false,
  },
  {
    value: "png",
    extension: "png",
    mediaCategory: "image",
    mimeType: "image/png",
    label: "PNG",
    description: "透過対応の可逆形式。写真では容量が大きくなることがあります。",
    compatibility: "高",
    estimatedSize: "大きめ",
    estimatedTime: "標準",
    recommendations: ["画質重視", "透過対応", "編集向け"],
    supportsTransparency: true,
    supportsLossless: true,
  },
  {
    value: "webp",
    extension: "webp",
    mediaCategory: "image",
    mimeType: "image/webp",
    label: "WebP",
    description: "Web向けの高圧縮形式。透過と可逆圧縮にも対応します。",
    compatibility: "高",
    estimatedSize: "小さめ",
    estimatedTime: "標準",
    recommendations: ["容量重視", "透過対応"],
    supportsTransparency: true,
    supportsLossless: true,
  },
  {
    value: "avif",
    extension: "avif",
    mediaCategory: "image",
    mimeType: "image/avif",
    label: "AVIF",
    description: "高い圧縮率と画質を両立しますが、処理時間は長めです。",
    compatibility: "中",
    estimatedSize: "小さめ",
    estimatedTime: "遅め",
    recommendations: ["容量重視", "画質重視", "透過対応"],
    supportsTransparency: true,
    supportsLossless: true,
  },
  {
    value: "tiff",
    extension: "tiff",
    mediaCategory: "image",
    mimeType: "image/tiff",
    label: "TIFF",
    description: "編集や保存向けの可逆形式。ブラウザー互換性は限定的です。",
    compatibility: "限定的",
    estimatedSize: "大きめ",
    estimatedTime: "標準",
    recommendations: ["編集向け", "長期保存向け"],
    supportsTransparency: true,
    supportsLossless: true,
  },
  {
    value: "gif",
    extension: "gif",
    mediaCategory: "image",
    mimeType: "image/gif",
    label: "GIF",
    description: "短いアニメーション向け。色数は最大256色です。",
    compatibility: "高",
    estimatedSize: "大きめ",
    estimatedTime: "標準",
    recommendations: ["互換性重視"],
    supportsTransparency: true,
    supportsLossless: false,
  },
  {
    value: "mp4",
    extension: "mp4",
    mediaCategory: "video",
    mimeType: "video/mp4",
    label: "MP4",
    description: "再生互換性を重視する動画の標準的なコンテナです。",
    compatibility: "高",
    estimatedSize: "標準",
    estimatedTime: "標準",
    recommendations: ["互換性重視"],
    supportedVideoCodecs: ["h264", "h265", "av1"],
    supportedAudioCodecs: ["aac"],
    ffmpegMuxers: ["mp4"],
  },
  {
    value: "webm",
    extension: "webm",
    mediaCategory: "video",
    mimeType: "video/webm",
    label: "WebM",
    description: "Web配信向け。VP9/AV1とOpus/Vorbisを使用します。",
    compatibility: "中",
    estimatedSize: "小さめ",
    estimatedTime: "遅め",
    recommendations: ["容量重視"],
    supportedVideoCodecs: ["vp9", "av1"],
    supportedAudioCodecs: ["opus", "vorbis"],
    ffmpegMuxers: ["webm"],
  },
  {
    value: "mkv",
    extension: "mkv",
    mediaCategory: "video",
    mimeType: "video/x-matroska",
    label: "Matroska",
    description: "多数の映像・音声コーデックを格納できる柔軟なコンテナです。",
    compatibility: "中",
    estimatedSize: "標準",
    estimatedTime: "標準",
    recommendations: ["編集向け", "長期保存向け"],
    supportedVideoCodecs: ["h264", "h265", "vp9", "av1"],
    supportedAudioCodecs: ["aac", "opus", "flac"],
    ffmpegMuxers: ["matroska"],
  },
  {
    value: "mov",
    extension: "mov",
    mediaCategory: "video",
    mimeType: "video/quicktime",
    label: "QuickTime",
    description: "映像編集やApple製品との連携に向くコンテナです。",
    compatibility: "中",
    estimatedSize: "大きめ",
    estimatedTime: "標準",
    recommendations: ["編集向け"],
    supportedVideoCodecs: ["h264", "h265"],
    supportedAudioCodecs: ["aac", "pcm"],
    ffmpegMuxers: ["mov"],
  },
  {
    value: "mp3",
    extension: "mp3",
    mediaCategory: "audio",
    mimeType: "audio/mpeg",
    label: "MP3",
    description: "最も広く再生できる非可逆音声形式です。",
    compatibility: "高",
    estimatedSize: "標準",
    estimatedTime: "速い",
    recommendations: ["互換性重視"],
    ffmpegMuxers: ["mp3"],
    ffmpegEncoders: ["libmp3lame"],
  },
  {
    value: "m4a",
    extension: "m4a",
    mediaCategory: "audio",
    mimeType: "audio/mp4",
    label: "M4A",
    description: "AAC音声をMP4系コンテナへ格納し、高い互換性を提供します。",
    compatibility: "高",
    estimatedSize: "小さめ",
    estimatedTime: "速い",
    recommendations: ["互換性重視", "容量重視"],
    ffmpegMuxers: ["ipod", "mp4"],
    ffmpegEncoders: ["aac"],
  },
  {
    value: "aac",
    extension: "aac",
    mediaCategory: "audio",
    mimeType: "audio/aac",
    label: "AAC",
    description: "配信やモバイル向けの生AAC音声です。",
    compatibility: "中",
    estimatedSize: "小さめ",
    estimatedTime: "速い",
    recommendations: ["容量重視"],
    ffmpegMuxers: ["adts", "aac"],
    ffmpegEncoders: ["aac"],
  },
  {
    value: "opus",
    extension: "opus",
    mediaCategory: "audio",
    mimeType: "audio/opus",
    label: "Opus",
    description: "低ビットレートでも高品質な音声形式です。",
    compatibility: "中",
    estimatedSize: "小さめ",
    estimatedTime: "標準",
    recommendations: ["容量重視"],
    ffmpegMuxers: ["opus", "ogg"],
    ffmpegEncoders: ["libopus"],
  },
  {
    value: "ogg",
    extension: "ogg",
    mediaCategory: "audio",
    mimeType: "audio/ogg",
    label: "Ogg",
    description: "オープンなOggコンテナへVorbis音声を格納します。",
    compatibility: "中",
    estimatedSize: "小さめ",
    estimatedTime: "標準",
    recommendations: ["容量重視"],
    ffmpegMuxers: ["ogg"],
    ffmpegEncoders: ["libvorbis"],
  },
  {
    value: "wav",
    extension: "wav",
    mediaCategory: "audio",
    mimeType: "audio/wav",
    label: "WAV",
    description: "無圧縮PCMで編集互換性を優先します。",
    compatibility: "高",
    estimatedSize: "大きめ",
    estimatedTime: "速い",
    recommendations: ["画質重視", "編集向け"],
    supportsLossless: true,
    ffmpegMuxers: ["wav"],
    ffmpegEncoders: ["pcm_s16le"],
  },
  {
    value: "flac",
    extension: "flac",
    mediaCategory: "audio",
    mimeType: "audio/flac",
    label: "FLAC",
    description: "音質を変えずに圧縮できる長期保存向け形式です。",
    compatibility: "中",
    estimatedSize: "大きめ",
    estimatedTime: "標準",
    recommendations: ["画質重視", "長期保存向け"],
    supportsLossless: true,
    ffmpegMuxers: ["flac"],
    ffmpegEncoders: ["flac"],
  },
] as const satisfies readonly OutputFormatDefinition[];

export function getOutputFormatDefinition(
  value: unknown,
): OutputFormatDefinition | undefined {
  return OUTPUT_FORMAT_DEFINITIONS.find((definition) => definition.value === value) as
    OutputFormatDefinition | undefined;
}

export function getOutputFormatsForCategory(
  category: MediaCategory,
): OutputFormatDefinition[] {
  return OUTPUT_FORMAT_DEFINITIONS.filter(
    (definition) => definition.mediaCategory === category,
  ) as OutputFormatDefinition[];
}

export function isOutputFormatForCategory<C extends MediaCategory>(
  value: unknown,
  category: C,
): value is OutputFormatForCategory<C> {
  return getOutputFormatsForCategory(category).some(
    (definition) => definition.value === value,
  );
}

export function isVideoCodecAllowed(container: unknown, codec: unknown) {
  const definition = getOutputFormatDefinition(container);
  return Boolean(
    definition?.mediaCategory === "video" &&
    definition.supportedVideoCodecs?.includes(String(codec)),
  );
}

export function isVideoAudioCodecAllowed(container: unknown, codec: unknown) {
  const definition = getOutputFormatDefinition(container);
  return Boolean(
    definition?.mediaCategory === "video" &&
    definition.supportedAudioCodecs?.includes(String(codec)),
  );
}
