import { t, type Locale } from "./i18n";

export const SOURCE_LIMITS = {
  textCharacters: 50_000,
  audioBytes: 25_000_000,
  audioSeconds: 900,
  audioCount: 2,
  imageBytes: 10_000_000,
  imageCount: 8,
} as const;

type UploadCandidate = {
  kind: "audio" | "image";
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
};
const audioTypes = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
]);
const imageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export function validateSourceUpload(
  candidate: UploadCandidate,
  locale: Locale,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!Number.isFinite(candidate.sizeBytes) || candidate.sizeBytes <= 0)
    return {
      ok: false,
      code: "empty_file",
      message: t(locale, "error.emptyFile"),
    };
  if (candidate.kind === "audio") {
    if (!audioTypes.has(candidate.mimeType))
      return {
        ok: false,
        code: "audio_type",
        message: t(locale, "error.audioType"),
      };
    if (candidate.sizeBytes > SOURCE_LIMITS.audioBytes)
      return {
        ok: false,
        code: "audio_size",
        message: t(locale, "error.audioSize"),
      };
    if (
      candidate.durationSeconds === undefined ||
      candidate.durationSeconds > SOURCE_LIMITS.audioSeconds
    )
      return {
        ok: false,
        code: "audio_duration",
        message: t(locale, "error.audioLength"),
      };
  } else {
    if (!imageTypes.has(candidate.mimeType))
      return {
        ok: false,
        code: "image_type",
        message: t(locale, "error.imageType"),
      };
    if (candidate.sizeBytes > SOURCE_LIMITS.imageBytes)
      return {
        ok: false,
        code: "image_size",
        message: t(locale, "error.imageSize"),
      };
  }
  return { ok: true };
}
