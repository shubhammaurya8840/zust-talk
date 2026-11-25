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
  SwitchCamera,
  ZoomIn,
  ZoomOut,
  Users,
} from "lucide-react";

export interface ActiveGroupCallState {
  isActive: boolean;
  isIncoming: boolean;
  isVideo: boolean;
  conversationId: string;
  conversationTitle: string;
  callerName?: string;
}

interface ParticipantTile {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  stream?: MediaStream;
}

interface GroupCallModalProps {
  socket: Socket | null;
  currentUser: User;
  groupCall: ActiveGroupCallState | null;
  onEndCall: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const RemoteTile: React.FC<{
  participant: ParticipantTile;
  isVideoCall: boolean;
  isZoomFill: boolean;
}> = ({ participant, isVideoCall, isZoomFill }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [hasVideoTrack, setHasVideoTrack] = useState(false);

  useEffect(() => {
    const stream = participant.stream;
    if (!stream) return;
    setHasVideoTrack(stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live"));
    if (videoRef.current) {
      videoRef.current.muted = true;
      videoRef.current.volume = 0;
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      videoRef.current.play().catch(() => {});
    }
    if (audioRef.current) {
      if (audioRef.current.srcObject !== stream) {
        audioRef.current.srcObject = stream;
      }
      audioRef.current.volume = 0.85;
      audioRef.current.play().catch(() => {});
    }
  }, [participant.stream]);

  return (
    <div className="relative bg-slate-900 rounded-2xl overflow-hidden border border-white/10 flex items-center justify-center w-full h-full min-h-[160px]">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onLoadedData={() => setHasVideoTrack(true)}
        className={`w-full h-full ${isZoomFill ? "object-cover" : "object-contain"} ${
          isVideoCall && hasVideoTrack ? "block" : "hidden"
        }`}
      />
      {(!isVideoCall || !hasVideoTrack) && (
        <div className="flex flex-col items-center space-y-2 p-4 text-center">
          <UserAvatar
            name={participant.displayName}
            username={participant.displayName}
            avatarUrl={participant.avatarUrl}
            size="lg"
          />
          <p className="text-xs font-semibold text-white">{participant.displayName}</p>
        </div>
      )}
      <span className="absolute bottom-2 left-2 px-2.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[11px] font-medium text-white">
        {participant.displayName}
      </span>
    </div>
  );
};

export const GroupCallModal: React.FC<GroupCallModalProps> = ({
  socket,
  currentUser,
  groupCall,
  onEndCall,
}) => {
  const [joined, setJoined] = useState(!groupCall?.isIncoming);
  const [participants, setParticipants] = useState<Record<string, ParticipantTile>>({});
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(!groupCall?.isVideo);
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [isZoomFill, setIsZoomFill] = useState(false);
  const [duration, setDuration] = useState(0);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanupAll = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (socket && groupCall?.conversationId) {
      socket.emit("group-call:leave", { conversationId: groupCall.conversationId });
    }
  }, [socket, groupCall?.conversationId]);

  const createPeerForUser = useCallback(
    (peerId: string, peerInfo: { displayName: string; avatarUrl?: string | null }, shouldOffer: boolean) => {
      if (!socket || !groupCall?.conversationId) return null;
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(RTC_CONFIG);
      peersRef.current.set(peerId, pc);

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("group-call:signal", {
            conversationId: groupCall.conversationId,
            toUserId: peerId,
            signal: { candidate: event.candidate },
          });
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams?.[0] || new MediaStream([event.track]);
        setParticipants((prev) => ({
          ...prev,
          [peerId]: {
            userId: peerId,
            displayName: peerInfo.displayName,
            avatarUrl: peerInfo.avatarUrl,
            stream,
          },
        }));
      };

      if (shouldOffer) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer).then(() => offer))
          .then((offer) => {
            socket.emit("group-call:signal", {
              conversationId: groupCall.conversationId,
              toUserId: peerId,
              signal: offer,
            });
          })
          .catch(() => {});
      }

      return pc;
    },
    [socket, groupCall?.conversationId]
  );

  const joinCallRoom = useCallback(async () => {
    if (!socket || !groupCall) return;
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            channelCount: 1,
          },
          video: groupCall.isVideo ? { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } } : false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
          },
          video: false,
        });
        setIsVideoOff(true);
      }

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
      }

      setJoined(true);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);

      if (!groupCall.isIncoming) {
        socket.emit("group-call:start", {
          conversationId: groupCall.conversationId,
          conversationTitle: groupCall.conversationTitle,
          callerName: currentUser.displayName || currentUser.username,
          callerAvatar: currentUser.avatarUrl,
          isVideo: groupCall.isVideo,
        });
      }

      socket.emit(
        "group-call:join",
        {
          conversationId: groupCall.conversationId,
          displayName: currentUser.displayName || currentUser.username,
          avatarUrl: currentUser.avatarUrl,
        },
        (res: { success: boolean; participants: Array<{ userId: string; displayName: string; avatarUrl?: string | null }> }) => {
          if (res?.participants) {
            res.participants.forEach((p) => {
              setParticipants((prev) => ({
                ...prev,
                [p.userId]: { userId: p.userId, displayName: p.displayName, avatarUrl: p.avatarUrl },
              }));
              createPeerForUser(p.userId, p, true);
            });
          }
        }
      );
    } catch {
      cleanupAll();
      onEndCall();
    }
  }, [socket, groupCall, currentUser, createPeerForUser, cleanupAll, onEndCall]);

  useEffect(() => {
    if (!groupCall || !socket) return;

    if (!groupCall.isIncoming) {
      joinCallRoom();
    }

    const handleUserJoined = (data: { conversationId: string; userId: string; displayName: string; avatarUrl?: string | null }) => {
      if (data.conversationId !== groupCall.conversationId) return;
      setParticipants((prev) => ({
        ...prev,
        [data.userId]: { userId: data.userId, displayName: data.displayName, avatarUrl: data.avatarUrl },
      }));
    };

    const handleUserLeft = (data: { conversationId: string; userId: string }) => {
      if (data.conversationId !== groupCall.conversationId) return;
      const pc = peersRef.current.get(data.userId);
      if (pc) {
        pc.close();
        peersRef.current.delete(data.userId);
      }
      setParticipants((prev) => {
        const next = { ...prev };
        delete next[data.userId];
        return next;
      });
    };

    const handleSignal = async (data: { conversationId: string; fromUserId: string; signal: any }) => {
      if (data.conversationId !== groupCall.conversationId) return;
      let pc = peersRef.current.get(data.fromUserId);
      if (!pc) {
        pc = createPeerForUser(
          data.fromUserId,
          { displayName: "Member" },
          false
        ) ?? undefined;
      }
      if (!pc) return;

      try {
        if (data.signal.type === "offer") {
          await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("group-call:signal", {
            conversationId: groupCall.conversationId,
            toUserId: data.fromUserId,
            signal: answer,
          });
        } else if (data.signal.type === "answer") {
          await pc.setRemoteDescription(new RTCSessionDescription(data.signal));
        } else if (data.signal.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
        }
      } catch {}
    };

    socket.on("group-call:user-joined", handleUserJoined);
    socket.on("group-call:user-left", handleUserLeft);
    socket.on("group-call:signal", handleSignal);

    return () => {
      socket.off("group-call:user-joined", handleUserJoined);
      socket.off("group-call:user-left", handleUserLeft);
      socket.off("group-call:signal", handleSignal);
      cleanupAll();
    };
  }, [groupCall?.conversationId]);

  if (!groupCall) return null;

  const participantList = Object.values(participants);

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
    setIsMuted((m) => !m);
  };

  const toggleVideo = async () => {
    if (!localStreamRef.current) return;
    const track = localStreamRef.current.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsVideoOff(!track.enabled);
    }
  };

  const flipCam = async () => {
    if (!localStreamRef.current) return;
    const nextFacing = facingMode === "user" ? "environment" : "user";
    const oldTrack = localStreamRef.current.getVideoTracks()[0];
    oldTrack?.stop();
    if (oldTrack) localStreamRef.current.removeTrack(oldTrack);

    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing } },
        audio: false,
      });
      const newTrack = s.getVideoTracks()[0];
      if (!newTrack) return;
      localStreamRef.current.addTrack(newTrack);
      setFacingMode(nextFacing);
      setIsVideoOff(false);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = null;
        localVideoRef.current.srcObject = localStreamRef.current;
        localVideoRef.current.play().catch(() => {});
      }
      peersRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) sender.replaceTrack(newTrack).catch(() => {});
      });
    } catch {}
  };

  const formatDuration = (s: number) => `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-50 w-screen h-dvh bg-slate-950 text-white flex flex-col overflow-hidden animate-fadeIn">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 bg-black/50 backdrop-blur-md flex items-center justify-between border-b border-white/10">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center">
            <Users className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold">{groupCall.conversationTitle}</h3>
            <p className="text-[11px] text-emerald-400 font-medium">
              {joined
                ? `${participantList.length + 1} in call • ${formatDuration(duration)}`
                : `${groupCall.callerName || "Someone"} started a group call`}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsZoomFill((z) => !z)}
          className="p-2 rounded-full bg-white/10 hover:bg-white/20"
          title="Toggle Zoom"
        >
          {isZoomFill ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
        </button>
      </div>

      {/* Grid Area */}
      <div className="flex-1 min-h-0 p-3 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Local Self Tile */}
        {joined && (
          <div className="relative bg-slate-900 rounded-2xl overflow-hidden border border-emerald-500/40 flex items-center justify-center min-h-[180px]">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full ${isZoomFill ? "object-cover" : "object-contain"} ${
                facingMode === "user" ? "mirror" : ""
              } ${!isVideoOff ? "block" : "hidden"}`}
            />
            {isVideoOff && (
              <div className="flex flex-col items-center space-y-2">
                <UserAvatar
                  name={currentUser.displayName}
                  username={currentUser.username}
                  avatarUrl={currentUser.avatarUrl}
                  size="lg"
                />
                <span className="text-xs text-slate-300">You (Camera Off)</span>
              </div>
            )}
            <span className="absolute bottom-2 left-2 px-2.5 py-0.5 rounded-full bg-black/60 text-[11px] font-medium">
              You
            </span>
          </div>
        )}

        {/* Remote Participants */}
        {participantList.map((p) => (
          <RemoteTile
            key={p.userId}
            participant={p}
            isVideoCall={groupCall.isVideo}
            isZoomFill={isZoomFill}
          />
        ))}

        {joined && participantList.length === 0 && (
          <div className="bg-slate-900/50 rounded-2xl border border-dashed border-white/15 flex items-center justify-center p-6 text-center text-xs text-slate-400 min-h-[180px]">
            Waiting for group members to join...
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="shrink-0 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-black/70 border-t border-white/10 flex items-center justify-center space-x-3">
        {!joined ? (
          <>
            <button
              type="button"
              onClick={onEndCall}
              className="px-6 py-3 rounded-2xl bg-red-600 hover:bg-red-700 font-bold text-xs flex items-center space-x-2"
            >
              <PhoneOff className="w-4 h-4" />
              <span>Decline</span>
            </button>
            <button
              type="button"
              onClick={joinCallRoom}
              className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 font-bold text-xs flex items-center space-x-2"
            >
              <Phone className="w-4 h-4" />
              <span>Join Group Call</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleMute}
              className={`p-3.5 rounded-2xl ${isMuted ? "bg-red-500/25 text-red-400" : "bg-white/10 hover:bg-white/20"}`}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            {groupCall.isVideo && (
              <>
                <button
                  type="button"
                  onClick={toggleVideo}
                  className={`p-3.5 rounded-2xl ${isVideoOff ? "bg-red-500/25 text-red-400" : "bg-emerald-500/25 text-emerald-300"}`}
                >
                  {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={flipCam}
                  className="p-3.5 rounded-2xl bg-white/10 hover:bg-white/20"
                >
                  <SwitchCamera className="w-5 h-5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                cleanupAll();
                onEndCall();
              }}
              className="p-3.5 px-5 rounded-2xl bg-red-600 hover:bg-red-700"
            >
              <PhoneOff className="w-5 h-5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
