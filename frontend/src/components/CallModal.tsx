import React, { useState, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";
import { User } from "../types";
import {
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  User as UserIcon,
  Maximize2,
  Minimize2,
  PhoneCall,
  Volume2,
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
  onEndCall,
}) => {
  const [callStatus, setCallStatus] = useState<"RINGING" | "CONNECTED" | "ENDED">("RINGING");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoDisabled, setIsVideoDisabled] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [callDuration, setCallDuration] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const timerIntervalRef = useRef<any>(null);

  const otherUser = callState?.otherUser;
  const isVideo = Boolean(callState?.isVideo);

  // Play synthetic audio ringtone or ring sound
  const ringAudioCtxRef = useRef<AudioContext | null>(null);
  const ringOscillatorRef = useRef<any>(null);

  const startRingingSound = (isIncoming: boolean) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      ringAudioCtxRef.current = ctx;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(isIncoming ? 440 : 400, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      ringOscillatorRef.current = osc;
    } catch {
      // AudioContext could be blocked by autoplay policies until user gesture
    }
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

  // Cleanup helper
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
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    iceCandidateQueue.current = [];
  };

  // Initialize or handle call setup
  useEffect(() => {
    if (!callState || !socket || !otherUser) return;

    setCallStatus("RINGING");
    setCallDuration(0);
    setStatusMessage(
      callState.isIncoming
        ? `Incoming ${callState.isVideo ? "Video" : "Audio"} Call...`
        : `Calling ${otherUser.displayName || otherUser.username}...`
    );

    startRingingSound(callState.isIncoming);

    // If Outgoing call, immediately get local media and prepare peer connection
    if (!callState.isIncoming) {
      setupOutgoingCall();
    }

    // Socket Signaling Event Listeners
    const handleCallAccepted = async () => {
      stopRingingSound();
      setCallStatus("CONNECTED");
      setStatusMessage("Connected");
      startTimer();

      // Caller creates offer upon acceptance
      const pc = peerConnectionRef.current;
      if (pc) {
        try {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: isVideo,
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
      const pc = peerConnectionRef.current;
      if (!pc) return;

      try {
        if (signal.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          // Drain queued candidates if any
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

  const startTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
  };

  const createPeerConnection = (stream: MediaStream): RTCPeerConnection => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    // Add local tracks to PC
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    // Send ICE candidates to other user
    pc.onicecandidate = (event) => {
      if (event.candidate && socket && otherUser) {
        socket.emit("call:signal", {
          toUserId: otherUser.id,
          signal: { candidate: event.candidate },
        });
      }
    };

    // Receive remote tracks
    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  // Setup for outgoing call
  const setupOutgoingCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        audio: true,
      });
      localStreamRef.current = stream;

      if (localVideoRef.current && isVideo) {
        localVideoRef.current.srcObject = stream;
      }

      createPeerConnection(stream);

      // Emit initiate to backend socket
      socket?.emit("call:initiate", {
        toUserId: otherUser?.id,
        callerName: currentUser.displayName || currentUser.username,
        callerAvatar: currentUser.avatarUrl,
        isVideo,
        conversationId: callState?.conversationId,
      });
    } catch (err: any) {
      console.error("Failed to access media devices for outgoing call:", err);
      setStatusMessage("Could not access camera/microphone.");
      setTimeout(() => {
        cleanUpCall();
        onEndCall();
      }, 2000);
    }
  };

  // Accept incoming call
  const handleAcceptCall = async () => {
    stopRingingSound();
    setCallStatus("CONNECTED");
    setStatusMessage("Connecting...");
    startTimer();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideo ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
        audio: true,
      });
      localStreamRef.current = stream;

      if (localVideoRef.current && isVideo) {
        localVideoRef.current.srcObject = stream;
      }

      createPeerConnection(stream);

      // Inform caller that call is accepted
      socket?.emit("call:accept", { toUserId: otherUser?.id });
    } catch (err: any) {
      console.error("Failed to access media devices on accept:", err);
      handleDeclineCall();
    }
  };

  // Decline incoming call
  const handleDeclineCall = () => {
    stopRingingSound();
    socket?.emit("call:reject", { toUserId: otherUser?.id, reason: "declined" });
    cleanUpCall();
    onEndCall();
  };

  // End active or outgoing call
  const handleHangUp = () => {
    stopRingingSound();
    socket?.emit("call:end", { toUserId: otherUser?.id });
    cleanUpCall();
    onEndCall();
  };

  // Toggle Mute
  const handleToggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((t) => {
        t.enabled = !t.enabled;
      });
      setIsMuted(!audioTracks[0]?.enabled);
    }
  };

  // Toggle Camera
  const handleToggleVideo = () => {
    if (localStreamRef.current && isVideo) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach((t) => {
        t.enabled = !t.enabled;
      });
      setIsVideoDisabled(!videoTracks[0]?.enabled);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (!callState || !otherUser) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-fadeIn select-none">
      <div className="relative w-full max-w-2xl bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-slate-800 flex flex-col items-center">
        {/* Top Info Bar */}
        <div className="w-full px-6 py-4 flex items-center justify-between z-20 bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex items-center space-x-2">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                callStatus === "CONNECTED"
                  ? "bg-emerald-500 animate-pulse"
                  : callStatus === "RINGING"
                  ? "bg-amber-400 animate-ping"
                  : "bg-red-500"
              }`}
            />
            <span className="text-xs uppercase font-bold tracking-wider text-slate-300">
              {isVideo ? "Video Call" : "Audio Call"}
            </span>
          </div>
          {callStatus === "CONNECTED" && (
            <div className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm text-white font-mono text-xs font-semibold">
              {formatDuration(callDuration)}
            </div>
          )}
        </div>

        {/* Video Surface or Audio Avatar Arena */}
        <div className="relative w-full aspect-video min-h-[320px] sm:min-h-[420px] bg-slate-950 flex items-center justify-center overflow-hidden">
          {isVideo ? (
            <>
              {/* Remote Video Stream */}
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className={`w-full h-full object-cover ${
                  callStatus === "CONNECTED" ? "block" : "hidden"
                }`}
              />

              {/* While Ringing or if Remote Video is hidden */}
              {callStatus !== "CONNECTED" && (
                <div className="flex flex-col items-center space-y-4">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center text-3xl font-bold shadow-2xl ring-8 ring-emerald-500/20 animate-pulse">
                      {otherUser.displayName?.[0]?.toUpperCase() ||
                        otherUser.username[0].toUpperCase()}
                    </div>
                  </div>
                  <div className="text-center">
                    <h3 className="text-lg font-bold text-white">
                      {otherUser.displayName || otherUser.username}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">{statusMessage}</p>
                  </div>
                </div>
              )}

              {/* Local Video Stream (Picture-in-Picture) */}
              <div
                className={`absolute bottom-4 right-4 w-32 sm:w-40 aspect-video rounded-2xl overflow-hidden shadow-2xl border-2 border-white/20 bg-slate-800 z-10 transition-all ${
                  isVideoDisabled ? "flex items-center justify-center" : ""
                }`}
              >
                {isVideoDisabled ? (
                  <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-white font-bold text-xs">
                    {currentUser.displayName?.[0]?.toUpperCase() || currentUser.username[0].toUpperCase()}
                  </div>
                ) : (
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover mirror"
                  />
                )}
              </div>
            </>
          ) : (
            /* Audio Call Arena */
            <div className="flex flex-col items-center justify-center space-y-6 p-8 text-center">
              <div className="relative">
                {callStatus === "RINGING" && (
                  <>
                    <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping"></div>
                    <div className="absolute -inset-4 rounded-full border border-emerald-500/30 animate-pulse"></div>
                  </>
                )}
                {callStatus === "CONNECTED" && (
                  <div className="absolute -inset-3 rounded-full border-2 border-emerald-500/40 animate-spin [animation-duration:8s]"></div>
                )}
                <div className="w-28 h-28 rounded-full bg-gradient-to-tr from-emerald-600 via-teal-600 to-emerald-500 text-white flex items-center justify-center text-4xl font-bold shadow-2xl ring-8 ring-emerald-500/20">
                  {otherUser.displayName?.[0]?.toUpperCase() ||
                    otherUser.username[0].toUpperCase()}
                </div>
              </div>

              <div>
                <h3 className="text-xl font-bold text-white">
                  {otherUser.displayName || otherUser.username}
                </h3>
                <p className="text-sm font-medium text-emerald-400 mt-1">{statusMessage}</p>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Call Control Action Bar */}
        <div className="w-full px-6 py-6 bg-slate-900 border-t border-slate-800 flex items-center justify-center space-x-4 sm:space-x-6 z-20">
          {callState.isIncoming && callStatus === "RINGING" ? (
            /* Incoming Call Action Buttons */
            <div className="flex items-center space-x-8">
              <button
                onClick={handleDeclineCall}
                title="Decline Call"
                className="flex flex-col items-center space-y-1 group"
              >
                <div className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg shadow-red-600/30 transition-all transform group-hover:scale-105">
                  <PhoneOff className="w-6 h-6" />
                </div>
                <span className="text-[11px] text-slate-400 group-hover:text-red-400">Decline</span>
              </button>

              <button
                onClick={handleAcceptCall}
                title="Accept Call"
                className="flex flex-col items-center space-y-1 group"
              >
                <div className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30 transition-all transform group-hover:scale-105 animate-bounce">
                  {isVideo ? <Video className="w-6 h-6" /> : <Phone className="w-6 h-6" />}
                </div>
                <span className="text-[11px] text-slate-400 group-hover:text-emerald-400">Accept</span>
              </button>
            </div>
          ) : (
            /* Connected / Outgoing Call Controls */
            <>
              {/* Mic Toggle */}
              <button
                onClick={handleToggleMute}
                title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                className={`p-3.5 rounded-full transition-all ${
                  isMuted
                    ? "bg-red-600/20 text-red-500 border border-red-500/30"
                    : "bg-white/10 hover:bg-white/20 text-white"
                }`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {/* Video Toggle (If video call) */}
              {isVideo && (
                <button
                  onClick={handleToggleVideo}
                  title={isVideoDisabled ? "Turn On Camera" : "Turn Off Camera"}
                  className={`p-3.5 rounded-full transition-all ${
                    isVideoDisabled
                      ? "bg-red-600/20 text-red-500 border border-red-500/30"
                      : "bg-white/10 hover:bg-white/20 text-white"
                  }`}
                >
                  {isVideoDisabled ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>
              )}

              {/* End / Hang Up Button */}
              <button
                onClick={handleHangUp}
                title="End Call"
                className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-lg shadow-red-600/40 transition-all transform hover:scale-105"
              >
                <PhoneOff className="w-6 h-6" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
