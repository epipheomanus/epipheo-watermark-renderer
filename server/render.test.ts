import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./renderService";
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

  it("passes through Markup.io direct file URLs unchanged", () => {
    const url = "https://cdn.markup.io/files/abc123/video.mp4";
    const result = normalizeUrl(url);
    expect(result).toBe(url);
  });

  it("passes through Markup.io share links for redirect handling", () => {
    const url = "https://app.markup.io/share/abc123";
    const result = normalizeUrl(url);
    expect(result).toBe(url);
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
