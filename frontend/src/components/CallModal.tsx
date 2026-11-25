import React, { useState, useEffect, useRef, useCallback } from "react";
import { Socket } from "socket.io-client";
import { User } from "../types";
import { UserAvatar } from "../utils/avatars";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  ZoomIn,
  ZoomOut,
  SwitchCamera,
  ChevronDown,
  Volume2,
  VolumeX,
} from "lucide-react";

export interface ActiveCallState {
  isActive: boolean;
  isIncoming: boolean;
  isVideo: boolean;
  otherUser: {
    id: string;
    displayName?: string;
    username: string;
    avatarUrl?: string | null;
  };
  conversationId: string;
}

interface CallModalProps {
  socket: Socket | null;
  currentUser: User;
  callState: ActiveCallState | null;
  isMinimized?: boolean;
  onMinimize?: () => void;
  onExpand?: () => void;
  onEndCall: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

export const CallModal: React.FC<CallModalProps> = ({
  socket,
  currentUser,
  callState,
  isMinimized = false,
  onMinimize,
  onExpand,
  onEndCall,
}) => {
  const [callStatus, setCallStatus] = useState<"RINGING" | "CONNECTED" | "ENDED">("RINGING");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isMuted, setIsMuted] = useState(false);
  const [hasVideoMode, setHasVideoMode] = useState(Boolean(callState?.isVideo));
  const [isVideoDisabled, setIsVideoDisabled] = useState(!callState?.isVideo);
  const [isRemoteVideoOff, setIsRemoteVideoOff] = useState(!callState?.isVideo);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isFlippingCamera, setIsFlippingCamera] = useState(false);
  const [isSwapped, setIsSwapped] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  // Magnify / Zoom toggle: false = normal portrait/fit view (never over-zoomed on laptop); true = full edge-to-edge zoom fill
  const [isZoomFill, setIsZoomFill] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [callDuration, setCallDuration] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeDeviceIdRef = useRef<string | undefined>(undefined);

  const otherUser = callState?.otherUser;

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 2400);
  }, []);

  const ringAudioCtxRef = useRef<AudioContext | null>(null);
  const ringOscillatorRef = useRef<OscillatorNode | null>(null);

  const startRingingSound = (isIncoming: boolean) => {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      ringAudioCtxRef.current = ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(isIncoming ? 440 : 400, ctx.currentTime);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      ringOscillatorRef.current = osc;
    } catch {}
  };

  const stopRingingSound = () => {
    try {
      if (ringOscillatorRef.current) {
        ringOscillatorRef.current.stop();
        ringOscillatorRef.current.disconnect();
        ringOscillatorRef.current = null;
      }
      if (ringAudioCtxRef.current) {
        ringAudioCtxRef.current.close().catch(() => {});
        ringAudioCtxRef.current = null;
      }
    } catch {}
  };

  const syncStreamsToElements = useCallback(() => {
    const localStream = localStreamRef.current;
    const remoteStream = remoteStreamRef.current;

    if (localVideoRef.current && localStream) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      localVideoRef.current.play().catch(() => {});
    }

    if (remoteVideoRef.current && remoteStream) {
      if (remoteVideoRef.current.srcObject !== remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      remoteVideoRef.current.play().catch(() => {});
    }

    if (remoteAudioRef.current && remoteStream) {
      if (remoteAudioRef.current.srcObject !== remoteStream) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
      remoteAudioRef.current.muted = !isSpeakerOn;
      remoteAudioRef.current.play().catch(() => {});
    }
  }, [isSpeakerOn]);

  useEffect(() => {
    syncStreamsToElements();
  }, [isMinimized, hasVideoMode, isVideoDisabled, isSwapped, callStatus, isZoomFill, syncStreamsToElements]);

  const cleanUpCall = () => {
    stopRingingSound();
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    iceCandidateQueue.current = [];
  };

  const startTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  const createPeerConnection = (stream: MediaStream): RTCPeerConnection => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && socket && otherUser) {
        socket.emit("call:signal", {
          toUserId: otherUser.id,
          signal: { candidate: event.candidate },
        });
      }
    };

    pc.ontrack = (event) => {
      let rStream = remoteStreamRef.current;
      if (event.streams && event.streams[0]) {
        rStream = event.streams[0];
      } else {
        if (!rStream) rStream = new MediaStream();
        if (!rStream.getTracks().some((t) => t.id === event.track.id)) {
          rStream.addTrack(event.track);
        }
      }
      remoteStreamRef.current = rStream;

      if (event.track.kind === "video") {
        setHasVideoMode(true);
        setIsRemoteVideoOff(false);
        event.track.onmute = () => setIsRemoteVideoOff(true);
        event.track.onunmute = () => setIsRemoteVideoOff(false);
      }

      syncStreamsToElements();
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  const acquireInitialMedia = async (wantVideo: boolean): Promise<MediaStream> => {
    if (!wantVideo) {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });
      const vTrack = stream.getVideoTracks()[0];
      if (vTrack) activeDeviceIdRef.current = vTrack.getSettings().deviceId;
      return stream;
    } catch {
      setIsVideoDisabled(true);
      showToast("Camera unavailable — joined with audio");
      return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
  };

  useEffect(() => {
    if (!callState || !socket || !otherUser) return;

    const initialVideo = Boolean(callState.isVideo);
    setHasVideoMode(initialVideo);
    setIsVideoDisabled(!initialVideo);
    setIsRemoteVideoOff(!initialVideo);
    setFacingMode("user");
    setIsSwapped(false);
    setIsZoomFill(false);
    setCallStatus("RINGING");
    setCallDuration(0);
    setStatusMessage(
      callState.isIncoming
        ? `Incoming ${initialVideo ? "Video" : "Audio"} Call...`
        : `Calling ${otherUser.displayName || otherUser.username}...`
    );

    startRingingSound(callState.isIncoming);

    if (!callState.isIncoming) {
      setupOutgoingCall(initialVideo);
    }

    const handleCallAccepted = async () => {
      stopRingingSound();
      setCallStatus("CONNECTED");
      setStatusMessage("Connected");
      startTimer();

      const pc = peerConnectionRef.current;
      if (pc) {
        try {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await pc.setLocalDescription(offer);
          socket.emit("call:signal", {
            toUserId: otherUser.id,
            signal: offer,
          });
        } catch (err) {
          console.error("Failed to create offer:", err);
        }
      }
    };

    const handleCallSignal = async ({ signal }: { signal: any }) => {
      if (!signal) return;
      if (signal.type === "camera-state") {
        setIsRemoteVideoOff(!signal.enabled);
        if (signal.enabled) setHasVideoMode(true);
        return;
      }

      const pc = peerConnectionRef.current;
      if (!pc) return;

      try {
        if (signal.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          while (iceCandidateQueue.current.length > 0) {
            const cand = iceCandidateQueue.current.shift();
            if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("call:signal", {
            toUserId: otherUser.id,
            signal: answer,
          });
        } else if (signal.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          while (iceCandidateQueue.current.length > 0) {
            const cand = iceCandidateQueue.current.shift();
            if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand));
          }
        } else if (signal.candidate) {
          if (pc.remoteDescription && pc.remoteDescription.type) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            iceCandidateQueue.current.push(signal.candidate);
          }
        }
      } catch (err) {
        console.error("Signaling error:", err);
      }
    };

    const handleCallRejected = ({ reason }: { reason?: string }) => {
      stopRingingSound();
      setCallStatus("ENDED");
      setStatusMessage(reason === "busy" ? "User is busy" : "Call declined");
      setTimeout(() => {
        cleanUpCall();
        onEndCall();
      }, 1500);
    };

    const handleCallEnded = () => {
      stopRingingSound();
      setCallStatus("ENDED");
      setStatusMessage("Call ended");
      setTimeout(() => {
        cleanUpCall();
        onEndCall();
      }, 1200);
    };

    socket.on("call:accepted", handleCallAccepted);
    socket.on("call:signal", handleCallSignal);
    socket.on("call:rejected", handleCallRejected);
    socket.on("call:ended", handleCallEnded);

    return () => {
      socket.off("call:accepted", handleCallAccepted);
      socket.off("call:signal", handleCallSignal);
      socket.off("call:rejected", handleCallRejected);
      socket.off("call:ended", handleCallEnded);
      cleanUpCall();
    };
  }, [callState?.isActive, callState?.isIncoming]);

  const setupOutgoingCall = async (wantVideo: boolean) => {
    try {
      const stream = await acquireInitialMedia(wantVideo);
      localStreamRef.current = stream;
      syncStreamsToElements();
      createPeerConnection(stream);

      socket?.emit("call:initiate", {
        toUserId: otherUser?.id,
        callerName: currentUser.displayName || currentUser.username,
        callerAvatar: currentUser.avatarUrl,
        isVideo: wantVideo,
        conversationId: callState?.conversationId,
      });
    } catch {
      setStatusMessage("Could not access microphone/camera.");
      setTimeout(() => {
        cleanUpCall();
        onEndCall();
      }, 2000);
    }
  };

  const handleAcceptCall = async () => {
    stopRingingSound();
    setCallStatus("CONNECTED");
    setStatusMessage("Connecting...");
    startTimer();

    const wantVideo = Boolean(callState?.isVideo);
    try {
      const stream = await acquireInitialMedia(wantVideo);
      localStreamRef.current = stream;
      syncStreamsToElements();
      createPeerConnection(stream);

      socket?.emit("call:accept", { toUserId: otherUser?.id });
    } catch {
      handleDeclineCall();
    }
  };

  const handleDeclineCall = () => {
    stopRingingSound();
    socket?.emit("call:reject", { toUserId: otherUser?.id, reason: "declined" });
    cleanUpCall();
    onEndCall();
  };

  const handleHangUp = () => {
    stopRingingSound();
    socket?.emit("call:end", { toUserId: otherUser?.id });
    cleanUpCall();
    onEndCall();
  };

  const handleToggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((t) => {
        t.enabled = !t.enabled;
      });
      setIsMuted(!audioTracks[0]?.enabled);
    }
  };

  const handleToggleVideo = async () => {
    if (!localStreamRef.current) return;

    const existingTracks = localStreamRef.current.getVideoTracks();
    const liveTrack = existingTracks.find((t) => t.readyState === "live");

    if (liveTrack) {
      const nextEnabled = !liveTrack.enabled;
      liveTrack.enabled = nextEnabled;
      setIsVideoDisabled(!nextEnabled);
      setHasVideoMode(true);
      socket?.emit("call:signal", {
        toUserId: otherUser?.id,
        signal: { type: "camera-state", enabled: nextEnabled },
      });
      return;
    }

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const newTrack = camStream.getVideoTracks()[0];
      if (!newTrack) return;

      activeDeviceIdRef.current = newTrack.getSettings().deviceId;
      localStreamRef.current.addTrack(newTrack);
      setHasVideoMode(true);
      setIsVideoDisabled(false);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
        localVideoRef.current.srcObject = localStreamRef.current;
        localVideoRef.current.play().catch(() => {});
      }

      const pc = peerConnectionRef.current;
      if (pc) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (videoSender) {
          await videoSender.replaceTrack(newTrack);
        } else {
          pc.addTrack(newTrack, localStreamRef.current);
          if (callStatus === "CONNECTED" && otherUser) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket?.emit("call:signal", { toUserId: otherUser.id, signal: offer });
          }
        }
      }

      socket?.emit("call:signal", {
        toUserId: otherUser?.id,
        signal: { type: "camera-state", enabled: true },
      });
    } catch {
      showToast("Camera permission denied or unavailable");
    }
  };

  const handleFlipCamera = async () => {
    if (!localStreamRef.current || isFlippingCamera) return;
    setIsFlippingCamera(true);
    const nextFacing: "user" | "environment" = facingMode === "user" ? "environment" : "user";

    try {
      const oldTracks = localStreamRef.current.getVideoTracks();
      const oldDeviceId = oldTracks[0]?.getSettings().deviceId || activeDeviceIdRef.current;

      oldTracks.forEach((t) => {
        t.stop();
        localStreamRef.current?.removeTrack(t);
      });

      let newStream: MediaStream | null = null;
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: nextFacing }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const cameras = devices.filter((d) => d.kind === "videoinput");
          if (cameras.length > 1) {
            const currentIndex = cameras.findIndex((c) => c.deviceId === oldDeviceId);
            const nextCam = cameras[(currentIndex + 1) % cameras.length];
            newStream = await navigator.mediaDevices.getUserMedia({
              video: { deviceId: { exact: nextCam.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: false,
            });
          } else {
            newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            showToast("Only one camera available");
          }
        } catch {
          newStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          showToast("Could not switch camera");
        }
      }

      const newTrack = newStream?.getVideoTracks()[0];
      if (!newTrack || !localStreamRef.current) return;

      activeDeviceIdRef.current = newTrack.getSettings().deviceId;
      const detectedFacing = newTrack.getSettings().facingMode;
      const resolvedFacing: "user" | "environment" =
        detectedFacing === "environment" || detectedFacing === "user" ? detectedFacing : nextFacing;

      localStreamRef.current.addTrack(newTrack);
      setFacingMode(resolvedFacing);
      setIsVideoDisabled(false);
      setHasVideoMode(true);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
        localVideoRef.current.srcObject = localStreamRef.current;
        localVideoRef.current.play().catch(() => {});
      }

      const pc = peerConnectionRef.current;
      if (pc) {
        const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (videoSender) {
          await videoSender.replaceTrack(newTrack);
        } else {
          pc.addTrack(newTrack, localStreamRef.current);
          if (callStatus === "CONNECTED" && otherUser) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket?.emit("call:signal", { toUserId: otherUser.id, signal: offer });
          }
        }
      }

      socket?.emit("call:signal", {
        toUserId: otherUser?.id,
        signal: { type: "camera-state", enabled: true },
      });
      showToast(resolvedFacing === "environment" ? "Back Camera" : "Front Camera");
    } catch {
      showToast("Failed to flip camera");
    } finally {
      setIsFlippingCamera(false);
    }
  };

  // Magnify toggle: switches between Portrait/Fit (no zoom crop on laptop!) and Full Zoomed Fill
  const handleToggleZoom = async () => {
    const nextZoom = !isZoomFill;
    setIsZoomFill(nextZoom);
    if (nextZoom && containerRef.current?.requestFullscreen && !document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
    } else if (!nextZoom && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleToggleSpeaker = () => {
    const next = !isSpeakerOn;
    setIsSpeakerOn(next);
    if (remoteAudioRef.current) remoteAudioRef.current.muted = !next;
    if (remoteVideoRef.current) remoteVideoRef.current.muted = !next;
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (!callState || !otherUser) return null;

  const displayName = otherUser.displayName || otherUser.username;

  const hiddenAudioElement = <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />;

  if (isMinimized) {
    return (
      <>
        {hiddenAudioElement}
        <div
          onClick={onExpand}
          className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-3 px-4 py-2.5 rounded-full bg-slate-900/95 backdrop-blur-xl text-white shadow-2xl border border-emerald-500/40 cursor-pointer hover:scale-[1.02] transition-transform animate-slideUp"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <div className="text-xs leading-tight">
            <p className="font-bold truncate max-w-[140px]">{displayName}</p>
            <p className="text-[10px] text-emerald-400 font-mono">
              {callStatus === "CONNECTED" ? formatDuration(callDuration) : statusMessage}
            </p>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleHangUp();
            }}
            title="End Call"
            className="w-8 h-8 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center shrink-0"
          >
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </>
    );
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 w-screen h-dvh bg-slate-950 text-white flex flex-col overflow-hidden select-none animate-fadeIn"
    >
      {hiddenAudioElement}

      {/* Media Arena: Portrait/Fit on laptop by default, Full-Zoom Fill when Magnify toggled */}
      <div className="relative flex-1 w-full h-full overflow-hidden bg-slate-950 flex items-center justify-center">
        {hasVideoMode ? (
          <>
            <div
              className={`relative flex items-center justify-center overflow-hidden transition-all duration-300 ${
                isZoomFill
                  ? "w-full h-full"
                  : "w-full h-full md:w-[440px] md:max-w-[90vw] md:h-[82dvh] md:rounded-3xl md:border md:border-white/15 md:shadow-2xl bg-black"
              }`}
            >
              <video
                ref={isSwapped ? localVideoRef : remoteVideoRef}
                autoPlay
                playsInline
                muted={isSwapped || !isSpeakerOn}
                className={`w-full h-full transition-opacity duration-300 ${
                  isZoomFill ? "object-cover" : "object-contain md:object-cover"
                } ${
                  isSwapped
                    ? !isVideoDisabled
                      ? `opacity-100 ${facingMode === "user" ? "mirror" : ""}`
                      : "opacity-0"
                    : callStatus === "CONNECTED" && !isRemoteVideoOff
                    ? "opacity-100"
                    : "opacity-0"
                }`}
              />

              {((!isSwapped && (callStatus !== "CONNECTED" || isRemoteVideoOff)) ||
                (isSwapped && isVideoDisabled)) && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center space-y-4 px-6 text-center bg-slate-900/70">
                  <UserAvatar
                    name={isSwapped ? currentUser.displayName : displayName}
                    username={isSwapped ? currentUser.username : otherUser.username}
                    avatarUrl={isSwapped ? currentUser.avatarUrl : otherUser.avatarUrl}
                    size="xl"
                    className="ring-4 ring-white/15"
                  />
                  <div>
                    <h3 className="text-xl font-bold text-white">
                      {isSwapped ? "You" : displayName}
                    </h3>
                    <p className="text-xs text-emerald-300 mt-1 font-medium">
                      {callStatus === "CONNECTED" ? "Camera is off" : statusMessage}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Floating PiP */}
            <div
              onClick={() => setIsSwapped((prev) => !prev)}
              title="Tap to swap screen"
              className="absolute bottom-28 sm:bottom-32 right-4 z-20 w-24 h-36 sm:w-36 sm:h-52 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/25 bg-slate-900 cursor-pointer transition-transform hover:scale-[1.03]"
            >
              <video
                ref={isSwapped ? remoteVideoRef : localVideoRef}
                autoPlay
                playsInline
                muted={!isSwapped || !isSpeakerOn}
                className={`w-full h-full object-cover ${
                  !isSwapped
                    ? !isVideoDisabled
                      ? `block ${facingMode === "user" ? "mirror" : ""}`
                      : "hidden"
                    : callStatus === "CONNECTED" && !isRemoteVideoOff
                    ? "block"
                    : "hidden"
                }`}
              />

              {((!isSwapped && isVideoDisabled) ||
                (isSwapped && (callStatus !== "CONNECTED" || isRemoteVideoOff))) && (
                <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800/90 p-2 text-center">
                  <UserAvatar
                    name={isSwapped ? displayName : currentUser.displayName}
                    username={isSwapped ? otherUser.username : currentUser.username}
                    avatarUrl={isSwapped ? otherUser.avatarUrl : currentUser.avatarUrl}
                    size="sm"
                  />
                  <span className="text-[10px] text-slate-400 mt-1.5">Camera Off</span>
                </div>
              )}

              {!isSwapped && !isVideoDisabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFlipCamera();
                  }}
                  title="Flip Camera"
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/55 hover:bg-black/80 text-white backdrop-blur-md transition-colors"
                >
                  <SwitchCamera className={`w-3.5 h-3.5 ${isFlippingCamera ? "animate-spin" : ""}`} />
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="relative z-10 flex flex-col items-center justify-center space-y-5 p-8 text-center">
            <UserAvatar
              name={displayName}
              username={otherUser.username}
              avatarUrl={otherUser.avatarUrl}
              size="xl"
              className="ring-8 ring-emerald-500/20"
            />
            <div>
              <h3 className="text-2xl font-bold text-white tracking-tight">{displayName}</h3>
              <p className="text-sm font-medium text-emerald-400 mt-1.5">{statusMessage}</p>
            </div>
          </div>
        )}

        {/* Top Floating Header */}
        <div className="absolute top-0 inset-x-0 z-30 px-4 sm:px-6 pt-[max(1rem,env(safe-area-inset-top))] pb-6 bg-gradient-to-b from-black/75 to-transparent flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                title="Minimize Call"
                className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md text-white transition-colors"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            )}
            <div>
              <div className="flex items-center space-x-2">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    callStatus === "CONNECTED"
                      ? "bg-emerald-400 animate-pulse"
                      : callStatus === "RINGING"
                      ? "bg-amber-400 animate-ping"
                      : "bg-red-500"
                  }`}
                />
                <span className="text-sm sm:text-base font-bold text-white">{displayName}</span>
              </div>
              <p className="text-[11px] text-slate-300 font-medium pl-4">
                {hasVideoMode ? "Video Call" : "Audio Call"}
                {callStatus === "CONNECTED" ? ` • ${formatDuration(callDuration)}` : ""}
              </p>
            </div>
          </div>

          {/* Magnify / Zoom Toggle Button */}
          {hasVideoMode && (
            <button
              type="button"
              onClick={handleToggleZoom}
              title={isZoomFill ? "Portrait / Fit View" : "Magnify Full Screen"}
              className={`p-2.5 rounded-full backdrop-blur-md transition-colors flex items-center space-x-1.5 ${
                isZoomFill ? "bg-emerald-500 text-white" : "bg-white/15 hover:bg-white/25 text-white"
              }`}
            >
              {isZoomFill ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
              <span className="text-[11px] font-semibold hidden sm:inline">
                {isZoomFill ? "Portrait Fit" : "Full Zoom"}
              </span>
            </button>
          )}
        </div>

        {toastMsg && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 px-4 py-1.5 rounded-full bg-black/75 backdrop-blur-md border border-white/15 text-xs font-medium text-white shadow-lg animate-fadeIn">
            {toastMsg}
          </div>
        )}

        {/* Bottom Dock */}
        <div className="absolute bottom-0 inset-x-0 z-30 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 px-4 bg-gradient-to-t from-black/80 to-transparent flex justify-center">
          {callState.isIncoming && callStatus === "RINGING" ? (
            <div className="flex items-center space-x-10 px-8 py-4 rounded-3xl bg-slate-900/80 backdrop-blur-xl border border-white/15 shadow-2xl">
              <button
                type="button"
                onClick={handleDeclineCall}
                className="flex flex-col items-center space-y-1.5 group"
              >
                <div className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg">
                  <PhoneOff className="w-6 h-6" />
                </div>
                <span className="text-xs font-medium text-slate-300">Decline</span>
              </button>

              <button
                type="button"
                onClick={handleAcceptCall}
                className="flex flex-col items-center space-y-1.5 group"
              >
                <div className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-lg animate-bounce">
                  {hasVideoMode ? <Video className="w-6 h-6" /> : <Phone className="w-6 h-6" />}
                </div>
                <span className="text-xs font-medium text-emerald-300">Accept</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2.5 sm:space-x-4 px-4 sm:px-5 py-3 rounded-3xl bg-slate-900/80 backdrop-blur-xl border border-white/15 shadow-2xl">
              <button
                type="button"
                onClick={handleToggleSpeaker}
                title={isSpeakerOn ? "Mute Audio" : "Speaker"}
                className={`p-3 rounded-2xl transition-all ${
                  !isSpeakerOn ? "bg-amber-500/20 text-amber-400" : "bg-white/10 hover:bg-white/20 text-white"
                }`}
              >
                {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </button>

              <button
                type="button"
                onClick={handleToggleMute}
                title={isMuted ? "Unmute" : "Mute"}
                className={`p-3 rounded-2xl transition-all ${
                  isMuted ? "bg-red-500/25 text-red-400" : "bg-white/10 hover:bg-white/20 text-white"
                }`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <button
                type="button"
                onClick={handleToggleVideo}
                title={isVideoDisabled ? "Turn On Camera" : "Turn Off Camera"}
                className={`p-3 rounded-2xl transition-all ${
                  isVideoDisabled
                    ? "bg-red-500/25 text-red-400"
                    : "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40"
                }`}
              >
                {isVideoDisabled ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </button>

              <button
                type="button"
                onClick={handleFlipCamera}
                disabled={isFlippingCamera}
                title="Flip Camera"
                className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white transition-all disabled:opacity-50"
              >
                <SwitchCamera className={`w-5 h-5 ${isFlippingCamera ? "animate-spin" : ""}`} />
              </button>

              {hasVideoMode && (
                <button
                  type="button"
                  onClick={handleToggleZoom}
                  title={isZoomFill ? "Portrait Fit" : "Magnify Full Screen"}
                  className={`p-3 rounded-2xl transition-all ${
                    isZoomFill ? "bg-emerald-500 text-white" : "bg-white/10 hover:bg-white/20 text-white"
                  }`}
                >
                  {isZoomFill ? <ZoomOut className="w-5 h-5" /> : <ZoomIn className="w-5 h-5" />}
                </button>
              )}

              <button
                type="button"
                onClick={handleHangUp}
                title="End Call"
                className="p-3 px-4 sm:px-5 rounded-2xl bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg shadow-red-600/40"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
