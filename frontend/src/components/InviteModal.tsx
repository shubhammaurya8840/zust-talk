import React, { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { User } from "../types";
import { api } from "../api/client";
import { UserAvatar } from "../utils/avatars";
import { X, Copy, Check, QrCode, ScanLine, Upload, Download } from "lucide-react";

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onConversationOpened?: (conversationId: string) => void;
}

export const InviteModal: React.FC<InviteModalProps> = ({
  isOpen,
  onClose,
  user,
  onConversationOpened,
}) => {
  const [tab, setTab] = useState<"MY_QR" | "SCAN">("MY_QR");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<string>("Point camera at a friend's QR code");
  const [isOpeningChat, setIsOpeningChat] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handledRef = useRef(false);

  const inviteUrl = `${window.location.origin}/?chat=@${user.username}`;

  // Generate real scannable QR code
  useEffect(() => {
    if (!isOpen) return;
    QRCode.toDataURL(inviteUrl, {
      width: 280,
      margin: 2,
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    })
      .then((url) => setQrDataUrl(url))
      .catch(() => {});
  }, [isOpen, inviteUrl]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const parseScannedUsername = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // 1. URL format: https://.../?chat=@username or .../chat/@username
    try {
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        const u = new URL(trimmed);
        const param = u.searchParams.get("chat");
        if (param) return param.replace(/^@/, "").trim().toLowerCase();
        const match = u.pathname.match(/\/chat\/@?([a-zA-Z0-9_]+)/);
        if (match) return match[1].toLowerCase();
      }
    } catch {
      // Not a URL
    }

    // 2. JSON payload { username: "..." }
    try {
      if (trimmed.startsWith("{")) {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.username === "string") {
          return parsed.username.replace(/^@/, "").trim().toLowerCase();
        }
      }
    } catch {}

    // 3. Plain @username or username
    const clean = trimmed.replace(/^@/, "").trim().toLowerCase();
    if (/^[a-z0-9_]{3,30}$/.test(clean)) return clean;

    return null;
  };

  const handleDecodedPayload = useCallback(
    async (payload: string) => {
      if (handledRef.current || isOpeningChat) return;
      const username = parseScannedUsername(payload);
      if (!username) {
        setScanError("Invalid QR code. Scan a Zust Talk user QR code.");
        return;
      }
      if (username === user.username.toLowerCase()) {
        setScanError("That is your own QR code!");
        return;
      }

      handledRef.current = true;
      setIsOpeningChat(true);
      setScanError(null);
      setScanStatus(`Opening chat with @${username}...`);
      stopCamera();

      try {
        const lookup = await api.users.lookupByUsername(username);
        if (!lookup.user?.id) throw new Error("User not found");
        const convRes = await api.conversations.createDirect(lookup.user.id);
        if (convRes.conversation?.id) {
          onConversationOpened?.(convRes.conversation.id);
          onClose();
        }
      } catch (err: any) {
        handledRef.current = false;
        setScanError(err.message || `Could not open chat with @${username}`);
        setScanStatus("Point camera at a friend's QR code");
      } finally {
        setIsOpeningChat(false);
      }
    },
    [isOpeningChat, onClose, onConversationOpened, stopCamera, user.username]
  );

  // Start / stop QR camera scanner when tab === "SCAN"
  useEffect(() => {
    if (!isOpen || tab !== "SCAN") {
      stopCamera();
      return;
    }

    handledRef.current = false;
    setScanError(null);
    setScanStatus("Point camera at a friend's QR code");
    let cancelled = false;

    const startScanner = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 720 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const scanFrame = () => {
          if (cancelled || handledRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w > 0 && h > 0) {
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(video, 0, 0, w, h);
                const imgData = ctx.getImageData(0, 0, w, h);
                const code = jsQR(imgData.data, w, h, { inversionAttempts: "dontInvert" });
                if (code?.data) {
                  handleDecodedPayload(code.data);
                  return;
                }
              }
            }
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        };
        rafRef.current = requestAnimationFrame(scanFrame);
      } catch {
        setScanError("Camera access unavailable. You can upload a QR image below instead.");
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [isOpen, tab, handleDecodedPayload, stopCamera]);

  const handleUploadQrImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError(null);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, canvas.width, canvas.height);
      if (code?.data) {
        handleDecodedPayload(code.data);
      } else {
        setScanError("No QR code detected in the selected image.");
      }
    };
    img.src = URL.createObjectURL(file);
    e.target.value = "";
  };

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `${user.username}-qr.png`;
    a.click();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-center animate-scaleIn"
      >
        {/* Header & Tabs */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => setTab("MY_QR")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors ${
                tab === "MY_QR"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>My QR</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("SCAN")}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors ${
                tab === "SCAN"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span>Scan QR</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {tab === "MY_QR" ? (
          <div className="p-6">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 mx-auto w-56 h-56 flex items-center justify-center shadow-inner mb-4 relative">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="My QR Code" className="w-48 h-48 object-contain" />
              ) : (
                <span className="text-xs text-slate-400">Generating QR...</span>
              )}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="p-1 rounded-2xl bg-white shadow-md">
                  <UserAvatar
                    name={user.displayName}
                    username={user.username}
                    avatarUrl={user.avatarUrl}
                    size="xs"
                  />
                </div>
              </div>
            </div>

            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-base">{user.displayName}</h4>
            <p className="text-xs text-slate-400 mb-4">@{user.username}</p>

            <div className="flex items-center space-x-1.5 p-1.5 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs mb-3">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                className="bg-transparent flex-1 px-2 text-slate-600 dark:text-slate-300 outline-none select-all truncate text-[11px]"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-1 shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? "Copied" : "Copy"}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadQr}
              className="w-full py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center justify-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save QR Image</span>
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="relative w-full aspect-square bg-slate-950 rounded-2xl overflow-hidden flex items-center justify-center border border-slate-800">
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              {/* Scanner Frame Overlay */}
              <div className="absolute inset-8 border-2 border-emerald-400/80 rounded-2xl pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            </div>

            {scanError ? (
              <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs">
                {scanError}
              </div>
            ) : (
              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{scanStatus}</p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleUploadQrImage}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isOpeningChat}
              className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold flex items-center justify-center space-x-2"
            >
              <Upload className="w-4 h-4 text-emerald-600" />
              <span>Scan QR from Gallery Image</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
