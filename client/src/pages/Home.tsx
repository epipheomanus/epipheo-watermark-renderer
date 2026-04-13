import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload, Link, Download, Film, Music, CheckCircle, AlertCircle, Loader2 } from "lucide-react";

const EPIPHEO_LOGO = "https://d2xsxph8kpxj0f.cloudfront.net/310519663399583707/2nykAy8pPfsfSbfgiWZZ8L/epipheo-logo_a66e198c.png";

type InputMode = "upload" | "url";
type JobStatus = "idle" | "uploading" | "downloading" | "processing" | "complete" | "error";

interface RenderJob {
  id: string;
  status: string;
  progress: number;
  message: string;
  outputFilename?: string;
  error?: string;
}

export default function Home() {
  const [videoMode, setVideoMode] = useState<InputMode>("upload");
  const [audioMode, setAudioMode] = useState<InputMode>("upload");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [jobStatus, setJobStatus] = useState<JobStatus>("idle");
  const [job, setJob] = useState<RenderJob | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/render/status/${jobId}`);
        if (!res.ok) return;
        const data: RenderJob = await res.json();
        setJob(data);

        if (data.status === "downloading") {
          setJobStatus("downloading");
        } else if (data.status === "processing") {
          setJobStatus("processing");
        } else if (data.status === "complete") {
          setJobStatus("complete");
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (data.status === "error") {
          setJobStatus("error");
          setErrorMsg(data.error || "An unknown error occurred");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // Silently retry
      }
    }, 1000);
  }, []);

  const handleSubmit = async () => {
    // Validate inputs
    const hasVideo = videoMode === "upload" ? !!videoFile : !!videoUrl.trim();
    const hasAudio = audioMode === "upload" ? !!audioFile : !!audioUrl.trim();

    if (!hasVideo) {
      setErrorMsg("Please provide a video file or URL.");
      setJobStatus("error");
      return;
    }
    if (!hasAudio) {
      setErrorMsg("Please provide an audio file or URL.");
      setJobStatus("error");
      return;
    }

    setJobStatus("uploading");
    setErrorMsg("");
    setJob(null);

    try {
      const formData = new FormData();

      if (videoMode === "upload" && videoFile) {
        formData.append("video", videoFile);
      } else if (videoMode === "url") {
        formData.append("videoUrl", videoUrl.trim());
      }

      if (audioMode === "upload" && audioFile) {
        formData.append("audio", audioFile);
      } else if (audioMode === "url") {
        formData.append("audioUrl", audioUrl.trim());
      }

      const res = await fetch("/api/render", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to start render");
      }

      const data = await res.json();
      setJob(data);
      setJobStatus("downloading");
      startPolling(data.jobId);
    } catch (err: any) {
      setJobStatus("error");
      setErrorMsg(err.message || "Failed to start render job");
    }
  };

  const handleReset = () => {
    setJobStatus("idle");
    setJob(null);
    setErrorMsg("");
    setVideoFile(null);
    setAudioFile(null);
    setVideoUrl("");
    setAudioUrl("");
    if (pollRef.current) clearInterval(pollRef.current);
  };

  const getStatusLabel = (): string => {
    switch (jobStatus) {
      case "uploading": return "UPLOADING FILES";
      case "downloading": return "DOWNLOADING FILES";
      case "processing": return "RENDERING";
      case "complete": return "COMPLETE";
      case "error": return "ERROR";
      default: return "";
    }
  };

  const isWorking = jobStatus === "uploading" || jobStatus === "downloading" || jobStatus === "processing";

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <img src={EPIPHEO_LOGO} alt="Epipheo" className="h-10 object-contain" />
          </div>
          <h1 className="font-heading text-lg font-medium uppercase tracking-wider text-gray-800">
            Watermark Draft Renderer
          </h1>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-10">
        <div className="mx-auto max-w-2xl">
          {/* Title Section */}
          <div className="mb-8 text-center">
            <h2 className="font-heading text-3xl font-semibold uppercase tracking-wide text-gray-900">
              RENDER YOUR DRAFT
            </h2>
            <p className="mt-2 font-sans text-gray-600">
              Upload a video and audio track. The Epipheo watermark will be applied automatically.
            </p>
          </div>

          {/* Upload Form */}
          {(jobStatus === "idle" || jobStatus === "error") && (
            <div className="space-y-6">
              {/* Video Input */}
              <Card className="border-gray-200">
                <CardContent className="pt-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Film className="h-5 w-5 text-[#33ebc6]" />
                    <h3 className="font-heading text-sm font-medium uppercase tracking-wider text-gray-800">
                      VIDEO FILE
                    </h3>
                  </div>

                  {/* Toggle */}
                  <div className="mb-4 flex gap-2">
                    <button
                      onClick={() => setVideoMode("upload")}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        videoMode === "upload"
                          ? "bg-[#33ebc6] text-gray-900"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      <Upload className="h-3.5 w-3.5" /> Upload
                    </button>
                    <button
                      onClick={() => setVideoMode("url")}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        videoMode === "url"
                          ? "bg-[#33ebc6] text-gray-900"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      <Link className="h-3.5 w-3.5" /> Paste URL
                    </button>
                  </div>

                  {videoMode === "upload" ? (
                    <div
                      onClick={() => videoInputRef.current?.click()}
                      className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-8 text-center transition-colors hover:border-[#33ebc6] hover:bg-gray-50"
                    >
                      <input
                        ref={videoInputRef}
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                      />
                      {videoFile ? (
                        <div className="flex items-center justify-center gap-2 text-gray-700">
                          <Film className="h-5 w-5 text-[#33ebc6]" />
                          <span className="font-sans text-sm">{videoFile.name}</span>
                          <span className="text-xs text-gray-400">
                            ({(videoFile.size / (1024 * 1024)).toFixed(1)} MB)
                          </span>
                        </div>
                      ) : (
                        <div>
                          <Upload className="mx-auto h-8 w-8 text-gray-400" />
                          <p className="mt-2 font-sans text-sm text-gray-500">
                            Click to select a video file (MP4, MOV, AVI)
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      type="text"
                      placeholder="Paste Google Drive, Markup.io, or direct download URL..."
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-3 font-sans text-sm text-gray-700 placeholder-gray-400 focus:border-[#33ebc6] focus:outline-none focus:ring-1 focus:ring-[#33ebc6]"
                    />
                  )}
                </CardContent>
              </Card>

              {/* Audio Input */}
              <Card className="border-gray-200">
                <CardContent className="pt-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Music className="h-5 w-5 text-[#ff6340]" />
                    <h3 className="font-heading text-sm font-medium uppercase tracking-wider text-gray-800">
                      AUDIO MIXDOWN
                    </h3>
                  </div>

                  {/* Toggle */}
                  <div className="mb-4 flex gap-2">
                    <button
                      onClick={() => setAudioMode("upload")}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        audioMode === "upload"
                          ? "bg-[#ff6340] text-white"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      <Upload className="h-3.5 w-3.5" /> Upload
                    </button>
                    <button
                      onClick={() => setAudioMode("url")}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        audioMode === "url"
                          ? "bg-[#ff6340] text-white"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }`}
                    >
                      <Link className="h-3.5 w-3.5" /> Paste URL
                    </button>
                  </div>

                  {audioMode === "upload" ? (
                    <div
                      onClick={() => audioInputRef.current?.click()}
                      className="cursor-pointer rounded-lg border-2 border-dashed border-gray-300 p-8 text-center transition-colors hover:border-[#ff6340] hover:bg-gray-50"
                    >
                      <input
                        ref={audioInputRef}
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                      />
                      {audioFile ? (
                        <div className="flex items-center justify-center gap-2 text-gray-700">
                          <Music className="h-5 w-5 text-[#ff6340]" />
                          <span className="font-sans text-sm">{audioFile.name}</span>
                          <span className="text-xs text-gray-400">
                            ({(audioFile.size / (1024 * 1024)).toFixed(1)} MB)
                          </span>
                        </div>
                      ) : (
                        <div>
                          <Upload className="mx-auto h-8 w-8 text-gray-400" />
                          <p className="mt-2 font-sans text-sm text-gray-500">
                            Click to select an audio file (WAV, MP3, AAC)
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      type="text"
                      placeholder="Paste Google Drive, Markup.io, or direct download URL..."
                      value={audioUrl}
                      onChange={(e) => setAudioUrl(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-4 py-3 font-sans text-sm text-gray-700 placeholder-gray-400 focus:border-[#ff6340] focus:outline-none focus:ring-1 focus:ring-[#ff6340]"
                    />
                  )}
                </CardContent>
              </Card>

              {/* Error Message */}
              {jobStatus === "error" && errorMsg && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 p-4">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                  <p className="font-sans text-sm text-red-700">{errorMsg}</p>
                </div>
              )}

              {/* Submit Button */}
              <Button
                onClick={handleSubmit}
                className="w-full bg-[#33ebc6] py-6 font-heading text-base font-medium uppercase tracking-wider text-gray-900 hover:bg-[#2bd4b3]"
              >
                RENDER WATERMARK DRAFT
              </Button>

              {/* Export Settings Info */}
              <p className="text-center font-sans text-xs text-gray-400">
                Output: H.264 MP4 &middot; 1920&times;1080 &middot; 24fps &middot; 8.5 Mbps VBR &middot; AAC 320kbps 48kHz Stereo
              </p>
            </div>
          )}

          {/* Progress / Status Display */}
          {isWorking && (
            <Card className="border-gray-200">
              <CardContent className="py-10">
                <div className="text-center">
                  <Loader2 className="mx-auto h-10 w-10 animate-spin text-[#33ebc6]" />
                  <h3 className="mt-4 font-heading text-lg font-medium uppercase tracking-wider text-gray-800">
                    {getStatusLabel()}
                  </h3>
                  <p className="mt-2 font-sans text-sm text-gray-500">
                    {job?.message || "Starting..."}
                  </p>
                  <div className="mx-auto mt-6 max-w-md">
                    <Progress
                      value={job?.progress || 0}
                      className="h-3 [&>div]:bg-[#33ebc6]"
                    />
                    <p className="mt-2 font-heading text-sm font-medium text-gray-600">
                      {job?.progress || 0}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Complete - Download */}
          {jobStatus === "complete" && job && (
            <Card className="border-[#33ebc6] border-2">
              <CardContent className="py-10">
                <div className="text-center">
                  <CheckCircle className="mx-auto h-12 w-12 text-[#33ebc6]" />
                  <h3 className="mt-4 font-heading text-xl font-semibold uppercase tracking-wider text-gray-900">
                    RENDER COMPLETE
                  </h3>
                  <p className="mt-2 font-sans text-sm text-gray-600">
                    Your watermarked draft is ready to download.
                  </p>
                  <div className="mt-6 flex flex-col items-center gap-3">
                    <a
                      href={`/api/render/download/${job.id}`}
                      download
                      className="inline-flex items-center gap-2 rounded-lg bg-[#33ebc6] px-8 py-3 font-heading text-sm font-medium uppercase tracking-wider text-gray-900 transition-colors hover:bg-[#2bd4b3]"
                    >
                      <Download className="h-5 w-5" />
                      DOWNLOAD MP4
                    </a>
                    <button
                      onClick={handleReset}
                      className="font-sans text-sm text-gray-500 underline hover:text-gray-700"
                    >
                      Render another draft
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-gray-50 py-6">
        <div className="container text-center">
          <p className="font-sans text-xs text-gray-400">
            Epipheo Watermark Draft Renderer &middot; Internal Tool &middot; Watermark applied automatically
          </p>
        </div>
      </footer>
    </div>
  );
}
