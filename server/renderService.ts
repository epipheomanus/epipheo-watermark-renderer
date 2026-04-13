import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import http from "http";
import { fileURLToPath } from "url";
import { EXPORT_SETTINGS, WATERMARK_CDN_URL, WATERMARK_FILENAME, FILE_MAX_AGE_MS, CLEANUP_INTERVAL_MS } from "../shared/renderTypes";
import type { RenderJob } from "../shared/renderTypes";

// In-memory job store
const jobs = new Map<string, RenderJob>();

// Temp directory for all render work
const WORK_DIR = path.join(os.tmpdir(), "epipheo-renders");

// Ensure work directory exists
if (!fs.existsSync(WORK_DIR)) {
  fs.mkdirSync(WORK_DIR, { recursive: true });
}

// Watermark: prefer local bundled asset, fallback to CDN download
const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = path.dirname(__filename_local);
const WATERMARK_BUNDLED = path.join(__dirname_local, "assets", WATERMARK_FILENAME);
const WATERMARK_LOCAL = path.join(WORK_DIR, WATERMARK_FILENAME);

export function getJob(id: string): RenderJob | undefined {
  return jobs.get(id);
}

export function createJob(id: string): RenderJob {
  const job: RenderJob = {
    id,
    status: "pending",
    progress: 0,
    message: "Job created, waiting to start...",
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

function updateJob(id: string, updates: Partial<RenderJob>) {
  const job = jobs.get(id);
  if (job) {
    Object.assign(job, updates);
  }
}

// Download a file from URL to a local path (follows redirects)
function downloadFile(url: string, dest: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error("Too many redirects"));
      return;
    }
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith("https") ? https : http;
    const request = protocol.get(url, { headers: { "User-Agent": "EpipheoRenderer/1.0" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        downloadFile(response.headers.location, dest, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode && response.statusCode >= 400) {
        file.close();
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(new Error(`Download failed with status ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolve();
      });
    });
    request.on("error", (err) => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
    request.setTimeout(300000, () => {
      request.destroy();
      reject(new Error("Download timed out after 5 minutes"));
    });
  });
}

// Normalize URLs to direct download links
export function normalizeUrl(url: string): string {
  // Google Drive: convert share link to direct download
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (driveMatch) {
    return `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
  }

  // Dropbox: switch to direct download
  if (url.includes("dropbox.com")) {
    return url.replace(/dl=0/, "dl=1").replace(/\?dl=0/, "?dl=1");
  }

  // Markup.io: extract direct media URL from markup.io share links
  // Markup.io URLs typically look like: https://app.markup.io/share/xxxxx
  // The actual media is served from their CDN; we attempt to extract it
  if (url.includes("markup.io")) {
    // If it's already a direct file URL from markup CDN, use as-is
    if (url.match(/\.(mp4|mov|avi|wav|mp3|aac)(\?|$)/i)) {
      return url;
    }
    // For share links, we'll try the URL as-is and let the download handler follow redirects
    return url;
  }

  return url;
}

// Ensure watermark is available locally
async function ensureWatermark(): Promise<string> {
  // First check bundled local asset
  if (fs.existsSync(WATERMARK_BUNDLED)) {
    return WATERMARK_BUNDLED;
  }
  // Then check cached copy in work dir
  if (fs.existsSync(WATERMARK_LOCAL)) {
    return WATERMARK_LOCAL;
  }
  // Fallback: download from CDN
  console.log("[Watermark] Bundled asset not found, downloading from CDN...");
  await downloadFile(WATERMARK_CDN_URL, WATERMARK_LOCAL);
  return WATERMARK_LOCAL;
}

// Get video duration using ffprobe
function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let output = "";
    proc.stdout.on("data", (data) => { output += data.toString(); });
    proc.stderr.on("data", () => {});
    proc.on("close", (code) => {
      if (code === 0) {
        const duration = parseFloat(output.trim());
        resolve(isNaN(duration) ? 0 : duration);
      } else {
        resolve(0);
      }
    });
    proc.on("error", () => resolve(0));
  });
}

// Main render function
export async function startRender(
  jobId: string,
  videoInput: { type: "file"; path: string } | { type: "url"; url: string },
  audioInput: { type: "file"; path: string } | { type: "url"; url: string },
): Promise<void> {
  const jobDir = path.join(WORK_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    updateJob(jobId, { status: "downloading", progress: 5, message: "Preparing input files..." });

    let videoPath: string;
    let audioPath: string;

    if (videoInput.type === "url") {
      updateJob(jobId, { progress: 10, message: "Downloading video file..." });
      const normalizedUrl = normalizeUrl(videoInput.url);
      videoPath = path.join(jobDir, "input_video.mp4");
      await downloadFile(normalizedUrl, videoPath);
    } else {
      videoPath = videoInput.path;
    }

    // Validate video file exists and has content
    if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) {
      throw new Error("Video file is empty or could not be downloaded");
    }

    if (audioInput.type === "url") {
      updateJob(jobId, { progress: 20, message: "Downloading audio file..." });
      const normalizedUrl = normalizeUrl(audioInput.url);
      audioPath = path.join(jobDir, "input_audio.wav");
      await downloadFile(normalizedUrl, audioPath);
    } else {
      audioPath = audioInput.path;
    }

    // Validate audio file exists and has content
    if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
      throw new Error("Audio file is empty or could not be downloaded");
    }

    updateJob(jobId, { progress: 25, message: "Preparing watermark overlay..." });
    const watermarkPath = await ensureWatermark();

    const duration = await getVideoDuration(videoPath);

    updateJob(jobId, { status: "processing", progress: 30, message: "Rendering video with watermark and audio..." });

    const outputFilename = `watermark_draft_${jobId}.mp4`;
    const outputPath = path.join(jobDir, outputFilename);

    await new Promise<void>((resolve, reject) => {
      const args = [
        "-y",
        "-i", videoPath,
        "-i", audioPath,
        "-loop", "1", "-i", watermarkPath,
        "-filter_complex", "[0:v][2:v]overlay=0:0:shortest=1[outv]",
        "-map", "[outv]",
        "-map", "1:a",
        "-c:v", EXPORT_SETTINGS.videoCodec,
        "-b:v", EXPORT_SETTINGS.videoBitrate,
        "-r", String(EXPORT_SETTINGS.frameRate),
        "-s", EXPORT_SETTINGS.resolution,
        "-pix_fmt", "yuv420p",
        "-profile:v", "high",
        "-level", "4.1",
        "-c:a", EXPORT_SETTINGS.audioCodec,
        "-b:a", EXPORT_SETTINGS.audioBitrate,
        "-ar", String(EXPORT_SETTINGS.audioSampleRate),
        "-ac", String(EXPORT_SETTINGS.audioChannels),
        "-shortest",
        "-movflags", "+faststart",
        outputPath,
      ];

      const ffmpeg = spawn("ffmpeg", args);
      let stderrData = "";

      ffmpeg.stderr.on("data", (data) => {
        stderrData += data.toString();
        if (duration > 0) {
          const timeMatch = data.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
          if (timeMatch) {
            const currentTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseFloat(timeMatch[3]);
            const renderProgress = Math.min(95, 30 + (currentTime / duration) * 65);
            updateJob(jobId, {
              progress: Math.round(renderProgress),
              message: `Rendering: ${Math.round((currentTime / duration) * 100)}% complete...`,
            });
          }
        }
      });

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderrData.slice(-500)}`));
        }
      });

      ffmpeg.on("error", (err) => {
        reject(new Error(`FFmpeg failed to start: ${err.message}`));
      });
    });

    // Verify output file was created
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error("Output file was not created or is empty");
    }

    updateJob(jobId, {
      status: "complete",
      progress: 100,
      message: "Render complete! Your watermarked draft is ready to download.",
      outputFilename,
    });
  } catch (error: any) {
    updateJob(jobId, {
      status: "error",
      progress: 0,
      message: `Render failed: ${error.message}`,
      error: error.message,
    });
  }
}

// Get the output file path for download
export function getOutputPath(jobId: string): string | null {
  const job = jobs.get(jobId);
  if (!job || job.status !== "complete" || !job.outputFilename) return null;
  const filePath = path.join(WORK_DIR, jobId, job.outputFilename);
  return fs.existsSync(filePath) ? filePath : null;
}

// Cleanup old files periodically
function cleanupOldFiles() {
  try {
    if (!fs.existsSync(WORK_DIR)) return;
    const entries = fs.readdirSync(WORK_DIR);
    const now = Date.now();
    for (const entry of entries) {
      if (entry === WATERMARK_FILENAME) continue;
      const entryPath = path.join(WORK_DIR, entry);
      const stat = fs.statSync(entryPath);
      if (now - stat.mtimeMs > FILE_MAX_AGE_MS) {
        fs.rmSync(entryPath, { recursive: true, force: true });
        jobs.delete(entry);
      }
    }
  } catch (err) {
    console.error("[Cleanup] Error:", err);
  }
}

setInterval(cleanupOldFiles, CLEANUP_INTERVAL_MS);
