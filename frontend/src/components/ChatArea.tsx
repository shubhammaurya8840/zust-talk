import React, { useState, useEffect, useRef } from "react";
import { Conversation, Message, User } from "../types";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { api, getFullUrl } from "../api/client";
import { ReportModal } from "./ReportModal";
import { E2EEModal } from "./E2EEModal";
import { ForwardModal } from "./ForwardModal";
import {
  ArrowLeft,
  Send,
  Paperclip,
  Check,
  CheckCheck,
  Edit2,
  Trash2,
  Users,
  MoreVertical,
  Ban,
  FileText,
  Download,
  X,
  Smile,
  Mic,
  MicOff,
  Reply,
  Forward,
  Lock,
  ShieldAlert,
  Play,
  Pause,
  Phone,
  Video,
} from "lucide-react";

interface ChatAreaProps {
  conversation: Conversation;
  allConversations: Conversation[];
  onBack: () => void;
  onToggleInfo: () => void;
  onConversationUpdated: () => void;
  onStartCall?: (isVideo: boolean) => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  conversation,
  allConversations,
  onBack,
  onToggleInfo,
  onConversationUpdated,
  onStartCall,
}) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editBody, setEditBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<Message | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);

  // Modals state
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isE2EEOpen, setIsE2EEOpen] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordIntervalRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<any>(null);

  const otherMember =
    conversation.type === "DIRECT"
      ? conversation.members.find((m) => m.userId !== user?.id)?.user
      : undefined;

  const title =
    conversation.type === "GROUP"
      ? conversation.title || "Group Chat"
      : otherMember?.displayName || otherMember?.username || "Chat";

  // Load message history
  const loadMessages = async () => {
    try {
      setLoading(true);
      const res = await api.messages.getHistory(conversation.id);
      setMessages(res.messages);
      // Immediately mark all messages in this conversation as read
      api.messages.markConversationRead(conversation.id).catch(() => {});
    } catch (err) {
      console.error("Failed to load message history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMessages();
  }, [conversation.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingUsers]);

  // Socket setup
  useEffect(() => {
    if (!socket) return;

    socket.emit("conversation:join", conversation.id);

    const handleNewMessage = (msg: Message) => {
      if (msg.conversationId === conversation.id) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        if (msg.senderId !== user?.id) {
          api.messages.markConversationRead(conversation.id).catch(() => {});
        }
      }
    };

    const handleUpdatedMessage = (msg: Message) => {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m)));
    };

    const handleDeletedMessage = ({ id }: { id: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, body: null, ciphertext: null, deletedAt: new Date().toISOString() } : m
        )
      );
    };

    const handleReceipt = ({ messageId, readAt }: { messageId: string; readAt: string }) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === messageId) {
            const receipts = m.receipts || [];
            return {
              ...m,
              receipts: receipts.length > 0
                ? receipts.map((r) => ({ ...r, readAt: r.readAt || readAt, deliveredAt: r.deliveredAt || readAt }))
                : [{ id: "temp", messageId: m.id, userId: "other", deliveredAt: readAt, readAt }],
            };
          }
          return m;
        })
      );
    };

    const handleConversationRead = ({
      conversationId: cId,
      userId: readerId,
      readAt,
    }: {
      conversationId: string;
      userId: string;
      readAt: string;
    }) => {
      if (cId === conversation.id) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.senderId === user?.id) {
              const currentReceipts = m.receipts || [];
              const updatedReceipts = currentReceipts.length > 0
                ? currentReceipts.map((r) => ({
                    ...r,
                    readAt: r.readAt || readAt,
                    deliveredAt: r.deliveredAt || readAt,
                  }))
                : [{ id: "temp", messageId: m.id, userId: readerId, deliveredAt: readAt, readAt }];
              return {
                ...m,
                receipts: updatedReceipts,
              };
            }
            return m;
          })
        );
      }
    };

    const handleTypingStart = ({
      conversationId: cId,
      userId: typingId,
    }: {
      conversationId?: string;
      userId: string;
    }) => {
      if ((!cId || cId === conversation.id) && typingId !== user?.id) {
        setTypingUsers((prev) => new Set(prev).add(typingId));
      }
    };

    const handleTypingStop = ({
      conversationId: cId,
      userId: typingId,
    }: {
      conversationId?: string;
      userId: string;
    }) => {
      if (!cId || cId === conversation.id) {
        setTypingUsers((prev) => {
          const next = new Set(prev);
          next.delete(typingId);
          return next;
        });
      }
    };

    socket.on("message:new", handleNewMessage);
    socket.on("message:updated", handleUpdatedMessage);
    socket.on("message:deleted", handleDeletedMessage);
    socket.on("message:receipt", handleReceipt);
    socket.on("conversation:read", handleConversationRead);
    socket.on("typing:start", handleTypingStart);
    socket.on("typing:stop", handleTypingStop);

    return () => {
      socket.emit("conversation:leave", conversation.id);
      socket.off("message:new", handleNewMessage);
      socket.off("message:updated", handleUpdatedMessage);
      socket.off("message:deleted", handleDeletedMessage);
      socket.off("message:receipt", handleReceipt);
      socket.off("conversation:read", handleConversationRead);
      socket.off("typing:start", handleTypingStart);
      socket.off("typing:stop", handleTypingStop);
    };
  }, [socket, conversation.id, user?.id]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (!socket) return;

    socket.emit("typing:start", conversation.id);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("typing:stop", conversation.id);
    }, 2000);
  };

  // Voice recording handlers (PRD Feature: Voice Messages)
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const audioFile = new File([audioBlob], `voice_${Date.now()}.webm`, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        await sendVoiceNote(audioFile);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      recordIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch {
      alert("Microphone permission is required to record voice messages.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordIntervalRef.current) clearInterval(recordIntervalRef.current);
    }
  };

  const sendVoiceNote = async (audioFile: File) => {
    try {
      setUploading(true);
      const uploaded = await api.uploads.upload(audioFile);
      await api.messages.send({
        conversationId: conversation.id,
        body: "🎤 Voice Message",
        type: "VOICE",
        attachments: [
          {
            originalName: uploaded.originalName,
            storagePath: uploaded.url,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.sizeBytes,
          },
        ],
      });
      loadMessages();
      onConversationUpdated();
    } catch (err: any) {
      alert(err.message || "Failed to send voice note");
    } finally {
      setUploading(false);
    }
  };

  // Send message
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text && !selectedFile) return;

    if (socket) socket.emit("typing:stop", conversation.id);

    try {
      setUploading(true);
      let attachmentsPayload: any = undefined;
      let msgType: any = "TEXT";

      if (selectedFile) {
        const uploaded = await api.uploads.upload(selectedFile);
        if (selectedFile.type.startsWith("image/")) msgType = "IMAGE";
        else if (selectedFile.type.startsWith("video/")) msgType = "VIDEO";
        else msgType = "DOCUMENT";

        attachmentsPayload = [
          {
            originalName: uploaded.originalName,
            storagePath: uploaded.url,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.sizeBytes,
          },
        ];
      }

      const res = await api.messages.send({
        conversationId: conversation.id,
        body: text || undefined,
        type: msgType,
        replyToId: replyingTo ? replyingTo.id : undefined,
        attachments: attachmentsPayload,
      });

      if (res.success && res.message) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.message.id)) return prev;
          return [...prev, res.message];
        });
      }

      setInputText("");
      setSelectedFile(null);
      setReplyingTo(null);
      onConversationUpdated();
    } catch (err: any) {
      alert(err.message || "Failed to send message");
    } finally {
      setUploading(false);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMessage || !editBody.trim()) return;

    try {
      const res = await api.messages.edit(editingMessage.id, editBody.trim());
      setMessages((prev) => prev.map((m) => (m.id === editingMessage.id ? res.message : m)));
      setEditingMessage(null);
      setEditBody("");
    } catch (err: any) {
      alert(err.message || "Failed to edit message");
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!confirm("Delete this message for everyone?")) return;
    try {
      await api.messages.remove(msgId);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, body: null, ciphertext: null, deletedAt: new Date().toISOString() } : m
        )
      );
    } catch (err: any) {
      alert(err.message || "Failed to delete message");
    }
  };

  const handleToggleBlock = async () => {
    if (!otherMember) return;
    try {
      if (isBlocked) {
        await api.users.unblock(otherMember.id);
        setIsBlocked(false);
      } else {
        await api.users.block(otherMember.id);
        setIsBlocked(true);
      }
    } catch (err: any) {
      alert(err.message || "Action failed");
    } finally {
      setMenuOpen(false);
    }
  };

  const formatMsgTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatRecordTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-100 overflow-hidden relative">
      {/* Top Header */}
      <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between shadow-sm z-10">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="md:hidden p-1.5 -ml-1 text-slate-500 hover:text-slate-800 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div
            onClick={conversation.type === "GROUP" ? onToggleInfo : undefined}
            className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white shadow-sm shrink-0 ${
              conversation.type === "GROUP"
                ? "bg-gradient-to-tr from-indigo-500 to-purple-600 cursor-pointer"
                : "bg-gradient-to-tr from-emerald-500 to-teal-600"
            }`}
          >
            {conversation.type === "GROUP" ? (
              <Users className="w-5 h-5" />
            ) : (
              otherMember?.displayName?.[0]?.toUpperCase() || otherMember?.username?.[0]?.toUpperCase() || "U"
            )}
          </div>

          <div
            onClick={conversation.type === "GROUP" ? onToggleInfo : undefined}
            className={conversation.type === "GROUP" ? "cursor-pointer" : ""}
          >
            <div className="flex items-center space-x-1.5">
              <h2 className="text-sm font-bold text-slate-800 leading-tight">{title}</h2>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsE2EEOpen(true);
                }}
                title="E2EE Protected Session"
                className="text-emerald-600 hover:text-emerald-700"
              >
                <Lock className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              {typingUsers.size > 0 ? (
                <span className="text-emerald-600 font-bold flex items-center space-x-1 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping inline-block mr-1"></span>
                  typing...
                </span>
              ) : conversation.type === "GROUP" ? (
                `${conversation.members.length} members`
              ) : (
                "Online"
              )}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-1 relative">
          {conversation.type === "DIRECT" && otherMember && (
            <>
              {/* Voice Call Button */}
              <button
                onClick={() => onStartCall?.(false)}
                title="Voice Call"
                className="p-2 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
              >
                <Phone className="w-4 h-4" />
              </button>

              {/* Video Call Button */}
              <button
                onClick={() => onStartCall?.(true)}
                title="Video Call"
                className="p-2 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
              >
                <Video className="w-4 h-4" />
              </button>
            </>
          )}

          {conversation.type === "GROUP" && (
            <button
              onClick={onToggleInfo}
              title="Group Information"
              className="p-2 text-slate-500 hover:text-emerald-600 hover:bg-slate-100 rounded-xl"
            >
              <Users className="w-5 h-5" />
            </button>
          )}

          {conversation.type === "DIRECT" && otherMember && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 w-44 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-50">
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setIsE2EEOpen(true);
                    }}
                    className="w-full px-4 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center space-x-2"
                  >
                    <Lock className="w-4 h-4 text-emerald-600" />
                    <span>Verify Security</span>
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setIsReportOpen(true);
                    }}
                    className="w-full px-4 py-2 text-left text-xs text-amber-700 hover:bg-amber-50 flex items-center space-x-2"
                  >
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    <span>Report User</span>
                  </button>
                  <button
                    onClick={handleToggleBlock}
                    className="w-full px-4 py-2 text-left text-xs text-red-600 hover:bg-red-50 flex items-center space-x-2 border-t border-slate-100"
                  >
                    <Ban className="w-4 h-4" />
                    <span>{isBlocked ? "Unblock Contact" : "Block Contact"}</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Message Timeline */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#e5ded8]/30">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-xs">
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 space-y-2">
            <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm">
              <Smile className="w-6 h-6 text-emerald-600" />
            </div>
            <p className="text-xs font-semibold text-slate-600">No messages yet</p>
            <p className="text-[11px] text-slate-400 max-w-xs">
              Say namaste! Messages are stored locally in your database.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.senderId === user?.id;
            const isDeleted = Boolean(m.deletedAt);
            const isRead = m.receipts?.some((r) => r.readAt);

            // Find replied message if replyToId exists
            const repliedMsg = m.replyToId ? messages.find((prev) => prev.id === m.replyToId) : undefined;

            return (
              <div
                key={m.id}
                className={`flex flex-col group ${isMe ? "items-end ml-10 sm:ml-20" : "items-start mr-10 sm:mr-20"}`}
              >
                <div
                  className={`relative max-w-[85%] sm:max-w-md px-3.5 py-2 rounded-2xl shadow-sm text-sm ${
                    isMe
                      ? "bg-emerald-600 text-white rounded-br-xs"
                      : "bg-white text-slate-800 rounded-bl-xs border border-slate-200/90"
                  }`}
                >
                  {/* Sender Name in Groups */}
                  {!isMe && conversation.type === "GROUP" && (
                    <p className="text-[11px] font-bold text-emerald-600 mb-0.5">
                      {m.sender?.displayName || m.sender?.username}
                    </p>
                  )}

                  {/* Quoted Reply Banner */}
                  {repliedMsg && !isDeleted && (
                    <div
                      className={`mb-2 p-2 rounded-xl text-xs border-l-4 ${
                        isMe
                          ? "bg-emerald-700/60 border-emerald-300 text-emerald-100"
                          : "bg-slate-100 border-emerald-500 text-slate-600"
                      }`}
                    >
                      <p className="font-bold text-[10px] text-emerald-300">
                        {repliedMsg.sender?.displayName || repliedMsg.sender?.username || "Reply"}
                      </p>
                      <p className="truncate text-[11px]">{repliedMsg.body || "Attachment"}</p>
                    </div>
                  )}

                  {/* Body Content */}
                  {isDeleted ? (
                    <p className={`italic text-xs ${isMe ? "text-emerald-100" : "text-slate-400"}`}>
                      This message was deleted
                    </p>
                  ) : (
                    <>
                      {/* Attachments */}
                      {m.attachments?.map((att) => {
                        const isImg = att.mimeType.startsWith("image/");
                        const isVideo = att.mimeType.startsWith("video/");
                        const isAudio = att.mimeType.startsWith("audio/") || m.type === "VOICE";

                        const fileUrl = getFullUrl(att.storagePath);

                        if (isImg) {
                          return (
                            <div key={att.id} className="mb-2">
                              <img
                                src={fileUrl}
                                alt={att.originalName}
                                className="rounded-lg max-h-60 w-auto object-cover cursor-pointer hover:opacity-95"
                                onClick={() => window.open(fileUrl, "_blank")}
                              />
                            </div>
                          );
                        }

                        if (isVideo) {
                          return (
                            <div key={att.id} className="mb-2">
                              <video
                                src={fileUrl}
                                controls
                                className="rounded-lg max-h-60 w-full bg-black"
                              />
                            </div>
                          );
                        }

                        if (isAudio) {
                          return (
                            <div key={att.id} className="mb-2">
                              <audio src={fileUrl} controls className="w-full max-w-xs h-10" />
                            </div>
                          );
                        }

                        return (
                          <div key={att.id} className="mb-2">
                            <a
                              href={fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={`flex items-center space-x-2 p-2 rounded-xl border ${
                                isMe
                                  ? "bg-emerald-700/60 border-emerald-500 text-white"
                                  : "bg-slate-50 border-slate-200 text-slate-800"
                              } hover:opacity-90`}
                            >
                              <FileText className="w-5 h-5 shrink-0" />
                              <div className="min-w-0 flex-1 text-xs">
                                <p className="font-semibold truncate">{att.originalName}</p>
                                <p className="opacity-75 text-[10px]">
                                  {(att.sizeBytes / 1024).toFixed(1)} KB
                                </p>
                              </div>
                              <Download className="w-4 h-4 shrink-0 opacity-75" />
                            </a>
                          </div>
                        );
                      })}

                      {/* Text */}
                      {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    </>
                  )}

                  {/* Message Meta Info */}
                  <div
                    className={`flex items-center justify-end space-x-1 mt-1 text-[10px] select-none ${
                      isMe ? "text-emerald-100" : "text-slate-400"
                    }`}
                  >
                    {m.editedAt && !isDeleted && <span>(edited)</span>}
                    <span>{formatMsgTime(m.createdAt)}</span>
                    {isMe && !isDeleted && (
                      <span className="ml-1 inline-flex items-center" title={isRead ? "Seen" : "Sent"}>
                        {isRead ? (
                          <CheckCheck className="w-4 h-4 text-sky-400 font-bold inline" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-emerald-200 inline" />
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {/* Hover Message Action Options (PRD Feature: Reply, Forward, Edit, Delete) */}
                {!isDeleted && (
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center space-x-2 mt-0.5 px-1">
                    <button
                      onClick={() => setReplyingTo(m)}
                      title="Reply"
                      className="text-[10px] text-slate-400 hover:text-emerald-600 flex items-center space-x-0.5"
                    >
                      <Reply className="w-3 h-3" />
                      <span>Reply</span>
                    </button>
                    <button
                      onClick={() => setForwardingMsg(m)}
                      title="Forward"
                      className="text-[10px] text-slate-400 hover:text-emerald-600 flex items-center space-x-0.5"
                    >
                      <Forward className="w-3 h-3" />
                      <span>Forward</span>
                    </button>
                    {isMe && (
                      <>
                        <button
                          onClick={() => {
                            setEditingMessage(m);
                            setEditBody(m.body || "");
                          }}
                          className="text-[10px] text-slate-400 hover:text-emerald-600 flex items-center space-x-0.5"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          onClick={() => handleDeleteMessage(m.id)}
                          className="text-[10px] text-slate-400 hover:text-red-600 flex items-center space-x-0.5"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
        {typingUsers.size > 0 && (
          <div className="flex items-center space-x-2 bg-white px-3.5 py-2 rounded-2xl rounded-tl-xs shadow-sm border border-slate-200/80 w-fit text-xs text-slate-600 animate-pulse my-1">
            <div className="flex space-x-1 items-center py-1">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce"></div>
            </div>
            <span className="text-xs text-emerald-700 font-medium">
              {conversation.type === "DIRECT"
                ? `${title} is typing...`
                : "Someone is typing..."}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Quote Banner */}
      {replyingTo && (
        <div className="bg-emerald-50 border-t border-emerald-200 px-4 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 truncate">
            <Reply className="w-4 h-4 text-emerald-600 shrink-0" />
            <div className="truncate">
              <span className="font-bold text-emerald-800">
                Replying to {replyingTo.sender?.displayName || "Message"}:
              </span>
              <span className="text-slate-600 ml-1 truncate">
                {replyingTo.body || "Attachment"}
              </span>
            </div>
          </div>
          <button onClick={() => setReplyingTo(null)} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Edit Message Banner */}
      {editingMessage && (
        <form
          onSubmit={handleEditSubmit}
          className="bg-amber-50 border-t border-amber-200 px-4 py-2 flex items-center justify-between"
        >
          <div className="flex-1 mr-2">
            <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block">
              Editing Message
            </span>
            <input
              type="text"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="w-full text-xs bg-white border border-amber-300 rounded-lg px-2 py-1 mt-0.5 focus:outline-none focus:ring-1 focus:ring-amber-500"
              autoFocus
            />
          </div>
          <div className="flex items-center space-x-1">
            <button
              type="submit"
              className="px-3 py-1 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingMessage(null);
                setEditBody("");
              }}
              className="p-1 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}

      {/* Selected File Preview Banner */}
      {selectedFile && (
        <div className="bg-slate-200/80 px-4 py-2 flex items-center justify-between text-xs text-slate-700">
          <div className="flex items-center space-x-2 truncate">
            <Paperclip className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold truncate">{selectedFile.name}</span>
            <span className="text-slate-400">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
          </div>
          <button
            onClick={() => setSelectedFile(null)}
            className="p-1 text-slate-500 hover:text-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input Bar with Voice Recording support */}
      <div className="p-3 bg-white border-t border-slate-200">
        {isRecording ? (
          <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-2xl px-4 py-2.5">
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 bg-red-600 rounded-full animate-ping"></span>
              <span className="text-xs font-bold text-red-700">
                Recording: {formatRecordTime(recordingTime)}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={cancelRecording}
                className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={stopRecording}
                className="px-3 py-1 text-xs bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 flex items-center space-x-1"
              >
                <Send className="w-3 h-3" />
                <span>Send Voice</span>
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center space-x-2"
          >
            {/* File Picker */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files?.[0]) setSelectedFile(e.target.files[0]);
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach file (Images, Documents, Audio)"
              className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-slate-100 rounded-xl transition-colors shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            {/* Text Input */}
            <textarea
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Type a message..."
              className="flex-1 py-2 px-3 text-sm rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none max-h-32"
            />

            {/* Voice Message Mic Button */}
            {!inputText.trim() && !selectedFile ? (
              <button
                type="button"
                onClick={startRecording}
                title="Hold / Click to record voice note"
                className="p-2.5 text-slate-500 hover:text-emerald-600 hover:bg-slate-100 rounded-xl transition-colors shrink-0"
              >
                <Mic className="w-5 h-5" />
              </button>
            ) : (
              /* Send Button */
              <button
                type="submit"
                disabled={uploading}
                className="p-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl disabled:opacity-40 transition-colors shrink-0 shadow-md shadow-emerald-600/20"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>
        )}
      </div>

      {/* Modals */}
      {otherMember && (
        <ReportModal
          isOpen={isReportOpen}
          onClose={() => setIsReportOpen(false)}
          userId={otherMember.id}
          userName={otherMember.displayName || otherMember.username}
        />
      )}

      <E2EEModal
        isOpen={isE2EEOpen}
        onClose={() => setIsE2EEOpen(false)}
        peerName={title}
      />

      <ForwardModal
        isOpen={Boolean(forwardingMsg)}
        onClose={() => setForwardingMsg(null)}
        message={forwardingMsg}
        conversations={allConversations.filter((c) => c.id !== conversation.id)}
        onForward={async (targetId, messageText) => {
          await api.messages.send({
            conversationId: targetId,
            body: messageText,
            type: "TEXT",
          });
          onConversationUpdated();
        }}
      />
    </div>
  );
};
