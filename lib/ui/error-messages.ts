const FRIENDLY_ERRORS: Record<string, string> = {
  UNSUPPORTED_FORMAT: "このファイル形式は現在の環境では処理できません。",
  MEDIA_PROBE_FAILED:
    "動画または音声の読み込みに失敗しました。ファイルが破損している可能性があります。",
  IMAGE_PROCESS_FAILED:
    "画像を読み込めませんでした。ファイルが破損している可能性があります。",
  VIDEO_PROCESS_FAILED:
    "動画を変換できませんでした。設定を変更してもう一度お試しください。",
  PROCESS_TIMEOUT:
    "処理が制限時間を超えました。解像度を下げるか、短いファイルでお試しください。",
  AI_TIMEOUT: "AI高画質化が制限時間を超えました。より小さい画像でお試しください。",
  FILE_TOO_LARGE: "ファイルサイズが上限を超えています。",
  EMPTY_FILE: "空のファイルは処理できません。",
  UPLOAD_EXPIRED: "一時保存の期限が切れました。ファイルをもう一度追加してください。",
  FILE_EXPIRED: "ダウンロード期限が切れました。ファイルをもう一度処理してください。",
  CANCELLED: "処理をキャンセルしました。",
};

export function userFriendlyError(code?: string, fallback?: string) {
  if (code && FRIENDLY_ERRORS[code]) return FRIENDLY_ERRORS[code];
  if (fallback && !/[A-Za-z]:\\|\/tmp\/|Error:| at /.test(fallback)) {
    return fallback;
  }
  return "処理を完了できませんでした。設定を確認して、もう一度お試しください。";
}
