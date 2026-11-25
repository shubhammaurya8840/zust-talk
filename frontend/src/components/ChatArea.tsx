import React, { useState, useEffect, useRef } from "react";
import { Conversation, Message } from "../types";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { api, getFullUrl } from "../api/client";
import { Language, translations } from "../utils/i18n";
import { useBackLayer } from "../utils/useBackNavigation";
import { ReportModal } from "./ReportModal";
import { E2EEModal } from "./E2EEModal";
import { ForwardModal } from "./ForwardModal";
import {
  ArrowLeft,
  ArrowDown,
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
  Reply,
  Forward,
  Lock,
  ShieldAlert,
  Phone,
  Video,
  Languages,
  Sparkles,
} from "lucide-react";

type SendLangMode = "ORIGINAL" | "EN" | "HI";

const QUICK_EMOJIS = [
  "😀", "😂", "❤️", "🙏", "🔥", "👍",
  "🎉", "😍", "👌", "🤝", "🥳", "✨",
  "🙌", "😎", "💯", "😢", "🤔", "🇮🇳",
];

interface ChatAreaProps {
  conversation: Conversation;
  allConversations: Conversation[];
  onBack: () => void;
  onToggleInfo: () => void;
  onConversationUpdated: () => void;
  onStartCall?: (isVideo: boolean) => void;
  lang?: Language;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  conversation,
  allConversations,
  onBack,
  onToggleInfo,
  onConversationUpdated,
  onStartCall,
  lang = "en",
}) => {
  const { user } = useAuth();
  const { socket } = useSocket();
  const t = translations[lang];

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
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [isBlocked, setIsBlocked] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Smart Hindi -> English Auto-Convert on Send
  const [sendLang, setSendLang] = useState<SendLangMode>(() => {
    const saved = localStorage.getItem("zust_send_lang");
    return saved === "EN" || saved === "HI" ? saved : "ORIGINAL";
  });
  const [liveTranslation, setLiveTranslation] = useState<string>("");
  const [isTranslatingPreview, setIsTranslatingPreview] = useState(false);
  const [sendToast, setSendToast] = useState<string | null>(null);
  const translationCacheRef = useRef<{ source: string; mode: SendLangMode; result: string } | null>(null);

  // Modals state
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isE2EEOpen, setIsE2EEOpen] = useState(false);

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Register overlays with Browser Back Button navigation
  useBackLayer("chat-lightbox", 100, Boolean(previewImageUrl), () => setPreviewImageUrl(null));
  useBackLayer("chat-menu", 80, menuOpen, () => setMenuOpen(false));
  useBackLayer("chat-emoji", 80, emojiOpen, () => setEmojiOpen(false));
  useBackLayer("chat-report", 70, isReportOpen, () => setIsReportOpen(false));
  useBackLayer("chat-e2ee", 70, isE2EEOpen, () => setIsE2EEOpen(false));
  useBackLayer("chat-forward", 70, Boolean(forwardingMsg), () => setForwardingMsg(null));
  useBackLayer("chat-edit", 65, Boolean(editingMessage), () => {
    setEditingMessage(null);
    setEditBody("");
  });
  useBackLayer("chat-reply", 65, Boolean(replyingTo), () => setReplyingTo(null));

  const otherMember =
    conversation.type === "DIRECT"
      ? conversation.members.find((m) => m.userId !== user?.id)?.user
      : undefined;

  const title =
    conversation.type === "GROUP"
      ? conversation.title || "Group Chat"
      : otherMember?.displayName || otherMember?.username || "Chat";

  const showNotice = (msg: string) => {
    setSendToast(msg);
    setTimeout(() => {
      setSendToast((curr) => (curr === msg ? null : curr));
    }, 2400);
  };

  const handleChangeSendLang = (mode: SendLangMode) => {
    setSendLang(mode);
    localStorage.setItem("zust_send_lang", mode);
    translationCacheRef.current = null;
    if (mode === "ORIGINAL") {
      setLiveTranslation("");
    }
  };

  // Debounced live preview when English (or Hindi) conversion mode is selected
  useEffect(() => {
    const trimmed = inputText.trim();
    if (sendLang === "ORIGINAL" || !trimmed) {
      setLiveTranslation("");
      setIsTranslatingPreview(false);
      return;
    }

    if (
      translationCacheRef.current &&
      translationCacheRef.current.source === trimmed &&
      translationCacheRef.current.mode === sendLang
    ) {
      setLiveTranslation(translationCacheRef.current.result);
      return;
    }

    let cancelled = false;
    setIsTranslatingPreview(true);

    const timer = setTimeout(async () => {
      try {
        const target = sendLang === "EN" ? "en" : "hi";
        const res = await api.translate.convert(trimmed, target);
        if (!cancelled && res.success) {
          translationCacheRef.current = {
            source: trimmed,
            mode: sendLang,
            result: res.translatedText,
          };
          setLiveTranslation(res.translatedText);
        }
      } catch {
        if (!cancelled) setLiveTranslation("");
      } finally {
        if (!cancelled) setIsTranslatingPreview(false);
      }
    }, 360);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inputText, sendLang]);

  const loadMessages = async () => {
    try {
      setLoading(true);
      const res = await api.messages.getHistory(conversation.id);
      setMessages(res.messages);
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

  // Keep composer cleanly scrolled into view when mobile virtual keyboard opens
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handleResize = () => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    };
    vv.addEventListener("resize", handleResize);
    return () => vv.removeEventListener("resize", handleResize);
  }, []);

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
              receipts:
                receipts.length > 0
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
              const updatedReceipts =
                currentReceipts.length > 0
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

  const handleScrollMessages = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollDown(distanceFromBottom > 160);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);

    // Auto-resize textarea smoothly
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 112)}px`;
    }

    if (!socket) return;
    socket.emit("typing:start", conversation.id);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("typing:stop", conversation.id);
    }, 2000);
  };

  // Voice recording handlers
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

  // Send message (with automatic Hindi/Hinglish -> English conversion when English mode is selected!)
  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const rawText = inputText.trim();
    if (!rawText && !selectedFile) return;

    if (socket) socket.emit("typing:stop", conversation.id);

    try {
      setUploading(true);
      let finalBody = rawText;

      if (rawText && sendLang !== "ORIGINAL") {
        const cached = translationCacheRef.current;
        if (cached && cached.source === rawText && cached.mode === sendLang && cached.result) {
          finalBody = cached.result;
        } else {
          try {
            const target = sendLang === "EN" ? "en" : "hi";
            const tr = await api.translate.convert(rawText, target);
            if (tr.success && tr.translatedText) {
              finalBody = tr.translatedText;
            }
          } catch {
            // Fallback to rawText if translation service is momentarily unreachable
            finalBody = rawText;
          }
        }
        if (finalBody !== rawText) {
          showNotice(
            sendLang === "EN"
              ? "✨ Converted Hindi → English & sent"
              : "✨ हिंदी में बदलकर भेजा गया"
          );
        }
      }

      let attachmentsPayload: any = undefined;
      let msgType: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "VOICE" = "TEXT";

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
        body: finalBody || undefined,
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
      setLiveTranslation("");
      translationCacheRef.current = null;
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      setSelectedFile(null);
      setReplyingTo(null);
      setEmojiOpen(false);
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
      setSelectedMsgId(null);
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
    <div className="flex-1 flex flex-col h-full min-h-0 bg-slate-100 dark:bg-slate-950 overflow-hidden relative">
      {/* Top Pinned Header — Always visible without scrolling */}
      <div className="shrink-0 px-3 sm:px-4 py-2.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2 shadow-sm z-20">
        <div className="flex items-center space-x-2.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={onBack}
            title="Back to Chats"
            className="md:hidden p-2 -ml-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div
            onClick={conversation.type === "GROUP" ? onToggleInfo : undefined}
            className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-white shadow-sm shrink-0 ${
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
            className={`min-w-0 flex-1 ${conversation.type === "GROUP" ? "cursor-pointer" : ""}`}
          >
            <div className="flex items-center space-x-1.5 min-w-0">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight truncate">
                {title}
              </h2>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsE2EEOpen(true);
                }}
                title="E2EE Protected Session"
                className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 shrink-0"
              >
                <Lock className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {typingUsers.size > 0 ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center space-x-1 animate-pulse">
                  <span>typing...</span>
                </span>
              ) : conversation.type === "GROUP" ? (
                `${conversation.members.length} members`
              ) : (
                "Online • Encrypted"
              )}
            </p>
          </div>
        </div>

        {/* Always-Visible Call & Info Actions */}
        <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0">
          {conversation.type === "DIRECT" && otherMember && (
            <>
              <button
                type="button"
                onClick={() => onStartCall?.(false)}
                title="Voice Call"
                className="p-2 sm:px-2.5 sm:py-2 text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 bg-slate-100/80 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded-xl transition-colors flex items-center space-x-1"
              >
                <Phone className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => onStartCall?.(true)}
                title="Full-Screen HD Video Call"
                className="px-2.5 py-2 text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl transition-all shadow-sm shadow-emerald-600/20 flex items-center space-x-1.5"
              >
                <Video className="w-4 h-4" />
                <span className="text-xs font-bold hidden sm:inline">Video</span>
              </button>
            </>
          )}

          {conversation.type === "GROUP" && (
            <button
              type="button"
              onClick={onToggleInfo}
              title="Group Information"
              className="p-2 text-slate-600 dark:text-slate-300 hover:text-emerald-600 bg-slate-100 dark:bg-slate-800 rounded-xl"
            >
              <Users className="w-4 h-4" />
            </button>
          )}

          {conversation.type === "DIRECT" && otherMember && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-11 w-48 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 py-1.5 z-50 animate-scaleIn">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setIsE2EEOpen(true);
                    }}
                    className="w-full px-4 py-2 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center space-x-2"
                  >
                    <Lock className="w-4 h-4 text-emerald-600" />
                    <span>Verify Security</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setIsReportOpen(true);
                    }}
                    className="w-full px-4 py-2 text-left text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center space-x-2"
                  >
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    <span>Report User</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleBlock}
                    className="w-full px-4 py-2 text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center space-x-2 border-t border-slate-100 dark:border-slate-800"
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

      {/* Scrollable Message Timeline */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScrollMessages}
        onClick={() => {
          if (menuOpen) setMenuOpen(false);
          if (emojiOpen) setEmojiOpen(false);
        }}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4 space-y-2.5 chat-bg-pattern relative"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-xs">
            Loading messages...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 space-y-2.5 px-4">
            <div className="w-14 h-14 bg-white dark:bg-slate-800 rounded-2xl flex items-center justify-center shadow-md">
              <Sparkles className="w-7 h-7 text-emerald-600" />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Say Namaste to {title}!</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs leading-relaxed">
              Tip: Select <strong className="text-emerald-600 dark:text-emerald-400">Hindi → English</strong> below to type in Hindi or Hinglish and send directly in English!
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.senderId === user?.id;
            const isDeleted = Boolean(m.deletedAt);
            const isRead = m.receipts?.some((r) => r.readAt);
            const isActionOpen = selectedMsgId === m.id;
            const repliedMsg = m.replyToId ? messages.find((prev) => prev.id === m.replyToId) : undefined;

            return (
              <div
                key={m.id}
                className={`flex flex-col group animate-fadeIn ${
                  isMe ? "items-end ml-8 sm:ml-20" : "items-start mr-8 sm:mr-20"
                }`}
              >
                <div
                  onClick={() => !isDeleted && setSelectedMsgId(isActionOpen ? null : m.id)}
                  className={`relative max-w-[88%] sm:max-w-md px-3.5 py-2.5 rounded-2xl shadow-sm text-sm cursor-pointer sm:cursor-default transition-all ${
                    isMe
                      ? "bg-gradient-to-br from-emerald-600 to-teal-600 text-white rounded-br-sm"
                      : "bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-bl-sm border border-slate-200/80 dark:border-slate-700"
                  }`}
                >
                  {!isMe && conversation.type === "GROUP" && (
                    <p className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-0.5">
                      {m.sender?.displayName || m.sender?.username}
                    </p>
                  )}

                  {repliedMsg && !isDeleted && (
                    <div
                      className={`mb-2 p-2 rounded-xl text-xs border-l-4 ${
                        isMe
                          ? "bg-black/20 border-emerald-200 text-emerald-50"
                          : "bg-slate-100 dark:bg-slate-900 border-emerald-500 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      <p className="font-bold text-[10px] opacity-90">
                        {repliedMsg.sender?.displayName || repliedMsg.sender?.username || "Reply"}
                      </p>
                      <p className="truncate text-[11px]">{repliedMsg.body || "Attachment"}</p>
                    </div>
                  )}

                  {isDeleted ? (
                    <p className={`italic text-xs ${isMe ? "text-emerald-100" : "text-slate-400"}`}>
                      This message was deleted
                    </p>
                  ) : (
                    <>
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
                                className="rounded-xl max-h-64 w-auto object-cover cursor-pointer hover:opacity-95 transition-opacity"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setPreviewImageUrl(fileUrl);
                                }}
                              />
                            </div>
                          );
                        }

                        if (isVideo) {
                          return (
                            <div key={att.id} className="mb-2" onClick={(e) => e.stopPropagation()}>
                              <video
                                src={fileUrl}
                                controls
                                className="rounded-xl max-h-64 w-full bg-black"
                              />
                            </div>
                          );
                        }

                        if (isAudio) {
                          return (
                            <div key={att.id} className="mb-2" onClick={(e) => e.stopPropagation()}>
                              <audio src={fileUrl} controls className="w-full max-w-[240px] h-10" />
                            </div>
                          );
                        }

                        return (
                          <div key={att.id} className="mb-2" onClick={(e) => e.stopPropagation()}>
                            <a
                              href={fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={`flex items-center space-x-2 p-2.5 rounded-xl border ${
                                isMe
                                  ? "bg-black/20 border-white/20 text-white"
                                  : "bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
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

                      {m.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>}
                    </>
                  )}

                  <div
                    className={`flex items-center justify-end space-x-1 mt-1 text-[10px] select-none ${
                      isMe ? "text-emerald-100/90" : "text-slate-400"
                    }`}
                  >
                    {m.editedAt && !isDeleted && <span>(edited)</span>}
                    <span>{formatMsgTime(m.createdAt)}</span>
                    {isMe && !isDeleted && (
                      <span className="ml-0.5 inline-flex items-center" title={isRead ? "Seen" : "Sent"}>
                        {isRead ? (
                          <CheckCheck className="w-3.5 h-3.5 text-sky-300 font-bold inline" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-emerald-200 inline" />
                        )}
                      </span>
                    )}
                  </div>
                </div>

                {!isDeleted && (
                  <div
                    className={`${
                      isActionOpen ? "opacity-100 flex" : "opacity-0 hidden sm:flex sm:group-hover:opacity-100"
                    } transition-opacity items-center space-x-2.5 mt-1 px-1.5`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setReplyingTo(m);
                        setSelectedMsgId(null);
                      }}
                      className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-emerald-600 flex items-center space-x-1"
                    >
                      <Reply className="w-3 h-3" />
                      <span>Reply</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setForwardingMsg(m);
                        setSelectedMsgId(null);
                      }}
                      className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-emerald-600 flex items-center space-x-1"
                    >
                      <Forward className="w-3 h-3" />
                      <span>Forward</span>
                    </button>
                    {isMe && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMessage(m);
                            setEditBody(m.body || "");
                            setSelectedMsgId(null);
                          }}
                          className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-emerald-600 flex items-center space-x-1"
                        >
                          <Edit2 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMessage(m.id)}
                          className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-red-600 flex items-center space-x-1"
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
          <div className="flex items-center space-x-2 bg-white dark:bg-slate-800 px-3.5 py-2 rounded-2xl rounded-tl-xs shadow-sm border border-slate-200/80 dark:border-slate-700 w-fit text-xs text-slate-600 dark:text-slate-300 my-1">
            <div className="flex space-x-1 items-center py-1">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" />
            </div>
            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
              {conversation.type === "DIRECT" ? `${title} is typing...` : "Someone is typing..."}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll-To-Bottom Floating Button */}
      {showScrollDown && (
        <button
          type="button"
          onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
          title="Jump to latest messages"
          className="absolute right-4 bottom-28 z-20 p-2.5 rounded-full bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-lg border border-slate-200 dark:border-slate-700 hover:scale-105 transition-transform"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {/* Subtle Conversion Notification Pill */}
      {sendToast && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-slate-900/90 dark:bg-emerald-900/95 text-white text-xs font-medium shadow-lg backdrop-blur-md animate-fadeIn whitespace-nowrap">
          {sendToast}
        </div>
      )}

      {/* Reply Quote Banner */}
      {replyingTo && (
        <div className="shrink-0 bg-emerald-50 dark:bg-emerald-950/60 border-t border-emerald-200 dark:border-emerald-800 px-4 py-2 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 truncate">
            <Reply className="w-4 h-4 text-emerald-600 shrink-0" />
            <div className="truncate">
              <span className="font-bold text-emerald-800 dark:text-emerald-300">
                Replying to {replyingTo.sender?.displayName || "Message"}:
              </span>
              <span className="text-slate-600 dark:text-slate-300 ml-1 truncate">
                {replyingTo.body || "Attachment"}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="p-1 text-slate-400 hover:text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Edit Message Banner */}
      {editingMessage && (
        <form
          onSubmit={handleEditSubmit}
          className="shrink-0 bg-amber-50 dark:bg-amber-950/50 border-t border-amber-200 dark:border-amber-800 px-4 py-2 flex items-center justify-between"
        >
          <div className="flex-1 mr-2">
            <span className="text-[10px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider block">
              Editing Message
            </span>
            <input
              type="text"
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="w-full text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-amber-300 dark:border-amber-700 rounded-lg px-2.5 py-1.5 mt-0.5 focus:outline-none focus:ring-1 focus:ring-amber-500"
              autoFocus
            />
          </div>
          <div className="flex items-center space-x-1">
            <button
              type="submit"
              className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700"
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
        <div className="shrink-0 bg-slate-200/80 dark:bg-slate-800 px-4 py-2 flex items-center justify-between text-xs text-slate-700 dark:text-slate-200 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center space-x-2 truncate">
            <Paperclip className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold truncate">{selectedFile.name}</span>
            <span className="text-slate-400">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
          </div>
          <button
            type="button"
            onClick={() => setSelectedFile(null)}
            className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Live Translation Preview Chip when English or Hindi Conversion is Selected */}
      {sendLang !== "ORIGINAL" && inputText.trim().length > 0 && (
        <div className="shrink-0 px-3 sm:px-4 py-1.5 bg-emerald-50/90 dark:bg-emerald-950/60 border-t border-emerald-200/80 dark:border-emerald-900 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
              {sendLang === "EN" ? "English:" : "हिंदी:"}
            </span>
            <span className="text-slate-700 dark:text-slate-200 truncate">
              {isTranslatingPreview ? "Converting..." : liveTranslation || inputText}
            </span>
          </div>
        </div>
      )}

      {/* Pinned Bottom Input Bar + Smart Hindi->English Selector */}
      <div className="shrink-0 px-2.5 sm:px-3.5 pt-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] bg-white dark:bg-slate-900 border-t border-slate-200/90 dark:border-slate-800 relative">
        {/* Emoji Picker Popover */}
        {emojiOpen && (
          <div className="absolute bottom-full left-3 mb-2 p-2.5 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 grid grid-cols-6 gap-1.5 z-30 animate-scaleIn">
            {QUICK_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setInputText((prev) => prev + em)}
                className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-center text-lg transition-transform hover:scale-110"
              >
                {em}
              </button>
            ))}
          </div>
        )}

        {/* Smart Language Mode Selector Strip (Always visible, zero scroll!) */}
        <div className="flex items-center justify-between gap-2 pb-1.5 overflow-x-auto no-scrollbar">
          <div className="flex items-center space-x-1 text-[11px] shrink-0">
            <span className="text-slate-400 dark:text-slate-500 flex items-center space-x-1 mr-0.5 font-medium">
              <Languages className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="hidden sm:inline">Send in:</span>
            </span>

            <button
              type="button"
              onClick={() => handleChangeSendLang("ORIGINAL")}
              className={`px-2.5 py-0.5 rounded-full font-semibold transition-all ${
                sendLang === "ORIGINAL"
                  ? "bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
              }`}
            >
              {t.originalMode}
            </button>

            <button
              type="button"
              onClick={() => handleChangeSendLang("EN")}
              className={`px-2.5 py-0.5 rounded-full font-bold transition-all flex items-center space-x-1 ${
                sendLang === "EN"
                  ? "bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-sm shadow-emerald-600/25"
                  : "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800 hover:bg-emerald-100"
              }`}
            >
              <Sparkles className="w-3 h-3" />
              <span>English (हिंदी → EN)</span>
            </button>

            <button
              type="button"
              onClick={() => handleChangeSendLang("HI")}
              className={`px-2.5 py-0.5 rounded-full font-semibold transition-all ${
                sendLang === "HI"
                  ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200"
              }`}
            >
              {t.toHindiMode}
            </button>
          </div>
        </div>

        {isRecording ? (
          <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-2xl px-4 py-2.5">
            <div className="flex items-center space-x-2">
              <span className="w-3 h-3 bg-red-600 rounded-full animate-ping" />
              <span className="text-xs font-bold text-red-700 dark:text-red-300">
                Recording: {formatRecordTime(recordingTime)}
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={cancelRecording}
                className="px-3 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg"
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
            className="flex items-end space-x-1.5 sm:space-x-2"
          >
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
              className="p-2.5 text-slate-500 dark:text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setEmojiOpen((prev) => !prev)}
              title="Emoji"
              className={`p-2.5 rounded-xl transition-colors shrink-0 ${
                emojiOpen
                  ? "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50"
                  : "text-slate-500 dark:text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              <Smile className="w-5 h-5" />
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                sendLang === "EN"
                  ? t.typeHindiToEnPlaceholder
                  : sendLang === "HI"
                  ? "Type English/Hinglish (sends in हिंदी)..."
                  : t.typeMessage
              }
              className="flex-1 py-2.5 px-3.5 text-sm rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 border border-transparent focus:bg-white dark:focus:bg-slate-950 focus:border-emerald-500 focus:outline-none resize-none max-h-28 transition-all"
            />

            {!inputText.trim() && !selectedFile ? (
              <button
                type="button"
                onClick={startRecording}
                title="Record voice note"
                className="p-2.5 text-slate-500 dark:text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors shrink-0"
              >
                <Mic className="w-5 h-5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={uploading}
                title={sendLang === "EN" ? "Convert to English & Send" : "Send"}
                className="p-2.5 px-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl disabled:opacity-40 transition-all shrink-0 shadow-md shadow-emerald-600/25 active:scale-95 flex items-center space-x-1"
              >
                <Send className="w-4 h-4" />
                {sendLang === "EN" && <span className="text-[11px] font-bold hidden sm:inline">EN</span>}
              </button>
            )}
          </form>
        )}
      </div>

      {/* In-App Image Lightbox (Back button closes cleanly!) */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
        >
          <button
            type="button"
            onClick={() => setPreviewImageUrl(null)}
            className="absolute top-4 right-4 p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={previewImageUrl}
            alt="Preview"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-[85dvh] rounded-2xl shadow-2xl object-contain"
          />
        </div>
      )}

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
