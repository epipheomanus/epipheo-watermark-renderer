import { describe, expect, it } from "vitest";
import { normalizeUrl, isMarkupShareLink, createJob, getJob } from "./renderService";
import { EXPORT_SETTINGS, WATERMARK_CDN_URL, WATERMARK_FILENAME, VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, MAX_VIDEO_SIZE, MAX_AUDIO_SIZE } from "../shared/renderTypes";

describe("normalizeUrl", () => {
  it("converts Google Drive share link to direct download", () => {
    const url = "https://drive.google.com/file/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/view?usp=sharing";
    const result = normalizeUrl(url);
    expect(result).toBe("https://drive.google.com/uc?export=download&id=1aBcDeFgHiJkLmNoPqRsTuVwXyZ");
  });

  it("converts Google Drive edit link to direct download", () => {
    const url = "https://drive.google.com/file/d/ABC123/edit";
    const result = normalizeUrl(url);
    expect(result).toBe("https://drive.google.com/uc?export=download&id=ABC123");
  });

  it("converts Dropbox dl=0 to dl=1", () => {
    const url = "https://www.dropbox.com/s/abc123/video.mp4?dl=0";
    const result = normalizeUrl(url);
    expect(result).toBe("https://www.dropbox.com/s/abc123/video.mp4?dl=1");
  });

  it("passes through Markup.io direct media URLs unchanged", () => {
    const url = "https://media.markup.io/green/converted/project-images/abc/def/video.mp4";
    const result = normalizeUrl(url);
    expect(result).toBe(url);
  });

  it("passes through Markup.io media URLs with query params unchanged", () => {
    const url = "https://media.markup.io/green/converted/abc/def.mp4?download-as=MyVideo.mp4";
    const result = normalizeUrl(url);
    expect(result).toBe(url);
  });
});

describe("isMarkupShareLink", () => {
  it("detects Markup.io markup share links", () => {
    expect(isMarkupShareLink("https://app.markup.io/markup/c612b8b2-1c27-4dcd-b58d-02bdf8a92b6e")).toBe(true);
  });

  it("detects Markup.io /share/ links", () => {
    expect(isMarkupShareLink("https://app.markup.io/share/abc123")).toBe(true);
  });

  it("does not flag direct media.markup.io URLs", () => {
    expect(isMarkupShareLink("https://media.markup.io/green/converted/abc/def.mp4")).toBe(false);
  });

  it("does not flag non-Markup URLs", () => {
    expect(isMarkupShareLink("https://drive.google.com/file/d/abc/view")).toBe(false);
  });

  it("passes through direct download URLs unchanged", () => {
    const url = "https://example.com/files/video.mp4";
    const result = normalizeUrl(url);
    expect(result).toBe(url);
  });
});

describe("EXPORT_SETTINGS constants", () => {
  it("has correct resolution", () => {
    expect(EXPORT_SETTINGS.resolution).toBe("1920x1080");
    expect(EXPORT_SETTINGS.width).toBe(1920);
    expect(EXPORT_SETTINGS.height).toBe(1080);
  });

  it("has correct frame rate", () => {
    expect(EXPORT_SETTINGS.frameRate).toBe(24);
  });

  it("has correct video codec and bitrate", () => {
    expect(EXPORT_SETTINGS.videoCodec).toBe("libx264");
    expect(EXPORT_SETTINGS.videoBitrate).toBe("8500k");
  });

  it("has correct audio settings", () => {
    expect(EXPORT_SETTINGS.audioCodec).toBe("aac");
    expect(EXPORT_SETTINGS.audioBitrate).toBe("320k");
    expect(EXPORT_SETTINGS.audioSampleRate).toBe(48000);
    expect(EXPORT_SETTINGS.audioChannels).toBe(2);
  });
});

describe("Watermark configuration", () => {
  it("has a valid CDN URL", () => {
    expect(WATERMARK_CDN_URL).toContain("EpipheoWatermarkLogo_Left_v2");
    expect(WATERMARK_CDN_URL).toMatch(/^https:\/\//);
  });

  it("has correct filename", () => {
    expect(WATERMARK_FILENAME).toBe("EpipheoWatermarkLogo_Left_v2.png");
  });
});

describe("Skip watermark feature", () => {
  it("createJob creates a job with pending status", () => {
    const job = createJob("test-skip-wm-1");
    expect(job.id).toBe("test-skip-wm-1");
    expect(job.status).toBe("pending");
    expect(job.progress).toBe(0);
  });

  it("getJob retrieves a created job", () => {
    createJob("test-skip-wm-2");
    const job = getJob("test-skip-wm-2");
    expect(job).toBeDefined();
    expect(job?.id).toBe("test-skip-wm-2");
  });

  it("getJob returns undefined for non-existent job", () => {
    const job = getJob("non-existent-job-id");
    expect(job).toBeUndefined();
  });
});

describe("File validation constants", () => {
  it("supports expected video formats", () => {
    expect(VIDEO_EXTENSIONS).toContain(".mp4");
    expect(VIDEO_EXTENSIONS).toContain(".mov");
    expect(VIDEO_EXTENSIONS).toContain(".avi");
  });

  it("supports expected audio formats", () => {
    expect(AUDIO_EXTENSIONS).toContain(".wav");
    expect(AUDIO_EXTENSIONS).toContain(".mp3");
    expect(AUDIO_EXTENSIONS).toContain(".aac");
  });

  it("has reasonable max file sizes", () => {
    expect(MAX_VIDEO_SIZE).toBe(2 * 1024 * 1024 * 1024); // 2GB
    expect(MAX_AUDIO_SIZE).toBe(500 * 1024 * 1024); // 500MB
  });
});
