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

  // Markup.io: if it's already a direct media.markup.io file URL, use as-is
  if (url.includes("media.markup.io") && url.match(/\.(mp4|mov|avi|wav|mp3|aac)(\?|$)/i)) {
    return url;
  }

  return url;
}

// Check if a URL is a Markup.io share link that needs resolution
export function isMarkupShareLink(url: string): boolean {
  return /app\.markup\.io\/(markup|share)\//.test(url);
}

// Resolve a Markup.io share link to a direct media URL by fetching the page
async function resolveMarkupUrl(shareUrl: string): Promise<string> {
  console.log(`[Markup.io] Resolving share link: ${shareUrl}`);
  const html = await fetchPageHtml(shareUrl);
  
  // Look for media.markup.io video URLs in the HTML/JS bundle
  const mediaMatch = html.match(/https:\/\/media\.markup\.io\/[^"'\s]+\.mp4/i);
  if (mediaMatch) {
    console.log(`[Markup.io] Found direct media URL: ${mediaMatch[0]}`);
    return mediaMatch[0];
  }

  // Look for media.markup.io audio URLs
  const audioMatch = html.match(/https:\/\/media\.markup\.io\/[^"'\s]+\.(wav|mp3|aac)/i);
  if (audioMatch) {
    console.log(`[Markup.io] Found direct audio URL: ${audioMatch[0]}`);
    return audioMatch[0];
  }

  throw new Error(
    "Could not extract the media URL from this Markup.io link. " +
    "Markup.io loads content dynamically. In Markup.io, right-click directly on the video player " +
    "and select 'Copy video address', then paste that direct media URL here instead."
  );
}

// Fetch page HTML (follows redirects)
function fetchPageHtml(url: string, maxRedirects = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      reject(new Error("Too many redirects"));
      return;
    }
    const protocol = url.startsWith("https") ? https : http;
    const request = protocol.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fetchPageHtml(response.headers.location, maxRedirects - 1).then(resolve).catch(reject);
        return;
      }
      let data = "";
      response.on("data", (chunk) => { data += chunk.toString(); });
      response.on("end", () => resolve(data));
    });
    request.on("error", reject);
    request.setTimeout(30000, () => {
      request.destroy();
      reject(new Error("Page fetch timed out"));
    });
  });
}

// Validate that a downloaded file is actual media (not HTML or garbage)
function validateMediaFile(filePath: string, expectedType: "video" | "audio"): Promise<void> {
  return new Promise((resolve, reject) => {
    // Quick check: read first few bytes to detect HTML
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(256);
    fs.readSync(fd, buf, 0, 256, 0);
    fs.closeSync(fd);
    const header = buf.toString("utf8", 0, 256).trim().toLowerCase();

    if (header.startsWith("<!doctype") || header.startsWith("<html") || header.startsWith("<head")) {
      reject(new Error(
        `The downloaded ${expectedType} file is an HTML page, not a media file. ` +
        "This usually means the URL is a share/preview page rather than a direct download link. " +
        "For Markup.io: right-click directly on the video player and select 'Copy video address'. " +
        "For Google Drive: make sure the file is shared publicly."
      ));
      return;
    }

    // Use ffprobe to verify it's valid media
    const proc = spawn("ffprobe", ["-v", "error", "-show_entries", "format=format_name", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
    let output = "";
    let errOutput = "";
    proc.stdout.on("data", (data) => { output += data.toString(); });
    proc.stderr.on("data", (data) => { errOutput += data.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(
          `The downloaded ${expectedType} file appears to be corrupted or is not a valid media file. ` +
          `FFprobe error: ${errOutput.slice(0, 200)}. ` +
          "Please verify the URL points to a direct downloadable file."
        ));
      } else {
        resolve();
      }
    });
    proc.on("error", () => resolve()); // If ffprobe isn't available, skip validation
  });
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
      updateJob(jobId, { progress: 5, message: "Resolving video URL..." });
      let resolvedUrl: string;
      if (isMarkupShareLink(videoInput.url)) {
        updateJob(jobId, { progress: 8, message: "Resolving Markup.io share link..." });
        resolvedUrl = await resolveMarkupUrl(videoInput.url);
      } else {
        resolvedUrl = normalizeUrl(videoInput.url);
      }
      updateJob(jobId, { progress: 10, message: "Downloading video file..." });
      videoPath = path.join(jobDir, "input_video.mp4");
      await downloadFile(resolvedUrl, videoPath);
    } else {
      videoPath = videoInput.path;
    }

    // Validate video file exists and has content
    if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) {
      throw new Error("Video file is empty or could not be downloaded");
    }
    // Validate the file is actually a video (not an HTML page)
    await validateMediaFile(videoPath, "video");

    if (audioInput.type === "url") {
      updateJob(jobId, { progress: 15, message: "Resolving audio URL..." });
      let resolvedUrl: string;
      if (isMarkupShareLink(audioInput.url)) {
        updateJob(jobId, { progress: 18, message: "Resolving Markup.io share link..." });
        resolvedUrl = await resolveMarkupUrl(audioInput.url);
      } else {
        resolvedUrl = normalizeUrl(audioInput.url);
      }
      updateJob(jobId, { progress: 20, message: "Downloading audio file..." });
      audioPath = path.join(jobDir, "input_audio.wav");
      await downloadFile(resolvedUrl, audioPath);
    } else {
      audioPath = audioInput.path;
    }

    // Validate audio file exists and has content
    if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
      throw new Error("Audio file is empty or could not be downloaded");
    }
    // Validate the file is actually audio (not an HTML page)
    await validateMediaFile(audioPath, "audio");

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
