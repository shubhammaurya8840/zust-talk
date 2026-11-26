import React, { useState, useEffect, useRef } from "react";
import { Conversation, Message, User } from "../types";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { api, getFullUrl } from "../api/client";
import { Language, translations } from "../utils/i18n";
import { useBackLayer } from "../utils/useBackNavigation";
import { UserAvatar } from "../utils/avatars";
import { formatLastSeen } from "../utils/presence";
import { TARGET_LANGUAGES, SOURCE_LANGUAGES, smartTranslate } from "../utils/translate";
import { ReportModal } from "./ReportModal";
import { E2EEModal } from "./E2EEModal";
import { ForwardModal } from "./ForwardModal";
import { CameraModal } from "./CameraModal";
import {
  ArrowLeft,
  ArrowDown,
  Send,
  Paperclip,
  Camera,
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
  Eye,
  Archive,
  BarChart3,
  Plus,
} from "lucide-react";

const QUICK_EMOJIS = [
  "😀", "😂", "😍", "🥹", "😎", "🥳",
  "❤️", "🔥", "👍", "👏", "🙏", "🤝",
  "👌", "✨", "💯", "🎉", "🤔", "😢",
  "😡", "😱", "😴", "🤗", "🤩", "🇮🇳",
];

interface ChatAreaProps {
  conversation: Conversation;
  allConversations: Conversation[];
  onBack: () => void;
  onToggleInfo: () => void;
  onConversationUpdated: () => void;
  onStartCall?: (isVideo: boolean) => void;
  onStartGroupCall?: (isVideo: boolean) => void;
  onViewProfile?: (user: User) => void;
  onToggleArchive?: (conversationId: string, archived: boolean) => void;
  lang?: Language;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  conversation,
  allConversations,
  onBack,
  onToggleInfo,
  onConversationUpdated,
  onStartCall,
  onStartGroupCall,
  onViewProfile,
  onToggleArchive,
  lang = "en",
}) => {
  const { user } = useAuth();
  const { socket, presenceMap } = useSocket();
  const t = translations[lang];

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isViewOnceSelected, setIsViewOnceSelected] = useState(false);
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
  const [viewOnceUrl, setViewOnceUrl] = useState<string | null>(null);
  const [isWindowBlurred, setIsWindowBlurred] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [securityBanner, setSecurityBanner] = useState<string | null>(null);

  // Smart Translator: OFF by default! Opens only when user taps Translate icon; defaults target to peer's primaryLanguage
  const [isTranslatorOpen, setIsTranslatorOpen] = useState(false);
  const [sourceLang, setSourceLang] = useState<string>("auto");
  const [targetLang, setTargetLang] = useState<string>("ORIGINAL");
  const [liveTranslation, setLiveTranslation] = useState<string>("");
  const [isTranslatingPreview, setIsTranslatingPreview] = useState(false);
  const [translatedBubbles, setTranslatedBubbles] = useState<Record<string, string>>({});
  const [sendToast, setSendToast] = useState<string | null>(null);
  const translationCacheRef = useRef<{ source: string; srcLang: string; tgtLang: string; result: string } | null>(null);

  // Modals state
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isE2EEOpen, setIsE2EEOpen] = useState(false);
  const [isPollModalOpen, setIsPollModalOpen] = useState(false);
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState<string[]>(["", ""]);
  const [pollSubmitting, setPollSubmitting] = useState(false);

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
  const lastAlertSentRef = useRef<number>(0);
  const suppressAlertUntilRef = useRef<number>(0);
  const lastModifierAtRef = useRef<number>(0);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Back Button handlers
  useBackLayer("chat-camera", 105, isCameraOpen, () => setIsCameraOpen(false));
  useBackLayer("chat-poll", 90, isPollModalOpen, () => setIsPollModalOpen(false));
  useBackLayer("chat-viewonce", 102, Boolean(viewOnceUrl), () => setViewOnceUrl(null));
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

  const myMembership = conversation.members.find((m) => m.userId === user?.id);
  const isArchived = Boolean(myMembership?.archivedAt);

  const title =
    conversation.type === "GROUP"
      ? conversation.title || "Group Chat"
      : otherMember?.displayName || otherMember?.username || "Chat";

  const livePresence = otherMember ? presenceMap[otherMember.id] : undefined;
  const isOtherOnline = livePresence ? livePresence.isOnline : Boolean(otherMember?.isOnline);
  const otherLastSeen = livePresence?.lastSeenAt ?? otherMember?.lastSeenAt;

  const showNotice = (msg: string) => {
    setSendToast(msg);
    setTimeout(() => {
      setSendToast((curr) => (curr === msg ? null : curr));
    }, 2400);
  };

  const triggerSecurityAlert = (kind: "screenshot" | "screen_record") => {
    const now = Date.now();
    if (now - lastAlertSentRef.current < 2500) return;
    lastAlertSentRef.current = now;
    const localMsg =
      kind === "screen_record"
        ? "🚨 Screen recording detected! Alert posted in chat."
        : "📸 Screenshot detected! Alert posted in chat.";
    setSecurityBanner(localMsg);
    setTimeout(() => {
      setSecurityBanner((curr) => (curr === localMsg ? null : curr));
    }, 5000);

    api.conversations
      .sendSecurityAlert(conversation.id, kind)
      .then((res) => {
        if (res?.success && res.message) {
          setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
          onConversationUpdated();
        }
      })
      .catch(() => {
        socket?.emit("chat:security_alert", { conversationId: conversation.id, kind });
      });
  };

  // Screenshot & Screen Recording Detection + View-Once Blur Protection + Read Sync
  useEffect(() => {
    let blurStartedAt = 0;
    let blurWhileVisible = false;
    let hiddenStartedAt = 0;

    const checkKeyEvent = (e: KeyboardEvent) => {
      const key = (e.key || "").toLowerCase();
      if (e.metaKey || e.shiftKey || e.altKey || key === "meta" || key === "os" || key === "shift") {
        lastModifierAtRef.current = Date.now();
      }
      const isPrintScreen =
        e.key === "PrintScreen" || e.code === "PrintScreen" || e.keyCode === 44;
      const isMacScreenshot = e.metaKey && e.shiftKey && ["3", "4", "5", "6"].includes(key);
      const isWinSnip = e.metaKey && e.shiftKey && key === "s";
      const isWebCapture = e.ctrlKey && e.shiftKey && key === "s";
      const isPrintShortcut = (e.ctrlKey || e.metaKey) && key === "p";
      const isScreenRecShortcut =
        (e.metaKey && e.altKey && key === "r") ||
        (e.metaKey && key === "g") ||
        (e.ctrlKey && e.shiftKey && key === "r");

      if (isScreenRecShortcut) {
        triggerSecurityAlert("screen_record");
      } else if (isPrintScreen || isMacScreenshot || isWinSnip || isWebCapture || isPrintShortcut) {
        triggerSecurityAlert("screenshot");
      }
    };

    const handleBeforePrint = () => {
      triggerSecurityAlert("screenshot");
    };

    const handleBlur = () => {
      setIsWindowBlurred(true);
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
      if (Date.now() < suppressAlertUntilRef.current) return;
      if (document.activeElement?.tagName === "SELECT") return;

      if (document.visibilityState === "visible") {
        blurStartedAt = Date.now();
        blurWhileVisible = true;
        if (Date.now() - lastModifierAtRef.current < 1500) {
          triggerSecurityAlert("screenshot");
          blurWhileVisible = false;
          return;
        }
        // Catch desktop Snipping Tool or mobile screenshot / quick-settings overlay hovering over visible tab
        overlayTimerRef.current = setTimeout(() => {
          overlayTimerRef.current = null;
          if (
            document.visibilityState === "visible" &&
            !document.hasFocus() &&
            Date.now() >= suppressAlertUntilRef.current
          ) {
            triggerSecurityAlert("screenshot");
            blurWhileVisible = false;
          }
        }, 240);
      }
    };

    const handleFocus = () => {
      setIsWindowBlurred(false);
      if (overlayTimerRef.current) {
        clearTimeout(overlayTimerRef.current);
        overlayTimerRef.current = null;
      }
      if (!document.hidden && document.visibilityState === "visible") {
        api.messages.markConversationRead(conversation.id).catch(() => {});
      }
      // Catch ultra-fast mobile screenshot / floating overlay flash (< 240ms) that briefly stole focus while visible
      if (blurWhileVisible) {
        const elapsed = Date.now() - blurStartedAt;
        blurWhileVisible = false;
        if (
          elapsed >= 35 &&
          elapsed <= 4500 &&
          document.visibilityState === "visible" &&
          Date.now() >= suppressAlertUntilRef.current &&
          lastAlertSentRef.current < blurStartedAt
        ) {
          triggerSecurityAlert("screenshot");
        }
      }
    };

    const handleVis = () => {
      const hidden = document.visibilityState === "hidden";
      setIsWindowBlurred(hidden);
      if (hidden) {
        hiddenStartedAt = Date.now();
        blurWhileVisible = false;
        if (overlayTimerRef.current) {
          clearTimeout(overlayTimerRef.current);
          overlayTimerRef.current = null;
        }
      } else {
        api.messages.markConversationRead(conversation.id).catch(() => {});
        if (hiddenStartedAt > 0) {
          const hiddenElapsed = Date.now() - hiddenStartedAt;
          hiddenStartedAt = 0;
          if (
            hiddenElapsed >= 60 &&
            hiddenElapsed <= 1700 &&
            Date.now() >= suppressAlertUntilRef.current
          ) {
            triggerSecurityAlert("screenshot");
          }
        }
      }
    };

    window.addEventListener("keydown", checkKeyEvent, true);
    window.addEventListener("keyup", checkKeyEvent, true);
    document.addEventListener("keydown", checkKeyEvent, true);
    document.addEventListener("keyup", checkKeyEvent, true);
    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVis);

    const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (...args: any[]) => Promise<MediaStream> };
    const origGetDisplayMedia = md?.getDisplayMedia?.bind(md);
    if (md && origGetDisplayMedia) {
      md.getDisplayMedia = async (...args: any[]) => {
        triggerSecurityAlert("screen_record");
        return origGetDisplayMedia(...args);
      };
    }

    return () => {
      if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
      window.removeEventListener("keydown", checkKeyEvent, true);
      window.removeEventListener("keyup", checkKeyEvent, true);
      document.removeEventListener("keydown", checkKeyEvent, true);
      document.removeEventListener("keyup", checkKeyEvent, true);
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVis);
      if (md && origGetDisplayMedia) {
        md.getDisplayMedia = origGetDisplayMedia;
      }
    };
  }, [conversation.id, socket]);

  const handleChangeSourceLang = (code: string) => {
    setSourceLang(code);
    translationCacheRef.current = null;
  };

  const handleChangeTargetLang = (code: string) => {
    setTargetLang(code);
    translationCacheRef.current = null;
    if (code === "ORIGINAL") {
      setLiveTranslation("");
      setIsTranslatorOpen(false);
    }
  };

  const handleToggleTranslator = () => {
    if (isTranslatorOpen) {
      setIsTranslatorOpen(false);
      setTargetLang("ORIGINAL");
      setLiveTranslation("");
      translationCacheRef.current = null;
    } else {
      const peerPrimary = otherMember?.primaryLanguage || user?.primaryLanguage || "en";
      setSourceLang("auto");
      setTargetLang(peerPrimary);
      setIsTranslatorOpen(true);
      translationCacheRef.current = null;
    }
  };

  // Debounced live translation preview
  useEffect(() => {
    const trimmed = inputText.trim();
    if (targetLang === "ORIGINAL" || !trimmed) {
      setLiveTranslation("");
      setIsTranslatingPreview(false);
      return;
    }

    if (
      translationCacheRef.current &&
      translationCacheRef.current.source === trimmed &&
      translationCacheRef.current.srcLang === sourceLang &&
      translationCacheRef.current.tgtLang === targetLang
    ) {
      setLiveTranslation(translationCacheRef.current.result);
      return;
    }

    let cancelled = false;
    setIsTranslatingPreview(true);

    const timer = setTimeout(async () => {
      const res = await smartTranslate(trimmed, targetLang, sourceLang);
      if (!cancelled) {
        translationCacheRef.current = {
          source: trimmed,
          srcLang: sourceLang,
          tgtLang: targetLang,
          result: res.translatedText,
        };
        setLiveTranslation(res.translatedText);
        setIsTranslatingPreview(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inputText, sourceLang, targetLang]);

  const loadMessages = async () => {
    try {
      setLoading(true);
      const res = await api.messages.getHistory(conversation.id);
      setMessages(res.messages);
      if (!document.hidden && document.visibilityState === "visible") {
        api.messages.markConversationRead(conversation.id).catch(() => {});
      }
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
        if (msg.type === "SYSTEM" && msg.body) {
          setSecurityBanner(msg.body);
          setTimeout(() => {
            setSecurityBanner((curr) => (curr === msg.body ? null : curr));
          }, 5000);
        }
        if (msg.senderId !== user?.id && msg.type !== "SYSTEM" && !document.hidden && document.visibilityState === "visible") {
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

    const handleReceipt = ({
      messageId,
      userId: readerId,
      readAt,
    }: {
      messageId: string;
      userId: string;
      readAt: string;
    }) => {
      if (readerId === user?.id) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === messageId) {
            const receipts = m.receipts || [];
            const hasReader = receipts.some((r) => r.userId === readerId);
            return {
              ...m,
              receipts: hasReader
                ? receipts.map((r) =>
                    r.userId === readerId ? { ...r, readAt: r.readAt || readAt, deliveredAt: r.deliveredAt || readAt } : r
                  )
                : [...receipts, { id: `temp-${readerId}`, messageId: m.id, userId: readerId, deliveredAt: readAt, readAt }],
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
      if (cId === conversation.id && readerId !== user?.id) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.senderId === user?.id) {
              const currentReceipts = m.receipts || [];
              const hasReader = currentReceipts.some((r) => r.userId === readerId);
              const updatedReceipts = hasReader
                ? currentReceipts.map((r) =>
                    r.userId === readerId
                      ? { ...r, readAt: r.readAt || readAt, deliveredAt: r.deliveredAt || readAt }
                      : r
                  )
                : [...currentReceipts, { id: `temp-${readerId}`, messageId: m.id, userId: readerId, deliveredAt: readAt, readAt }];
              return { ...m, receipts: updatedReceipts };
            }
            return m;
          })
        );
      }
    };

    const handleTypingStart = ({ conversationId: cId, userId: typingId }: { conversationId?: string; userId: string }) => {
      if ((!cId || cId === conversation.id) && typingId !== user?.id) {
        setTypingUsers((prev) => new Set(prev).add(typingId));
      }
    };

    const handleTypingStop = ({ conversationId: cId, userId: typingId }: { conversationId?: string; userId: string }) => {
      if (!cId || cId === conversation.id) {
        setTypingUsers((prev) => {
          const next = new Set(prev);
          next.delete(typingId);
          return next;
        });
      }
    };

    const handlePollUpdated = ({
      conversationId: cId,
      messageId,
      poll,
    }: {
      conversationId: string;
      messageId: string;
      poll: NonNullable<Message["poll"]>;
    }) => {
      if (cId === conversation.id) {
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, poll } : m))
        );
      }
    };

    socket.on("message:new", handleNewMessage);
    socket.on("message:updated", handleUpdatedMessage);
    socket.on("message:deleted", handleDeletedMessage);
    socket.on("message:receipt", handleReceipt);
    socket.on("conversation:read", handleConversationRead);
    socket.on("poll:updated", handlePollUpdated);
    socket.on("typing:start", handleTypingStart);
    socket.on("typing:stop", handleTypingStop);

    return () => {
      socket.emit("conversation:leave", conversation.id);
      socket.off("message:new", handleNewMessage);
      socket.off("message:updated", handleUpdatedMessage);
      socket.off("message:deleted", handleDeletedMessage);
      socket.off("message:receipt", handleReceipt);
      socket.off("conversation:read", handleConversationRead);
      socket.off("poll:updated", handlePollUpdated);
      socket.off("typing:start", handleTypingStart);
      socket.off("typing:stop", handleTypingStop);
    };
  }, [socket, conversation.id, user?.id]);

  const handleScrollMessages = () => {
    const el = messagesContainerRef.current;
    if (!el) return;
    setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
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

  const startRecording = async () => {
    suppressAlertUntilRef.current = Date.now() + 8000;
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
      recordIntervalRef.current = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    } catch {
      alert("Microphone permission is required.");
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

  const handleSendPhotoFile = async (file: File, isViewOnce: boolean) => {
    const uploaded = await api.uploads.upload(file);
    const res = await api.messages.send({
      conversationId: conversation.id,
      body: isViewOnce ? "📷 Photo" : undefined,
      type: "IMAGE",
      isViewOnce,
      attachments: [
        {
          originalName: uploaded.originalName,
          storagePath: uploaded.url,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
        },
      ],
    });
    if (res.success && res.message) {
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
    }
    onConversationUpdated();
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const rawText = inputText.trim();
    if (!rawText && !selectedFile) return;

    if (socket) socket.emit("typing:stop", conversation.id);

    try {
      setUploading(true);
      let finalBody = rawText;

      if (rawText && targetLang !== "ORIGINAL") {
        const cached = translationCacheRef.current;
        if (
          cached &&
          cached.source === rawText &&
          cached.srcLang === sourceLang &&
          cached.tgtLang === targetLang &&
          cached.result
        ) {
          finalBody = cached.result;
        } else {
          const tr = await smartTranslate(rawText, targetLang, sourceLang);
          finalBody = tr.translatedText || rawText;
        }
        if (finalBody !== rawText) {
          const tgtLabel = TARGET_LANGUAGES.find((l) => l.code === targetLang)?.short || targetLang;
          showNotice(`Translated to ${tgtLabel} & sent`);
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
        isViewOnce: msgType === "IMAGE" ? isViewOnceSelected : false,
        replyToId: replyingTo ? replyingTo.id : undefined,
        attachments: attachmentsPayload,
      });

      if (res.success && res.message) {
        setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      }

      setInputText("");
      setLiveTranslation("");
      translationCacheRef.current = null;
      if (textareaRef.current) textareaRef.current.style.height = "auto";
      setSelectedFile(null);
      setIsViewOnceSelected(false);
      setReplyingTo(null);
      setEmojiOpen(false);
      onConversationUpdated();
    } catch (err: any) {
      alert(err.message || "Failed to send message");
    } finally {
      setUploading(false);
    }
  };

  const handleOpenViewOnce = async (m: Message) => {
    if (m.senderId === user?.id) {
      showNotice(m.viewedAt ? "Opened by recipient" : "Recipient hasn't opened yet");
      return;
    }
    if (m.viewedAt) {
      showNotice("View-once photo already opened");
      return;
    }
    try {
      const res = await api.messages.openViewOnce(m.id);
      const url = res.attachments?.[0]?.storagePath ? getFullUrl(res.attachments[0].storagePath) : null;
      if (url) {
        setViewOnceUrl(url);
      }
      setMessages((prev) =>
        prev.map((item) =>
          item.id === m.id ? { ...item, viewedAt: res.viewedAt || new Date().toISOString() } : item
        )
      );
    } catch (err: any) {
      showNotice(err.message || "Photo already viewed");
    }
  };

  const handleTranslateIncoming = async (m: Message) => {
    if (!m.body) return;
    const tgt = targetLang !== "ORIGINAL" ? targetLang : lang === "hi" ? "hi" : "en";
    const res = await smartTranslate(m.body, tgt, "auto");
    setTranslatedBubbles((prev) => ({ ...prev, [m.id]: res.translatedText }));
    setSelectedMsgId(null);
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

  const formatMsgTime = (dateStr: string) => new Date(dateStr).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const formatRecordTime = (seconds: number) =>
    `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

  const handleHeaderProfileClick = () => {
    if (conversation.type === "GROUP") {
      onToggleInfo();
    } else if (otherMember && onViewProfile) {
      onViewProfile(otherMember);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-slate-100 dark:bg-slate-950 overflow-hidden relative">
      {/* Top Pinned Header */}
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
            onClick={handleHeaderProfileClick}
            className="flex items-center space-x-2.5 min-w-0 flex-1 cursor-pointer group"
          >
            {conversation.type === "GROUP" ? (
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-sm shrink-0">
                <Users className="w-5 h-5" />
              </div>
            ) : (
              <UserAvatar
                name={otherMember?.displayName}
                username={otherMember?.username}
                avatarUrl={otherMember?.avatarUrl}
                size="md"
                isOnline={isOtherOnline}
                showOnlineDot
              />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-1.5 min-w-0">
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight truncate group-hover:text-emerald-600 transition-colors">
                  {title}
                </h2>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsE2EEOpen(true);
                  }}
                  title="E2EE Protected Session"
                  className="text-emerald-600 dark:text-emerald-400 shrink-0"
                >
                  <Lock className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {typingUsers.size > 0 ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold animate-pulse">
                    typing...
                  </span>
                ) : conversation.type === "GROUP" ? (
                  `${conversation.members.length} members`
                ) : (
                  <span className={isOtherOnline ? "text-emerald-600 dark:text-emerald-400 font-semibold" : ""}>
                    {formatLastSeen(isOtherOnline, otherLastSeen)}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Always-Visible Call & Menu Actions (Direct & Group Calls!) */}
        <div className="flex items-center space-x-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              suppressAlertUntilRef.current = Date.now() + 8000;
              conversation.type === "GROUP" ? onStartGroupCall?.(false) : onStartCall?.(false);
            }}
            title={conversation.type === "GROUP" ? "Group Audio Call" : "Audio Call"}
            className="p-2 text-slate-600 dark:text-slate-300 hover:text-emerald-600 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 rounded-xl transition-colors"
          >
            <Phone className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              suppressAlertUntilRef.current = Date.now() + 8000;
              conversation.type === "GROUP" ? onStartGroupCall?.(true) : onStartCall?.(true);
            }}
            title={conversation.type === "GROUP" ? "Group Video Call" : "Video Call"}
            className="px-2.5 py-2 text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl transition-all shadow-sm flex items-center space-x-1"
          >
            <Video className="w-4 h-4" />
            <span className="text-xs font-bold hidden sm:inline">Video</span>
          </button>

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
                {conversation.type === "GROUP" && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleInfo();
                    }}
                    className="w-full px-4 py-2 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center space-x-2"
                  >
                    <Users className="w-4 h-4 text-emerald-600" />
                    <span>Group Info</span>
                  </button>
                )}

                {onToggleArchive && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onToggleArchive(conversation.id, !isArchived);
                    }}
                    className="w-full px-4 py-2 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center space-x-2"
                  >
                    <Archive className="w-4 h-4 text-amber-600" />
                    <span>{isArchived ? "Unarchive Chat" : "Archive Chat"}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setIsPollModalOpen(true);
                  }}
                  className="w-full px-4 py-2 text-left text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center space-x-2"
                >
                  <BarChart3 className="w-4 h-4 text-emerald-600" />
                  <span>Create Poll</span>
                </button>

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

                {conversation.type === "DIRECT" && otherMember && (
                  <>
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
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Instant Screenshot / Screen Recording Alert Banner */}
      {securityBanner && (
        <div className="shrink-0 px-4 py-2 bg-amber-500 text-slate-950 text-xs font-bold flex items-center justify-between shadow-md z-20 animate-fadeIn">
          <span>{securityBanner}</span>
          <button
            type="button"
            onClick={() => setSecurityBanner(null)}
            className="p-0.5 hover:bg-black/10 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

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
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 space-y-2 px-4">
            <Smile className="w-10 h-10 text-emerald-600/70" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No messages yet</p>
            <p className="text-xs text-slate-400">Say hello to start the conversation.</p>
          </div>
        ) : (
          messages.map((m) => {
            // Centered Security / System Alert Bubble (e.g., Screenshot / Screen Recording Notice)
            if (m.type === "SYSTEM") {
              return (
                <div key={m.id} className="flex justify-center my-2 animate-fadeIn">
                  <span className="px-3.5 py-1 rounded-full bg-amber-100/90 dark:bg-amber-950/70 border border-amber-300/70 dark:border-amber-800 text-[11px] font-semibold text-amber-900 dark:text-amber-200 shadow-sm text-center">
                    {m.body}
                  </span>
                </div>
              );
            }

            const isMe = m.senderId === user?.id;
            const isDeleted = Boolean(m.deletedAt);
            const otherReceipts = (m.receipts || []).filter((r) => r.userId !== user?.id);
            const isRead = otherReceipts.length > 0 && otherReceipts.some((r) => Boolean(r.readAt));
            const isActionOpen = selectedMsgId === m.id;
            const repliedMsg = m.replyToId ? messages.find((prev) => prev.id === m.replyToId) : undefined;
            const isViewOnce = Boolean(m.isViewOnce);

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
                    <p
                      onClick={(e) => {
                        e.stopPropagation();
                        const memberUser = conversation.members.find((cm) => cm.userId === m.senderId)?.user;
                        if (memberUser && onViewProfile) onViewProfile(memberUser);
                      }}
                      className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 mb-0.5 cursor-pointer hover:underline"
                    >
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
                  ) : m.type === "POLL" && m.poll ? (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="min-w-[210px] sm:min-w-[260px] space-y-2 py-0.5"
                    >
                      <div className="flex items-center space-x-1.5 text-[11px] font-bold uppercase tracking-wide opacity-80">
                        <BarChart3 className="w-3.5 h-3.5" />
                        <span>Poll</span>
                      </div>
                      <p className="font-bold text-sm leading-snug">{m.poll.question}</p>
                      <div className="space-y-1.5 pt-1">
                        {(() => {
                          const totalVotes = m.poll.options.reduce((sum, o) => sum + (o.votes?.length || 0), 0);
                          return m.poll.options.map((opt) => {
                            const votesCount = opt.votes?.length || 0;
                            const pct = totalVotes > 0 ? Math.round((votesCount / totalVotes) * 100) : 0;
                            const votedByMe = opt.votes?.some((v) => v.userId === user?.id);
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={async () => {
                                  try {
                                    const res = await api.polls.vote(m.poll!.id, opt.id);
                                    if (res?.poll) {
                                      setMessages((prev) =>
                                        prev.map((item) => (item.id === m.id ? { ...item, poll: res.poll } : item))
                                      );
                                    }
                                  } catch {}
                                }}
                                className={`relative w-full overflow-hidden rounded-xl border px-3 py-2 text-left text-xs transition-all ${
                                  isMe
                                    ? votedByMe
                                      ? "border-white bg-white/20 font-bold text-white"
                                      : "border-white/30 bg-black/15 hover:bg-black/25 text-white"
                                    : votedByMe
                                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 font-bold text-emerald-700 dark:text-emerald-300"
                                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 hover:border-emerald-400"
                                }`}
                              >
                                <div
                                  className={`absolute inset-y-0 left-0 transition-all duration-300 ${
                                    isMe ? "bg-white/20" : "bg-emerald-500/15"
                                  }`}
                                  style={{ width: `${pct}%` }}
                                />
                                <div className="relative z-10 flex items-center justify-between gap-2">
                                  <span className="truncate">
                                    {votedByMe ? "✓ " : ""}
                                    {opt.text}
                                  </span>
                                  <span className="text-[10px] font-bold shrink-0 opacity-90">
                                    {votesCount} ({pct}%)
                                  </span>
                                </div>
                              </button>
                            );
                          });
                        })()}
                      </div>
                      <p className="text-[10px] opacity-75">
                        {m.poll.options.reduce((sum, o) => sum + (o.votes?.length || 0), 0)} total votes • Tap to vote
                      </p>
                    </div>
                  ) : isViewOnce ? (
                    /* One-View Protected Photo Bubble */
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenViewOnce(m);
                      }}
                      className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl border text-xs font-semibold ${
                        m.viewedAt
                          ? "opacity-70 border-current/20 bg-black/10"
                          : "border-amber-300/60 bg-black/15 hover:bg-black/25"
                      }`}
                    >
                      <span className="w-6 h-6 rounded-full bg-amber-400 text-slate-950 font-extrabold text-[11px] flex items-center justify-center shrink-0">
                        1
                      </span>
                      <span>
                        {m.viewedAt
                          ? "Photo Opened"
                          : isMe
                          ? "View-Once Photo Sent"
                          : "Photo • Tap to view once"}
                      </span>
                    </button>
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
                              <video src={fileUrl} controls className="rounded-xl max-h-64 w-full bg-black" />
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
                      {translatedBubbles[m.id] && (
                        <p
                          className={`mt-1.5 pt-1.5 border-t text-xs italic ${
                            isMe ? "border-white/20 text-emerald-100" : "border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-300"
                          }`}
                        >
                          {translatedBubbles[m.id]}
                        </p>
                      )}
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
                    } transition-opacity items-center flex-wrap gap-2.5 mt-1 px-1.5`}
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
                    {m.body && !isViewOnce && (
                      <button
                        type="button"
                        onClick={() => handleTranslateIncoming(m)}
                        className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-emerald-600 flex items-center space-x-1"
                      >
                        <Languages className="w-3 h-3" />
                        <span>Translate</span>
                      </button>
                    )}
                    {isMe && (
                      <>
                        {!isViewOnce && (
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
                        )}
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
          <div className="flex items-center space-x-2 bg-white dark:bg-slate-800 px-3.5 py-2 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-700 w-fit text-xs text-slate-600 dark:text-slate-300 my-1">
            <div className="flex space-x-1 items-center py-1">
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-bounce" />
            </div>
            <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">typing...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {showScrollDown && (
        <button
          type="button"
          onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="absolute right-4 bottom-28 z-20 p-2.5 rounded-full bg-white dark:bg-slate-800 text-emerald-600 shadow-lg border border-slate-200 dark:border-slate-700"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}

      {sendToast && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-slate-900/90 text-white text-xs font-medium shadow-lg animate-fadeIn whitespace-nowrap">
          {sendToast}
        </div>
      )}

      {/* Reply Banner */}
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
          <button type="button" onClick={() => setReplyingTo(null)} className="p-1 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Edit Banner */}
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
              className="w-full text-xs bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-amber-300 dark:border-amber-700 rounded-lg px-2.5 py-1.5 mt-0.5 focus:outline-none"
              autoFocus
            />
          </div>
          <div className="flex items-center space-x-1">
            <button type="submit" className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingMessage(null);
                setEditBody("");
              }}
              className="p-1 text-slate-400"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}

      {/* Selected File Preview Banner + View Once Option for Images */}
      {selectedFile && (
        <div className="shrink-0 bg-slate-200/80 dark:bg-slate-800 px-3 sm:px-4 py-2 flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-200 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            <Paperclip className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold truncate">{selectedFile.name}</span>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            {selectedFile.type.startsWith("image/") && (
              <button
                type="button"
                onClick={() => setIsViewOnceSelected((v) => !v)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center space-x-1 transition-all ${
                  isViewOnceSelected
                    ? "bg-amber-500 text-slate-950 shadow-sm"
                    : "bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200"
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>{isViewOnceSelected ? "1x View Once" : "View Once"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setIsViewOnceSelected(false);
              }}
              className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Live Translation Preview */}
      {targetLang !== "ORIGINAL" && inputText.trim().length > 0 && (
        <div className="shrink-0 px-3 sm:px-4 py-1.5 bg-emerald-50/90 dark:bg-emerald-950/60 border-t border-emerald-200/80 dark:border-emerald-900 flex items-center space-x-2 text-xs">
          <Languages className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
            {TARGET_LANGUAGES.find((l) => l.code === targetLang)?.short || targetLang}:
          </span>
          <span className="text-slate-700 dark:text-slate-200 truncate">
            {isTranslatingPreview ? "Translating..." : liveTranslation || inputText}
          </span>
        </div>
      )}

      {/* Pinned Bottom Composer */}
      <div className="shrink-0 px-2 sm:px-3.5 pt-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/70 dark:border-slate-800/80 relative">
        {emojiOpen && (
          <div className="absolute bottom-full left-2 sm:left-3 mb-2 p-2.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 grid grid-cols-6 gap-1.5 w-64 max-w-[calc(100vw-1rem)] z-30 animate-scaleIn">
            {QUICK_EMOJIS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setInputText((prev) => prev + em)}
                className="w-9 h-9 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-lg transition-transform active:scale-90"
              >
                {em}
              </button>
            ))}
          </div>
        )}

        {/* Language Dropdown Bar — Hidden by default; opens ONLY when user clicks Translate icon! */}
        {isTranslatorOpen && (
          <div className="flex items-center justify-between gap-2 pb-2 text-[11px] overflow-x-auto no-scrollbar animate-fadeIn">
            <div className="flex items-center space-x-1.5 shrink-0">
              <Languages className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <select
                value={sourceLang}
                onMouseDown={() => {
                  suppressAlertUntilRef.current = Date.now() + 8000;
                }}
                onChange={(e) => handleChangeSourceLang(e.target.value)}
                aria-label="Source Language"
                className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-lg px-2 py-1 text-[11px] font-semibold focus:outline-none border border-slate-200 dark:border-slate-700 max-w-[110px]"
              >
                {SOURCE_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.short}
                  </option>
                ))}
              </select>
              <span className="text-slate-400">→</span>
              <select
                value={targetLang}
                onMouseDown={() => {
                  suppressAlertUntilRef.current = Date.now() + 8000;
                }}
                onChange={(e) => handleChangeTargetLang(e.target.value)}
                aria-label="Target Language"
                className="bg-emerald-600 text-white rounded-lg px-2 py-1 text-[11px] font-bold focus:outline-none border border-emerald-600 max-w-[140px]"
              >
                {TARGET_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code} className="text-slate-900 bg-white">
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={handleToggleTranslator}
              className="text-[11px] text-slate-400 hover:text-slate-600 px-1.5 py-0.5 rounded shrink-0"
              title="Turn off translator"
            >
              Off
            </button>
          </div>
        )}

        {isRecording ? (
          <div className="flex items-center justify-between bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-3xl px-4 py-2.5">
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
                className="px-3 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={stopRecording}
                className="px-3 py-1 text-xs bg-red-600 text-white rounded-lg font-bold flex items-center space-x-1"
              >
                <Send className="w-3 h-3" />
                <span>Send</span>
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-end gap-1.5"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  setSelectedFile(e.target.files[0]);
                  setIsViewOnceSelected(false);
                }
              }}
              className="hidden"
            />

            {/* Clean Unified Pill Container — Prevents Scrollbar & Border Overlap */}
            <div className="flex-1 min-w-0 flex items-end gap-0.5 px-1.5 py-1 rounded-3xl bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 focus-within:bg-white dark:focus-within:bg-slate-900 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all">
              <button
                type="button"
                onClick={() => setEmojiOpen((prev) => !prev)}
                title="Emoji"
                className={`p-2 rounded-full shrink-0 transition-colors ${
                  emojiOpen
                    ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600"
                    : "text-slate-500 dark:text-slate-400 hover:text-emerald-600"
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
                  targetLang === "ORIGINAL"
                    ? t.typeMessage
                    : `Type (${TARGET_LANGUAGES.find((l) => l.code === targetLang)?.short || targetLang})...`
                }
                className="flex-1 min-w-0 py-2 px-1.5 text-sm bg-transparent border-0 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-0 resize-none max-h-24 overflow-y-auto no-scrollbar leading-snug"
              />

              <button
                type="button"
                onClick={() => {
                  suppressAlertUntilRef.current = Date.now() + 12000;
                  fileInputRef.current?.click();
                }}
                title="Attach File"
                className="p-2 text-slate-500 dark:text-slate-400 hover:text-emerald-600 rounded-full shrink-0 transition-colors"
              >
                <Paperclip className="w-[18px] h-[18px]" />
              </button>

              <button
                type="button"
                onClick={() => {
                  suppressAlertUntilRef.current = Date.now() + 12000;
                  setIsCameraOpen(true);
                }}
                title="Take Photo"
                className="p-2 text-slate-500 dark:text-slate-400 hover:text-emerald-600 rounded-full shrink-0 transition-colors"
              >
                <Camera className="w-[18px] h-[18px]" />
              </button>

              <button
                type="button"
                onClick={handleToggleTranslator}
                title={isTranslatorOpen ? "Turn Off Translator" : "Translate Message"}
                className={`p-2 rounded-full shrink-0 transition-colors ${
                  isTranslatorOpen
                    ? "bg-emerald-600 text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-emerald-600"
                }`}
              >
                <Languages className="w-[18px] h-[18px]" />
              </button>
            </div>

            {!inputText.trim() && !selectedFile ? (
              <button
                type="button"
                onClick={startRecording}
                title="Voice Note"
                className="w-11 h-11 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-slate-600 dark:text-slate-300 hover:text-emerald-600 flex items-center justify-center shrink-0 border border-slate-200/80 dark:border-slate-700/80 transition-colors"
              >
                <Mic className="w-5 h-5" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={uploading}
                className="w-11 h-11 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white disabled:opacity-40 shrink-0 shadow-md shadow-emerald-600/25 flex items-center justify-center transition-all active:scale-95"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </form>
        )}
      </div>

      {/* Camera Instant Snap Modal */}
      <CameraModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onSendPhoto={handleSendPhotoFile}
      />

      {/* Protected View-Once Photo Viewer (Blurs if window loses focus!) */}
      {viewOnceUrl && (
        <div
          onClick={() => setViewOnceUrl(null)}
          className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center p-4 select-none animate-fadeIn"
        >
          <div className="absolute top-4 inset-x-4 flex items-center justify-between text-white z-10">
            <span className="px-3 py-1 rounded-full bg-amber-500 text-slate-950 text-xs font-bold flex items-center space-x-1.5">
              <Eye className="w-3.5 h-3.5" />
              <span>View Once Photo</span>
            </span>
            <button
              type="button"
              onClick={() => setViewOnceUrl(null)}
              className="p-2 rounded-full bg-white/15 hover:bg-white/25"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <img
            src={viewOnceUrl}
            alt="View once"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            draggable={false}
            className={`max-w-full max-h-[82dvh] rounded-2xl object-contain transition-all ${
              isWindowBlurred ? "blur-3xl opacity-10" : ""
            }`}
          />
          <p className="text-[11px] text-slate-400 mt-3">
            Disappears after closing
          </p>
        </div>
      )}

      {/* Standard In-App Image Lightbox */}
      {previewImageUrl && (
        <div
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
        >
          <button
            type="button"
            onClick={() => setPreviewImageUrl(null)}
            className="absolute top-4 right-4 p-2.5 rounded-full bg-white/15 hover:bg-white/25 text-white"
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

      {otherMember && (
        <ReportModal
          isOpen={isReportOpen}
          onClose={() => setIsReportOpen(false)}
          userId={otherMember.id}
          userName={otherMember.displayName || otherMember.username}
        />
      )}

      <E2EEModal isOpen={isE2EEOpen} onClose={() => setIsE2EEOpen(false)} peerName={title} />

      {isPollModalOpen && (
        <div
          onClick={() => setIsPollModalOpen(false)}
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              const cleanOpts = pollOptions.map((o) => o.trim()).filter(Boolean);
              if (!pollQuestion.trim() || cleanOpts.length < 2) {
                showNotice("Enter a question and at least 2 options.");
                return;
              }
              try {
                setPollSubmitting(true);
                const res = await api.polls.create({
                  conversationId: conversation.id,
                  question: pollQuestion.trim(),
                  options: cleanOpts,
                });
                if (res?.message) {
                  setMessages((prev) =>
                    prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]
                  );
                }
                setPollQuestion("");
                setPollOptions(["", ""]);
                setIsPollModalOpen(false);
                onConversationUpdated();
              } catch (err: any) {
                showNotice(err.message || "Failed to create poll.");
              } finally {
                setPollSubmitting(false);
              }
            }}
            className="bg-white dark:bg-slate-900 rounded-3xl p-5 w-full max-w-sm border border-slate-200 dark:border-slate-800 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center space-x-1.5">
                <BarChart3 className="w-4 h-4 text-emerald-600" />
                <span>Create Poll</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsPollModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={pollQuestion}
              onChange={(e) => setPollQuestion(e.target.value)}
              placeholder="Ask a question..."
              required
              className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <div className="space-y-2 max-h-44 overflow-y-auto">
              {pollOptions.map((opt, idx) => (
                <input
                  key={idx}
                  type="text"
                  value={opt}
                  onChange={(e) => {
                    const next = [...pollOptions];
                    next[idx] = e.target.value;
                    setPollOptions(next);
                  }}
                  placeholder={`Option ${idx + 1}`}
                  className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100"
                />
              ))}
            </div>
            {pollOptions.length < 6 && (
              <button
                type="button"
                onClick={() => setPollOptions((prev) => [...prev, ""])}
                className="text-xs font-semibold text-emerald-600 flex items-center space-x-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Option</span>
              </button>
            )}
            <div className="flex justify-end space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setIsPollModalOpen(false)}
                className="px-3.5 py-1.5 text-xs rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pollSubmitting}
                className="px-4 py-1.5 text-xs rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-50"
              >
                {pollSubmitting ? "Posting..." : "Post Poll"}
              </button>
            </div>
          </form>
        </div>
      )}

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
