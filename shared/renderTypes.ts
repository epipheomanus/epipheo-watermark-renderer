// Epipheo Export Settings
export const EXPORT_SETTINGS = {
  resolution: "1920x1080",
  width: 1920,
  height: 1080,
  frameRate: 24,
  videoCodec: "libx264",
  videoBitrate: "8500k",
  audioCodec: "aac",
  audioBitrate: "320k",
  audioSampleRate: 48000,
  audioChannels: 2,
} as const;

// Watermark CDN URL (baked into server)
export const WATERMARK_CDN_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663399583707/2nykAy8pPfsfSbfgiWZZ8L/EpipheoWatermarkLogo_Left_v2_c64a3364.png";
export const WATERMARK_FILENAME = "EpipheoWatermarkLogo_Left_v2.png";

// Render job statuses
export type RenderStatus = "pending" | "downloading" | "processing" | "complete" | "error";

export interface RenderJob {
  id: string;
  status: RenderStatus;
  progress: number; // 0-100
  message: string;
  outputFilename?: string;
  createdAt: number;
  error?: string;
}

// Supported video extensions
export const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm"];
// Supported audio extensions
export const AUDIO_EXTENSIONS = [".wav", ".mp3", ".aac", ".m4a", ".ogg"];

// Max file sizes (in bytes)
export const MAX_VIDEO_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
export const MAX_AUDIO_SIZE = 500 * 1024 * 1024; // 500MB

// Temp file cleanup interval (1 hour)
export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const FILE_MAX_AGE_MS = 60 * 60 * 1000;
