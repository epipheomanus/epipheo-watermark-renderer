import { Router } from "express";
import multer from "multer";
import path from "path";
import os from "os";
import fs from "fs";
import { nanoid } from "nanoid";
import { createJob, getJob, startRender, getOutputPath } from "./renderService";
import { MAX_VIDEO_SIZE, MAX_AUDIO_SIZE, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS } from "../shared/renderTypes";

const router = Router();

// Configure multer for file uploads
const uploadDir = path.join(os.tmpdir(), "epipheo-uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${nanoid()}-${file.originalname}`),
});

// File filter to validate types
const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (file.fieldname === "video") {
    if (VIDEO_EXTENSIONS.includes(ext) || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported video format: ${ext}. Supported: ${VIDEO_EXTENSIONS.join(", ")}`));
    }
  } else if (file.fieldname === "audio") {
    if (AUDIO_EXTENSIONS.includes(ext) || file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format: ${ext}. Supported: ${AUDIO_EXTENSIONS.join(", ")}`));
    }
  } else {
    cb(null, true);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_VIDEO_SIZE }, // 2GB max (covers both video and audio)
  fileFilter,
});

// Error handler for multer
function handleMulterError(err: any, req: any, res: any, next: any) {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "File too large. Max video size: 2GB, max audio size: 500MB." });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message });
    return;
  }
  next();
}

// POST /api/render - Start a new render job
router.post(
  "/render",
  (req, res, next) => {
    upload.fields([
      { name: "video", maxCount: 1 },
      { name: "audio", maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
        handleMulterError(err, req, res, next);
      } else {
        next();
      }
    });
  },
  async (req, res) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const { videoUrl, audioUrl, skipWatermark } = req.body;

      let videoInput: { type: "file"; path: string } | { type: "url"; url: string };
      if (files?.video?.[0]) {
        videoInput = { type: "file", path: files.video[0].path };
      } else if (videoUrl) {
        videoInput = { type: "url", url: videoUrl };
      } else {
        res.status(400).json({ error: "Video file or URL is required" });
        return;
      }

      let audioInput: { type: "file"; path: string } | { type: "url"; url: string };
      if (files?.audio?.[0]) {
        // Validate audio file size
        if (files.audio[0].size > MAX_AUDIO_SIZE) {
          res.status(413).json({ error: `Audio file too large. Maximum size: ${MAX_AUDIO_SIZE / (1024 * 1024)}MB` });
          return;
        }
        audioInput = { type: "file", path: files.audio[0].path };
      } else if (audioUrl) {
        audioInput = { type: "url", url: audioUrl };
      } else {
        res.status(400).json({ error: "Audio file or URL is required" });
        return;
      }

      const jobId = nanoid(12);
      const job = createJob(jobId);

      // Fire and forget - render runs in background
      const renderOptions = { skipWatermark: skipWatermark === "true" || skipWatermark === "1" };
      startRender(jobId, videoInput, audioInput, renderOptions).catch((err) => {
        console.error(`[Render] Job ${jobId} failed:`, err);
      });

      res.json({ jobId, ...job });
    } catch (error: any) {
      console.error("[Render] Error starting job:", error);
      res.status(500).json({ error: "Failed to start render job" });
    }
  }
);

// GET /api/render/status/:jobId - Poll job status
router.get("/render/status/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

// GET /api/render/download/:jobId - Download the rendered file
router.get("/render/download/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "complete") {
    res.status(400).json({ error: "Render not yet complete" });
    return;
  }

  const filePath = getOutputPath(req.params.jobId);
  if (!filePath) {
    res.status(404).json({ error: "Output file not found. It may have been cleaned up." });
    return;
  }

  const filename = job.outputFilename || `watermark_draft_${req.params.jobId}.mp4`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "video/mp4");
  const stat = fs.statSync(filePath);
  res.setHeader("Content-Length", stat.size);
  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
});

export default router;
