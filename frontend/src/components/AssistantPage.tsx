import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "../api/client";
import { useSocket } from "../context/SocketContext";
import {
  AssistantMessage,
  AssistantPendingAction,
  AssistantRecentConversation,
  AssistantTask,
  ScheduledAction,
} from "../types";
import {
  ArrowLeft,
  Bot,
  Mic,
  MicOff,
  Send,
  Volume2,
  VolumeX,
  Check,
  X,
  CalendarClock,
  Clock,
  CheckSquare,
  Square,
  Trash2,
  MessageSquare,
  Phone,
  Video,
  Users,
  BarChart3,
  Edit2,
  Sparkles,
  Plus,
} from "lucide-react";

interface AssistantPageProps {
  onBack: () => void;
  onOpenConversation: (conversationId: string) => void;
  onConversationsChanged: () => void;
  onStartCallWithUser: (payload: {
    conversationId: string;
    otherUser: { id: string; username: string; displayName: string; avatarUrl?: string | null };
    isVideo: boolean;
  }) => void;
}

const EXAMPLE_PROMPTS = [
  "Ek funny joke sunao Hindi me",
  "Taj Mahal kya hai?",
  "Rahul ko happy birthday wish kar do",
  "Kal 12 baje Amit ko hello bhej dena",
  "Mere unread messages ka summary batao",
  "Cricket ka group bana do",
];

function toDatetimeLocalValue(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 3600_000);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const AssistantPage: React.FC<AssistantPageProps> = ({
  onBack,
  onOpenConversation,
  onConversationsChanged,
  onStartCallWithUser,
}) => {
  const { socket } = useSocket();
  const [tab, setTab] = useState<"CHAT" | "SCHEDULED" | "TASKS" | "RECENT">("CHAT");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [tasks, setTasks] = useState<AssistantTask[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledAction[]>([]);
  const [recentConvs, setRecentConvs] = useState<AssistantRecentConversation[]>([]);
  const [aiProvider, setAiProvider] = useState<string>("Zust Smart AI");
  const [aiLastError, setAiLastError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [voiceReplyOn, setVoiceReplyOn] = useState(true);
  const [speechLang, setSpeechLang] = useState<"hi-IN" | "en-IN">("hi-IN");
  const [isListening, setIsListening] = useState(false);
  const [interimVoice, setInterimVoice] = useState("");
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Local editable drafts per pending action messageId
  const [drafts, setDrafts] = useState<Record<string, Partial<AssistantPendingAction> & { pollNewOption?: string }>>({});

  // Quick Task add & Scheduled edit modal state
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [editingSched, setEditingSched] = useState<ScheduledAction | null>(null);
  const [editSchedTime, setEditSchedTime] = useState("");
  const [editSchedText, setEditSchedText] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const showNotice = (msg: string) => {
    setStatusBanner(msg);
    setTimeout(() => setStatusBanner((curr) => (curr === msg ? null : curr)), 3200);
  };

  const speakText = useCallback(
    (text: string, langHint?: string) => {
      if (!voiceReplyOn || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      try {
        window.speechSynthesis.cancel();
        const cleaned = text.replace(/[\u{1F300}-\u{1FAFF}•✅⚠️⏰📊✉️📸🚨⬜]/gu, "").trim();
        if (!cleaned) return;
        const utter = new SpeechSynthesisUtterance(cleaned);
        const hasDeva = /[\u0900-\u097F]/.test(cleaned);
        utter.lang = hasDeva || langHint === "hi" || langHint === "hinglish" ? "hi-IN" : "en-IN";
        utter.rate = 1.02;
        window.speechSynthesis.speak(utter);
      } catch {}
    },
    [voiceReplyOn]
  );

  const applyState = (s: {
    messages: AssistantMessage[];
    tasks: AssistantTask[];
    scheduledActions: ScheduledAction[];
    recentConversations: AssistantRecentConversation[];
    aiConfig?: { configured: boolean; provider: string; lastError?: string };
  }) => {
    setMessages(s.messages || []);
    setTasks(s.tasks || []);
    setScheduled(s.scheduledActions || []);
    setRecentConvs(s.recentConversations || []);
    if (s.aiConfig?.provider) setAiProvider(s.aiConfig.provider);
    setAiLastError(s.aiConfig?.lastError || null);
  };

  const loadState = useCallback(async () => {
    try {
      const res = await api.ai.getState();
      if (res.success) applyState(res);
    } catch {
      showNotice("Failed to load Assistant state.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
    return () => {
      try {
        recognitionRef.current?.stop();
        window.speechSynthesis?.cancel();
      } catch {}
    };
  }, [loadState]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => loadState();
    socket.on("ai:scheduled-executed", refresh);
    socket.on("ai:reminder-due", refresh);
    return () => {
      socket.off("ai:scheduled-executed", refresh);
      socket.off("ai:reminder-due", refresh);
    };
  }, [socket, loadState]);

  useEffect(() => {
    if (tab === "CHAT") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, tab]);

  const sendCommand = async (raw: string) => {
    const clean = raw.trim();
    if (!clean || sending) return;
    setSending(true);
    setInputText("");
    setInterimVoice("");
    try {
      const res = await api.ai.sendCommand(clean);
      applyState(res.state);
      onConversationsChanged();
      if (res.assistantMessage?.content) {
        speakText(res.assistantMessage.content, res.assistantMessage.language);
      }
      if (res.callTrigger) {
        onStartCallWithUser(res.callTrigger);
      }
    } catch (err: any) {
      showNotice(err.message || "Assistant could not process that request.");
    } finally {
      setSending(false);
    }
  };

  const toggleMicrophone = () => {
    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      setIsListening(false);
      return;
    }

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      showNotice("Voice input is not supported in this browser. Please type below.");
      return;
    }

    try {
      const rec = new SpeechRec();
      recognitionRef.current = rec;
      rec.lang = speechLang;
      rec.continuous = false;
      rec.interimResults = true;

      let latestFinal = "";
      rec.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            latestFinal += transcript + " ";
          } else {
            interim += transcript;
          }
        }
        setInterimVoice((latestFinal + interim).trim());
      };

      rec.onerror = (event: any) => {
        setIsListening(false);
        setInterimVoice("");
        if (event?.error === "not-allowed") {
          showNotice("Microphone permission denied. Please allow mic access.");
        }
      };

      rec.onend = () => {
        setIsListening(false);
        const spoken = latestFinal.trim();
        if (spoken) {
          sendCommand(spoken);
        }
      };

      rec.start();
      setIsListening(true);
      setTab("CHAT");
    } catch {
      setIsListening(false);
      showNotice("Could not start microphone.");
    }
  };

  const getMergedAction = (msgId: string, original: AssistantPendingAction): AssistantPendingAction => ({
    ...original,
    ...(drafts[msgId] || {}),
  });

  const patchDraft = (msgId: string, patch: Partial<AssistantPendingAction> & { pollNewOption?: string }) => {
    setDrafts((prev) => ({ ...prev, [msgId]: { ...(prev[msgId] || {}), ...patch } }));
  };

  const handleConfirmCard = async (msgId: string, original: AssistantPendingAction, allowOfflineCall = false) => {
    if (confirmingId) return;
    const merged = getMergedAction(msgId, original);
    setConfirmingId(msgId);
    try {
      const overrides: Record<string, any> = {
        targetUserId: merged.targetUserId,
        targetConversationId: merged.targetConversationId,
        targetLabel: merged.targetLabel,
        body: merged.body,
        scheduledForIso: merged.scheduledForIso,
        isVideo: merged.isVideo,
        groupTitle: merged.groupTitle,
        memberIds: merged.memberIds,
        question: merged.question,
        options: merged.options,
        reminderText: merged.reminderText,
        scheduledActionId: merged.scheduledActionId,
        allowOfflineCall,
      };
      const res = await api.ai.confirmAction(msgId, overrides);
      applyState(res.state);
      onConversationsChanged();
      if (res.message) {
        speakText(res.message);
      }
      if (res.callTrigger) {
        onStartCallWithUser(res.callTrigger);
      }
    } catch (err: any) {
      showNotice(err.message || "Failed to execute action.");
    } finally {
      setConfirmingId(null);
    }
  };

  const handleCancelCard = async (msgId: string) => {
    try {
      const res = await api.ai.cancelAction(msgId);
      applyState(res.state);
    } catch {}
  };

  const pendingScheduledCount = scheduled.filter((s) => s.status === "PENDING").length;
  const pendingTasksCount = tasks.filter((t) => t.status === "PENDING").length;

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-3.5 py-2.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/70 dark:border-slate-800/80 flex items-center justify-between gap-2 z-20">
        <div className="flex items-center space-x-2.5 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-2 -ml-1 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-cyan-500 text-white flex items-center justify-center shadow-sm shrink-0">
            <Bot className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
              Zust AI
            </h2>
            <p
              title={aiLastError || undefined}
              className={`text-[11px] truncate font-medium ${
                aiLastError
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {aiLastError
                ? `${aiProvider} issue: ${aiLastError}`
                : `${aiProvider} • Ask anything or automate chats`}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              const next = !voiceReplyOn;
              setVoiceReplyOn(next);
              if (!next) window.speechSynthesis?.cancel();
            }}
            title={voiceReplyOn ? "Voice Reply ON" : "Voice Reply Muted"}
            className={`p-2 rounded-xl text-xs font-semibold flex items-center space-x-1 transition-colors ${
              voiceReplyOn
                ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-300"
                : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            {voiceReplyOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={async () => {
                const res = await api.ai.clearHistory();
                applyState(res);
              }}
              title="Clear AI Chat History"
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Compact Section Switcher (Chat | Scheduled/Reminders | Tasks | Recent) */}
      <div className="shrink-0 px-3 py-2 bg-white/80 dark:bg-slate-900/80 border-b border-slate-100 dark:border-slate-800/80 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setTab("CHAT")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 flex items-center space-x-1.5 transition-all ${
            tab === "CHAT"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Assistant</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("SCHEDULED")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 flex items-center space-x-1.5 transition-all ${
            tab === "SCHEDULED"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
          }`}
        >
          <CalendarClock className="w-3.5 h-3.5" />
          <span>Scheduled & Reminders{pendingScheduledCount > 0 ? ` (${pendingScheduledCount})` : ""}</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("TASKS")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 flex items-center space-x-1.5 transition-all ${
            tab === "TASKS"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
          }`}
        >
          <CheckSquare className="w-3.5 h-3.5" />
          <span>Tasks{pendingTasksCount > 0 ? ` (${pendingTasksCount})` : ""}</span>
        </button>

        <button
          type="button"
          onClick={() => setTab("RECENT")}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 flex items-center space-x-1.5 transition-all ${
            tab === "RECENT"
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          <span>Recent Chats</span>
        </button>
      </div>

      {statusBanner && (
        <div className="shrink-0 px-4 py-2 bg-amber-500 text-slate-950 text-xs font-bold flex items-center justify-between">
          <span>{statusBanner}</span>
          <button type="button" onClick={() => setStatusBanner(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      {tab === "CHAT" ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3 chat-bg-pattern">
          {loading ? (
            <div className="flex items-center justify-center h-full text-xs text-slate-400">
              Loading assistant...
            </div>
          ) : messages.length === 0 ? (
            <div className="max-w-lg mx-auto pt-4 sm:pt-8 space-y-5 text-center">
              <div className="w-16 h-16 mx-auto rounded-3xl bg-gradient-to-tr from-emerald-500 to-teal-500 text-white flex items-center justify-center shadow-lg shadow-emerald-600/25">
                <Bot className="w-8 h-8" />
              </div>
              <div className="space-y-1.5 px-2">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  Hi! How can I help you today?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Speak with the mic or type naturally in Hindi, Hinglish, or English.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2 px-2">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => sendCommand(p)}
                    className="px-3 py-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-emerald-500 hover:text-emerald-600 shadow-sm transition-all text-left"
                  >
                    "{p}"
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const isUser = m.role === "user";
              const pending = m.metadata?.pendingAction;
              const merged = pending ? getMergedAction(m.id, pending) : undefined;
              const unreadItems = m.metadata?.unreadItems;
              const searchResults = m.metadata?.searchResults;
              const convLink = m.metadata?.conversationLink;

              return (
                <div key={m.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"} animate-fadeIn`}>
                  <div
                    className={`max-w-[92%] sm:max-w-lg px-3.5 py-2.5 rounded-2xl text-sm shadow-sm ${
                      isUser
                        ? "bg-gradient-to-br from-emerald-600 to-teal-600 text-white rounded-br-sm"
                        : "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-800 rounded-bl-sm"
                    }`}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>

                    {!isUser && (
                      <div className="mt-1.5 flex items-center justify-end space-x-2">
                        <button
                          type="button"
                          onClick={() => speakText(m.content, m.language)}
                          className="text-[10px] text-slate-400 hover:text-emerald-600 flex items-center space-x-1"
                        >
                          <Volume2 className="w-3 h-3" />
                          <span>Listen</span>
                        </button>
                      </div>
                    )}

                    {/* Clickable Unread Summary Items */}
                    {unreadItems && unreadItems.length > 0 && (
                      <div className="mt-2.5 space-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-2">
                        {unreadItems.map((item) => (
                          <button
                            key={item.conversationId}
                            type="button"
                            onClick={() => onOpenConversation(item.conversationId)}
                            className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-left text-xs flex items-center justify-between gap-2"
                          >
                            <span className="font-semibold truncate">{item.title} ({item.count})</span>
                            <span className="text-[10px] font-bold text-emerald-600 shrink-0">Open Chat →</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Search Result / Summary Conversation Links */}
                    {searchResults && searchResults.length > 0 && (
                      <div className="mt-2.5 space-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-2">
                        {searchResults.slice(0, 4).map((hit) => (
                          <button
                            key={hit.id}
                            type="button"
                            onClick={() => onOpenConversation(hit.conversationId)}
                            className="w-full px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-left text-xs flex items-center justify-between gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          >
                            <span className="truncate">{hit.sender}: {hit.body}</span>
                            <span className="text-[10px] font-bold text-emerald-600 shrink-0">Open →</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {convLink && (
                      <button
                        type="button"
                        onClick={() => onOpenConversation(convLink.conversationId)}
                        className="mt-2 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-100"
                      >
                        Open {convLink.label} →
                      </button>
                    )}

                    {/* Interactive Action Confirmation Card */}
                    {merged && (
                      <div className="mt-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-700 dark:text-slate-200 flex items-center space-x-1.5">
                            {merged.type === "START_CALL" ? (
                              merged.isVideo ? <Video className="w-3.5 h-3.5 text-emerald-600" /> : <Phone className="w-3.5 h-3.5 text-emerald-600" />
                            ) : merged.type === "CREATE_GROUP" ? (
                              <Users className="w-3.5 h-3.5 text-emerald-600" />
                            ) : merged.type === "CREATE_POLL" ? (
                              <BarChart3 className="w-3.5 h-3.5 text-emerald-600" />
                            ) : merged.type === "SET_REMINDER" || merged.type === "SCHEDULE_MESSAGE" ? (
                              <Clock className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Send className="w-3.5 h-3.5 text-emerald-600" />
                            )}
                            <span>{merged.type.replace("_", " ")}</span>
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              merged.status === "CONFIRMED"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                : merged.status === "CANCELLED"
                                ? "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                                : merged.status === "FAILED"
                                ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                                : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                            }`}
                          >
                            {merged.status}
                          </span>
                        </div>

                        {merged.status === "PENDING" && (
                          <>
                            {/* Contact / Group Picker for Disambiguation or Selection */}
                            {merged.candidates && merged.candidates.length > 0 && merged.type !== "CREATE_GROUP" && (
                              <div className="flex flex-wrap gap-1.5">
                                {merged.candidates.map((cand) => {
                                  const selected =
                                    (cand.userId && cand.userId === merged.targetUserId) ||
                                    (cand.conversationId && cand.conversationId === merged.targetConversationId);
                                  return (
                                    <button
                                      key={cand.userId || cand.conversationId}
                                      type="button"
                                      onClick={() =>
                                        patchDraft(m.id, {
                                          targetUserId: cand.userId,
                                          targetConversationId: cand.conversationId,
                                          targetLabel: cand.label,
                                          isTargetOnline: cand.isOnline,
                                        })
                                      }
                                      className={`px-2.5 py-1 rounded-xl border text-[11px] font-semibold transition-all ${
                                        selected
                                          ? "bg-emerald-600 text-white border-emerald-600"
                                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
                                      }`}
                                    >
                                      {cand.label}
                                      {cand.isOnline === true ? " • Online" : ""}
                                    </button>
                                  );
                                })}
                              </div>
                            )}

                            {/* Editable Message Text */}
                            {(merged.type === "SEND_MESSAGE" || merged.type === "SCHEDULE_MESSAGE") && (
                              <div>
                                <label className="text-[10px] font-semibold text-slate-400">
                                  To: {merged.targetLabel || "Select above"}
                                </label>
                                <input
                                  type="text"
                                  value={merged.body ?? ""}
                                  onChange={(e) => patchDraft(m.id, { body: e.target.value })}
                                  placeholder="Type message to send..."
                                  className="mt-1 w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                                />
                              </div>
                            )}

                            {/* Date & Time Picker for Scheduled Messages & Reminders */}
                            {(merged.type === "SCHEDULE_MESSAGE" || merged.type === "SET_REMINDER") && (
                              <div className="space-y-1.5">
                                {merged.type === "SET_REMINDER" && (
                                  <input
                                    type="text"
                                    value={merged.reminderText ?? ""}
                                    onChange={(e) => patchDraft(m.id, { reminderText: e.target.value })}
                                    placeholder="What should I remind you?"
                                    className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                                  />
                                )}
                                <input
                                  type="datetime-local"
                                  value={toDatetimeLocalValue(merged.scheduledForIso)}
                                  onChange={(e) => {
                                    const d = new Date(e.target.value);
                                    if (!Number.isNaN(d.getTime())) {
                                      patchDraft(m.id, { scheduledForIso: d.toISOString() });
                                    }
                                  }}
                                  className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                                />
                              </div>
                            )}

                            {/* Create Group Member Selection */}
                            {merged.type === "CREATE_GROUP" && (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  value={merged.groupTitle ?? ""}
                                  onChange={(e) => patchDraft(m.id, { groupTitle: e.target.value })}
                                  placeholder="Group Title"
                                  className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                                />
                                {merged.candidates && merged.candidates.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {merged.candidates.map((cand) => {
                                      const ids = merged.memberIds || [];
                                      const picked = cand.userId ? ids.includes(cand.userId) : false;
                                      return (
                                        <button
                                          key={cand.userId}
                                          type="button"
                                          onClick={() => {
                                            if (!cand.userId) return;
                                            const nextIds = picked
                                              ? ids.filter((id) => id !== cand.userId)
                                              : [...ids, cand.userId];
                                            patchDraft(m.id, { memberIds: nextIds });
                                          }}
                                          className={`px-2 py-1 rounded-lg border text-[11px] font-medium ${
                                            picked
                                              ? "bg-emerald-600 text-white border-emerald-600"
                                              : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
                                          }`}
                                        >
                                          {picked ? "✓ " : "+ "}
                                          {cand.label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Create Poll Builder */}
                            {merged.type === "CREATE_POLL" && (
                              <div className="space-y-1.5">
                                <input
                                  type="text"
                                  value={merged.question ?? ""}
                                  onChange={(e) => patchDraft(m.id, { question: e.target.value })}
                                  placeholder="Poll Question (e.g. Match time?)"
                                  className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                                />
                                {(merged.options || ["Yes", "No"]).map((opt, idx) => (
                                  <input
                                    key={idx}
                                    type="text"
                                    value={opt}
                                    onChange={(e) => {
                                      const next = [...(merged.options || ["Yes", "No"])];
                                      next[idx] = e.target.value;
                                      patchDraft(m.id, { options: next });
                                    }}
                                    placeholder={`Option ${idx + 1}`}
                                    className="w-full px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                                  />
                                ))}
                                {(merged.options || []).length < 5 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      patchDraft(m.id, {
                                        options: [...(merged.options || ["Yes", "No"]), `Option ${(merged.options?.length || 2) + 1}`],
                                      })
                                    }
                                    className="text-[11px] font-semibold text-emerald-600 hover:underline"
                                  >
                                    + Add Option
                                  </button>
                                )}
                              </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => handleCancelCard(m.id)}
                                className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold"
                              >
                                Cancel
                              </button>
                              {merged.type === "START_CALL" && merged.isTargetOnline === false ? (
                                <button
                                  type="button"
                                  disabled={confirmingId === m.id || !pending}
                                  onClick={() => pending && handleConfirmCard(m.id, pending, true)}
                                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold"
                                >
                                  {confirmingId === m.id ? "Calling..." : "Try Ringing Anyway"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={confirmingId === m.id || !pending}
                                  onClick={() => pending && handleConfirmCard(m.id, pending)}
                                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center space-x-1"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>{confirmingId === m.id ? "Working..." : "Confirm"}</span>
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      ) : tab === "SCHEDULED" ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Upcoming & Execution History
          </h3>
          {scheduled.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No scheduled messages or reminders yet. Ask AI: "Kal 12 baje Amit ko message bhej dena" or "Remind me at 9am".
            </div>
          ) : (
            scheduled.map((s) => (
              <div
                key={s.id}
                className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 space-y-1.5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                    {s.type === "REMINDER" ? "⏰ Reminder" : s.type === "SEND_MESSAGE" ? "✉️ Scheduled Message" : s.type}
                    {s.targetLabel ? ` • ${s.targetLabel}` : ""}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      s.status === "EXECUTED"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        : s.status === "PENDING"
                        ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                        : s.status === "FAILED"
                        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {s.payload?.body || s.payload?.text || s.resultMessage || ""}
                </p>
                <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
                  <span>{new Date(s.scheduledFor).toLocaleString()}</span>
                  <div className="flex items-center space-x-2">
                    {s.status === "PENDING" && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSched(s);
                          setEditSchedTime(toDatetimeLocalValue(s.scheduledFor));
                          setEditSchedText(String(s.payload?.body || s.payload?.text || ""));
                        }}
                        className="text-emerald-600 hover:underline flex items-center space-x-0.5 font-semibold"
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        await api.ai.deleteScheduled(s.id);
                        loadState();
                      }}
                      className="text-red-500 hover:underline font-semibold"
                    >
                      {s.status === "PENDING" ? "Cancel" : "Remove"}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      ) : tab === "TASKS" ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newTaskTitle.trim()) return;
              await api.ai.createTask(newTaskTitle.trim());
              setNewTaskTitle("");
              loadState();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={newTaskTitle}
              onChange={(e) => setNewTaskTitle(e.target.value)}
              placeholder="Add a personal task..."
              className="flex-1 px-3.5 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button
              type="submit"
              className="px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center space-x-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>

          {tasks.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No tasks yet. Add above or ask AI: "Add task call plumber".
            </div>
          ) : (
            tasks.map((task) => {
              const done = task.status === "COMPLETED";
              return (
                <div
                  key={task.id}
                  className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2"
                >
                  <button
                    type="button"
                    onClick={async () => {
                      await api.ai.updateTask(task.id, { status: done ? "PENDING" : "COMPLETED" });
                      loadState();
                    }}
                    className="flex items-center space-x-2.5 text-left flex-1 min-w-0"
                  >
                    {done ? (
                      <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <span className={`text-xs truncate ${done ? "line-through text-slate-400" : "font-medium text-slate-800 dark:text-slate-100"}`}>
                      {task.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await api.ai.deleteTask(task.id);
                      loadState();
                    }}
                    className="p-1 text-slate-400 hover:text-red-500"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5">
          {recentConvs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No recent conversations yet.</div>
          ) : (
            recentConvs.map((c) => (
              <div
                key={c.id}
                className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{c.title}</p>
                  <p className="text-[11px] text-slate-500 truncate">{c.lastMessageBody}</p>
                </div>
                <div className="flex items-center space-x-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setTab("CHAT");
                      sendCommand(`${c.title} ki chat summarize karo`);
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-emerald-50 hover:text-emerald-600"
                  >
                    Summarize
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenConversation(c.id)}
                    className="px-2.5 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold"
                  >
                    Open
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Edit Scheduled Modal */}
      {editingSched && (
        <div
          onClick={() => setEditingSched(null)}
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              await api.ai.updateScheduled(editingSched.id, {
                scheduledFor: editSchedTime ? new Date(editSchedTime).toISOString() : undefined,
                text: editSchedText,
              });
              setEditingSched(null);
              loadState();
            }}
            className="bg-white dark:bg-slate-900 rounded-3xl p-5 w-full max-w-sm space-y-3 border border-slate-200 dark:border-slate-800 shadow-2xl"
          >
            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">Edit Scheduled Action</h4>
            <input
              type="text"
              value={editSchedText}
              onChange={(e) => setEditSchedText(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            />
            <input
              type="datetime-local"
              value={editSchedTime}
              onChange={(e) => setEditSchedTime(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            />
            <div className="flex justify-end space-x-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingSched(null)}
                className="px-3.5 py-1.5 text-xs rounded-xl text-slate-500 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs rounded-xl bg-emerald-600 text-white font-bold"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Bottom Voice + Text Composer */}
      <div className="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/70 dark:border-slate-800/80 space-y-2.5">
        {isListening && (
          <div className="px-3.5 py-2 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
            <span className="truncate font-medium">
              {interimVoice || `Listening (${speechLang === "hi-IN" ? "Hindi / Hinglish" : "English"})...`}
            </span>
            <button type="button" onClick={toggleMicrophone} className="font-bold text-red-500 shrink-0 ml-2">
              Stop
            </button>
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendCommand(inputText);
          }}
          className="flex items-center gap-2"
        >
          {/* Dictation Language Toggle */}
          <button
            type="button"
            onClick={() => setSpeechLang((l) => (l === "hi-IN" ? "en-IN" : "hi-IN"))}
            title="Switch Mic Language (Hindi/Hinglish vs English)"
            className="px-2.5 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700 shrink-0"
          >
            {speechLang === "hi-IN" ? "हिं" : "EN"}
          </button>

          {/* Prominent Large Microphone Button */}
          <button
            type="button"
            onClick={toggleMicrophone}
            title={isListening ? "Stop Listening" : "Tap to Speak"}
            className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 shadow-lg transition-all active:scale-95 ${
              isListening
                ? "bg-red-600 text-white ring-4 ring-red-500/30 animate-pulse"
                : "bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-emerald-600/30 hover:scale-105"
            }`}
          >
            {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-6 h-6" />}
          </button>

          <div className="flex-1 min-w-0 flex items-center bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 focus-within:border-emerald-500 focus-within:bg-white dark:focus-within:bg-slate-900 rounded-3xl px-3.5 py-1.5">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={sending}
              placeholder="Ask AI in Hindi, Hinglish or English..."
              className="flex-1 min-w-0 bg-transparent text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none py-1.5"
            />
          </div>

          <button
            type="submit"
            disabled={!inputText.trim() || sending}
            className="w-11 h-11 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-40 flex items-center justify-center shrink-0 shadow-sm"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
