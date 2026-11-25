import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, SwitchCamera, Camera, Send, RotateCcw, Eye } from "lucide-react";

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendPhoto: (file: File, isViewOnce: boolean) => Promise<void>;
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onSendPhoto,
}) => {
  const [facingMode, setFacingMode] = useState<"user" | "environment">("environment");
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [isViewOnce, setIsViewOnce] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async (facing: "user" | "environment") => {
    stopCamera();
    setError(null);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setError("Camera permission denied or no camera available.");
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCapturedUrl(null);
      setCapturedFile(null);
      setIsViewOnce(false);
      setError(null);
      return;
    }
    if (!capturedUrl) {
      startCamera(facingMode);
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, facingMode, capturedUrl, startCamera, stopCamera]);

  if (!isOpen) return null;

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (facingMode === "user") {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `photo_${Date.now()}.jpg`, { type: "image/jpeg" });
        setCapturedFile(file);
        setCapturedUrl(URL.createObjectURL(blob));
        stopCamera();
      },
      "image/jpeg",
      0.92
    );
  };

  const handleRetake = () => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(null);
    setCapturedFile(null);
  };

  const handleSend = async () => {
    if (!capturedFile || sending) return;
    try {
      setSending(true);
      await onSendPhoto(capturedFile, isViewOnce);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to send photo");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col h-dvh w-screen overflow-hidden animate-fadeIn">
      {/* Top Bar */}
      <div className="shrink-0 px-4 py-3 flex items-center justify-between bg-black/50 backdrop-blur-md z-10">
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="text-sm font-bold">
          {capturedUrl ? "Preview Photo" : "Take Photo"}
        </span>
        {!capturedUrl ? (
          <button
            type="button"
            onClick={() => setFacingMode((f) => (f === "user" ? "environment" : "user"))}
            title="Flip Camera"
            className="p-2 rounded-full bg-white/10 hover:bg-white/20"
          >
            <SwitchCamera className="w-5 h-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleRetake}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20"
            title="Retake"
          >
            <RotateCcw className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Viewport */}
      <div className="flex-1 min-h-0 flex items-center justify-center bg-black relative overflow-hidden">
        {error ? (
          <p className="text-sm text-red-400 px-6 text-center">{error}</p>
        ) : capturedUrl ? (
          <img src={capturedUrl} alt="Captured" className="max-w-full max-h-full object-contain" />
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`max-w-full max-h-full object-contain ${facingMode === "user" ? "mirror" : ""}`}
          />
        )}
      </div>

      {/* Bottom Controls */}
      <div className="shrink-0 px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-black/70 backdrop-blur-md flex items-center justify-center space-x-4">
        {!capturedUrl ? (
          <button
            type="button"
            onClick={handleCapture}
            disabled={Boolean(error)}
            className="w-16 h-16 rounded-full border-4 border-white bg-white/20 hover:bg-white/30 flex items-center justify-center transition-transform active:scale-95 disabled:opacity-40"
          >
            <Camera className="w-7 h-7 text-white" />
          </button>
        ) : (
          <div className="w-full max-w-md flex items-center justify-between gap-3">
            {/* View Once Toggle */}
            <button
              type="button"
              onClick={() => setIsViewOnce((v) => !v)}
              className={`px-4 py-2.5 rounded-2xl text-xs font-bold flex items-center space-x-2 border transition-all ${
                isViewOnce
                  ? "bg-amber-500 text-slate-950 border-amber-400 shadow-lg"
                  : "bg-white/10 text-white border-white/20 hover:bg-white/20"
              }`}
            >
              <Eye className="w-4 h-4" />
              <span>{isViewOnce ? "1x View Once ON" : "View Once"}</span>
            </button>

            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              className="flex-1 py-2.5 px-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-bold text-sm flex items-center justify-center space-x-2 shadow-lg disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              <span>{sending ? "Sending..." : "Send Photo"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
