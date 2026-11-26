import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "./context/AuthContext";
import { useSocket } from "./context/SocketContext";
import { api } from "./api/client";
import { Conversation, Message, User } from "./types";
import { Language, translations } from "./utils/i18n";
import { useInitAppBackGuard, useBackLayer } from "./utils/useBackNavigation";
import {
  getNotificationPermissionState,
  requestAppNotificationPermission,
  showAppNotification,
  playSoftNotificationTone,
} from "./utils/notifications";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { NewChatModal } from "./components/NewChatModal";
import { ProfileModal } from "./components/ProfileModal";
import { UserProfileModal } from "./components/UserProfileModal";
import { GroupInfoDrawer } from "./components/GroupInfoDrawer";
import { InviteModal } from "./components/InviteModal";
import { CallModal, ActiveCallState } from "./components/CallModal";
import { GroupCallModal, ActiveGroupCallState } from "./components/GroupCallModal";
import { NearbyRadarPage } from "./components/NearbyRadarPage";
import { E2EEModal } from "./components/E2EEModal";
import { AssistantPage } from "./components/AssistantPage";
import { MessageSquare, Plus, QrCode, Radar, Bot } from "lucide-react";

const CONV_CACHE_KEY = "zust_cached_conversations";

export const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const { socket, syncPresence, updatePresenceBulk } = useSocket();
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const cached = localStorage.getItem(CONV_CACHE_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [lang, setLang] = useState<Language>("en");
  const [isDark, setIsDark] = useState<boolean>(() => localStorage.getItem("zust_theme") === "dark");

  // Modals & Call state
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [viewingUser, setViewingUser] = useState<User | null>(null);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [isAccountSecurityOpen, setIsAccountSecurityOpen] = useState(false);
  const [isRadarOpen, setIsRadarOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [radarInitialTab, setRadarInitialTab] = useState<"NEARBY" | "REQUESTS">("NEARBY");
  const [pendingRadarRequests, setPendingRadarRequests] = useState(0);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [activeGroupCall, setActiveGroupCall] = useState<ActiveGroupCallState | null>(null);
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [backToast, setBackToast] = useState<string | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "unsupported">(() =>
    getNotificationPermissionState()
  );

  const activeConversationIdRef = useRef<string | null>(null);
  const isRadarOpenRef = useRef<boolean>(false);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);
  useEffect(() => {
    isRadarOpenRef.current = isRadarOpen;
  }, [isRadarOpen]);

  const t = translations[lang];

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("zust_theme", isDark ? "dark" : "light");
  }, [isDark]);

  const handleRootBack = useCallback(() => {
    setBackToast("You're on the home screen");
    setTimeout(() => setBackToast(null), 2000);
  }, []);

  useInitAppBackGuard(handleRootBack);

  useBackLayer("active-group-call", 92, Boolean(activeGroupCall), () => setActiveGroupCall(null));
  useBackLayer("active-call", 90, Boolean(activeCall && !isCallMinimized), () => setIsCallMinimized(true));
  useBackLayer("viewing-user-profile", 65, Boolean(viewingUser), () => setViewingUser(null));
  useBackLayer("new-chat-modal", 60, isNewChatOpen, () => setIsNewChatOpen(false));
  useBackLayer("profile-modal", 60, isProfileOpen, () => setIsProfileOpen(false));
  useBackLayer("invite-modal", 60, isInviteOpen, () => setIsInviteOpen(false));
  useBackLayer("account-security-modal", 60, isAccountSecurityOpen, () => setIsAccountSecurityOpen(false));
  useBackLayer("group-info-drawer", 50, isGroupInfoOpen, () => setIsGroupInfoOpen(false));
  useBackLayer("assistant-page", 46, isAssistantOpen, () => setIsAssistantOpen(false));
  useBackLayer("nearby-radar", 45, isRadarOpen, () => setIsRadarOpen(false));
  useBackLayer("active-conversation", 40, Boolean(activeConversationId), () => {
    setActiveConversationId(null);
    setIsGroupInfoOpen(false);
  });

  // Handle clicking any Chrome notification (via Service Worker or desktop Notification)
  useEffect(() => {
    const handleNotificationRoute = (data: any) => {
      if (!data) return;
      if (data.type === "message" && data.conversationId) {
        setIsRadarOpen(false);
        setActiveConversationId(String(data.conversationId));
      } else if (data.type === "nearby_request") {
        setRadarInitialTab("REQUESTS");
        setIsRadarOpen(true);
      }
    };

    const onWindowNotif = (e: Event) => {
      handleNotificationRoute((e as CustomEvent).detail);
    };

    const onSwMessage = (e: MessageEvent) => {
      if (e.data?.type === "NOTIFICATION_CLICK") {
        handleNotificationRoute(e.data.data);
      }
    };

    window.addEventListener("zust:notification-click", onWindowNotif);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onSwMessage);
    }

    return () => {
      window.removeEventListener("zust:notification-click", onWindowNotif);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", onSwMessage);
      }
    };
  }, []);

  const handleRequestNotifications = async () => {
    const res = await requestAppNotificationPermission();
    setNotifPermission(res);
  };

  const loadConversations = useCallback(async () => {
    try {
      const res = await api.conversations.list();
      setConversations(res.conversations);
      try {
        localStorage.setItem(CONV_CACHE_KEY, JSON.stringify(res.conversations));
      } catch {}

      const entries: Array<{ userId: string; isOnline?: boolean; lastSeenAt?: string | null }> = [];
      const ids: string[] = [];
      for (const c of res.conversations) {
        for (const m of c.members) {
          if (m.user && m.userId !== user?.id) {
            ids.push(m.user.id);
            entries.push({
              userId: m.user.id,
              isOnline: m.user.isOnline,
              lastSeenAt: m.user.lastSeenAt,
            });
          }
        }
      }
      if (entries.length > 0) updatePresenceBulk(entries);
      if (ids.length > 0) syncPresence([...new Set(ids)]);
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    }
  }, [user?.id, syncPresence, updatePresenceBulk]);

  useEffect(() => {
    if (user) {
      loadConversations();
      api.nearby
        .getRequests()
        .then((res) => setPendingRadarRequests((res.incoming || []).length))
        .catch(() => {});
    }
  }, [user, loadConversations]);

  // Handle QR Deep-Link (`/?chat=@username` or `/chat/@username`)
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const paramChat = params.get("chat");
    const pathMatch = window.location.pathname.match(/\/chat\/@?([a-zA-Z0-9_]+)/);
    const targetUsername = (paramChat || pathMatch?.[1] || "").replace(/^@/, "").trim().toLowerCase();
    if (!targetUsername || targetUsername === user.username.toLowerCase()) return;

    window.history.replaceState({}, "", "/");
    api.users
      .lookupByUsername(targetUsername)
      .then((res) => {
        if (!res.user?.id) return null;
        return api.conversations.createDirect(res.user.id);
      })
      .then((convRes) => {
        if (convRes?.conversation?.id) {
          loadConversations();
          setActiveConversationId(convRes.conversation.id);
        }
      })
      .catch(() => {});
  }, [user, loadConversations]);

  useEffect(() => {
    if (!socket || !user) return;

    const handleConversationUpdated = () => {
      loadConversations();
    };

    const handleNewMessageNotif = (msg: Message) => {
      loadConversations();
      if (msg.senderId === user.id) return;

      const isViewingThisChat =
        !document.hidden &&
        !isRadarOpenRef.current &&
        activeConversationIdRef.current === msg.conversationId;

      if (!isViewingThisChat) {
        const senderName = msg.sender?.displayName || msg.sender?.username || "New Message";
        const preview = msg.isViewOnce
          ? "📷 Sent a view-once photo"
          : msg.type === "VOICE"
          ? "🎤 Sent a voice message"
          : msg.type === "IMAGE"
          ? "📷 Sent a photo"
          : msg.body || "Sent a message";

        playSoftNotificationTone();
        showAppNotification({
          title: senderName,
          body: preview,
          tag: `msg-${msg.conversationId}`,
          data: { type: "message", conversationId: msg.conversationId },
        });
      }
    };

    const handleIncomingCall = (data: {
      fromUserId: string;
      callerName: string;
      callerAvatar?: string;
      isVideo: boolean;
      conversationId: string;
    }) => {
      setIsCallMinimized(false);
      setActiveCall({
        isActive: true,
        isIncoming: true,
        isVideo: data.isVideo,
        otherUser: {
          id: data.fromUserId,
          displayName: data.callerName,
          username: data.callerName,
          avatarUrl: data.callerAvatar,
        },
        conversationId: data.conversationId,
      });

      showAppNotification({
        title: `Incoming ${data.isVideo ? "Video" : "Voice"} Call`,
        body: `${data.callerName} is calling you...`,
        tag: `call-${data.fromUserId}`,
        requireInteraction: true,
        vibrate: [300, 150, 300, 150, 300],
        data: { type: "call", conversationId: data.conversationId },
      });
    };

    const handleIncomingGroupCall = (data: {
      conversationId: string;
      conversationTitle: string;
      callerName: string;
      isVideo: boolean;
    }) => {
      setActiveGroupCall({
        isActive: true,
        isIncoming: true,
        isVideo: data.isVideo,
        conversationId: data.conversationId,
        conversationTitle: data.conversationTitle,
        callerName: data.callerName,
      });

      showAppNotification({
        title: `Group ${data.isVideo ? "Video" : "Voice"} Call`,
        body: `${data.callerName} started a call in ${data.conversationTitle}`,
        tag: `gcall-${data.conversationId}`,
        requireInteraction: true,
        vibrate: [300, 150, 300],
        data: { type: "call", conversationId: data.conversationId },
      });
    };

    const handleNearbyRequestReceived = (req: any) => {
      api.nearby
        .getRequests()
        .then((res) => setPendingRadarRequests((res.incoming || []).length))
        .catch(() => {});

      const senderName = req?.sender?.displayName || req?.sender?.username || "Someone nearby";
      playSoftNotificationTone();
      showAppNotification({
        title: "Nearby Radar Request",
        body: `${senderName} wants to connect with you!`,
        tag: `nearby-req-${req?.id || Date.now()}`,
        data: { type: "nearby_request" },
      });
    };

    const handleNearbyRequestAccepted = (data: any) => {
      loadConversations();
      playSoftNotificationTone();
      showAppNotification({
        title: "Connection Accepted",
        body: "Your nearby connection request was accepted — tap to chat!",
        tag: `nearby-acc-${data?.requestId || Date.now()}`,
        data: { type: "message", conversationId: data?.conversationId },
      });
    };

    const refreshRadarBadge = () => {
      api.nearby
        .getRequests()
        .then((res) => setPendingRadarRequests((res.incoming || []).length))
        .catch(() => {});
    };

    const handleConversationRead = ({
      conversationId,
      userId: readerId,
      readAt,
    }: {
      conversationId: string;
      userId: string;
      readAt: string;
    }) => {
      if (readerId === user.id) return;
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== conversationId || !conv.messages?.length) return conv;
          return {
            ...conv,
            messages: conv.messages.map((m) => {
              if (m.senderId !== user.id) return m;
              const receipts = m.receipts || [];
              const hasReader = receipts.some((r) => r.userId === readerId);
              return {
                ...m,
                receipts: hasReader
                  ? receipts.map((r) => (r.userId === readerId ? { ...r, deliveredAt: r.deliveredAt || readAt, readAt: r.readAt || readAt } : r))
                  : [...receipts, { id: `read-${readerId}`, messageId: m.id, userId: readerId, deliveredAt: readAt, readAt }],
              };
            }),
          };
        })
      );
    };

    const handleMessageReceipt = ({
      conversationId,
      messageId,
      userId: readerId,
      readAt,
    }: {
      conversationId?: string;
      messageId: string;
      userId: string;
      readAt: string;
    }) => {
      if (readerId === user.id) return;
      setConversations((prev) =>
        prev.map((conv) => {
          if ((conversationId && conv.id !== conversationId) || !conv.messages?.length) return conv;
          return {
            ...conv,
            messages: conv.messages.map((m) => {
              if (m.id !== messageId) return m;
              const receipts = m.receipts || [];
              const hasReader = receipts.some((r) => r.userId === readerId);
              return {
                ...m,
                receipts: hasReader
                  ? receipts.map((r) => (r.userId === readerId ? { ...r, deliveredAt: r.deliveredAt || readAt, readAt: r.readAt || readAt } : r))
                  : [...receipts, { id: `read-${readerId}`, messageId: m.id, userId: readerId, deliveredAt: readAt, readAt }],
              };
            }),
          };
        })
      );
    };

    socket.on("conversation:updated", handleConversationUpdated);
    socket.on("conversation:read", handleConversationRead);
    socket.on("message:receipt", handleMessageReceipt);
    socket.on("message:new", handleNewMessageNotif);
    socket.on("user:updated", handleConversationUpdated);
    socket.on("call:incoming", handleIncomingCall);
    socket.on("group-call:incoming", handleIncomingGroupCall);
    socket.on("nearby:request-received", handleNearbyRequestReceived);
    socket.on("nearby:request-cancelled", refreshRadarBadge);
    socket.on("nearby:request-accepted", handleNearbyRequestAccepted);

    const handleReminderDue = (data: { text?: string }) => {
      playSoftNotificationTone();
      showAppNotification({
        title: "⏰ Zust Talk Reminder",
        body: data?.text || "You have a scheduled reminder",
        tag: `reminder-${Date.now()}`,
      });
    };

    const handleScheduledExecuted = (job: any) => {
      loadConversations();
      if (job?.resultMessage) {
        showAppNotification({
          title: "Scheduled Action Update",
          body: job.resultMessage,
          tag: `sched-${job.id || Date.now()}`,
        });
      }
    };

    const handleScheduledCallDue = (data: {
      targetUserId?: string;
      conversationId?: string;
      targetLabel?: string;
      isVideo?: boolean;
    }) => {
      if (data?.targetUserId && data?.conversationId) {
        setIsCallMinimized(false);
        setActiveCall({
          isActive: true,
          isIncoming: false,
          isVideo: Boolean(data.isVideo),
          otherUser: {
            id: data.targetUserId,
            displayName: data.targetLabel,
            username: data.targetLabel || "User",
          },
          conversationId: data.conversationId,
        });
      }
    };

    socket.on("ai:reminder-due", handleReminderDue);
    socket.on("ai:scheduled-executed", handleScheduledExecuted);
    socket.on("ai:scheduled-call-due", handleScheduledCallDue);

    return () => {
      socket.off("conversation:updated", handleConversationUpdated);
      socket.off("conversation:read", handleConversationRead);
      socket.off("message:receipt", handleMessageReceipt);
      socket.off("message:new", handleNewMessageNotif);
      socket.off("user:updated", handleConversationUpdated);
      socket.off("call:incoming", handleIncomingCall);
      socket.off("group-call:incoming", handleIncomingGroupCall);
      socket.off("nearby:request-received", handleNearbyRequestReceived);
      socket.off("nearby:request-cancelled", refreshRadarBadge);
      socket.off("nearby:request-accepted", handleNearbyRequestAccepted);
      socket.off("ai:reminder-due", handleReminderDue);
      socket.off("ai:scheduled-executed", handleScheduledExecuted);
      socket.off("ai:scheduled-call-due", handleScheduledCallDue);
    };
  }, [socket, user, loadConversations]);

  const toggleLanguage = () => setLang((prev) => (prev === "en" ? "hi" : "en"));
  const toggleTheme = () => setIsDark((prev) => !prev);

  const handleToggleArchive = async (conversationId: string, archived: boolean) => {
    try {
      await api.conversations.toggleArchive(conversationId, archived);
      if (archived && activeConversationId === conversationId) {
        setActiveConversationId(null);
      }
      await loadConversations();
    } catch (err: any) {
      alert(err.message || "Failed to update archive status");
    }
  };

  const handleStartCall = (isVideo: boolean) => {
    if (!activeConversation) return;
    const otherMember = activeConversation.members.find((m) => m.userId !== user?.id);
    if (!otherMember || !otherMember.user) return;

    setIsCallMinimized(false);
    setActiveCall({
      isActive: true,
      isIncoming: false,
      isVideo,
      otherUser: {
        id: otherMember.user.id,
        displayName: otherMember.user.displayName,
        username: otherMember.user.username,
        avatarUrl: otherMember.user.avatarUrl || undefined,
      },
      conversationId: activeConversation.id,
    });
  };

  const handleStartGroupCall = (isVideo: boolean) => {
    if (!activeConversation) return;
    setActiveGroupCall({
      isActive: true,
      isIncoming: false,
      isVideo,
      conversationId: activeConversation.id,
      conversationTitle: activeConversation.title || "Group Call",
    });
  };

  const handleMessageUserById = async (targetUserId: string) => {
    try {
      const res = await api.conversations.createDirect(targetUserId);
      await loadConversations();
      setActiveConversationId(res.conversation.id);
    } catch {}
  };

  if (loading) {
    return (
      <div className="fixed inset-0 h-dvh w-screen flex flex-col items-center justify-center bg-slate-950 text-white space-y-3">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-medium text-slate-300">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        lang={lang}
        onToggleLang={toggleLanguage}
        isDark={isDark}
        onToggleTheme={toggleTheme}
      />
    );
  }

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  return (
    <div className="fixed inset-0 h-dvh w-screen flex bg-slate-100 dark:bg-slate-950 overflow-hidden font-sans">
      <div
        className={`h-full min-h-0 overflow-hidden ${
          activeConversationId || isRadarOpen || isAssistantOpen ? "hidden md:flex" : "flex"
        } w-full md:w-auto`}
      >
        <Sidebar
          conversations={conversations}
          activeId={isRadarOpen || isAssistantOpen ? null : activeConversationId}
          onSelect={(id) => {
            setIsRadarOpen(false);
            setIsAssistantOpen(false);
            setActiveConversationId(id);
            setIsGroupInfoOpen(false);
          }}
          onNewChat={() => setIsNewChatOpen(true)}
          onOpenProfile={() => setIsProfileOpen(true)}
          onOpenInvite={() => setIsInviteOpen(true)}
          onOpenSecurity={() => setIsAccountSecurityOpen(true)}
          onOpenRadar={() => {
            setRadarInitialTab("NEARBY");
            setIsAssistantOpen(false);
            setIsRadarOpen(true);
            setIsGroupInfoOpen(false);
          }}
          isRadarActive={isRadarOpen}
          onOpenAssistant={() => {
            setIsRadarOpen(false);
            setIsAssistantOpen(true);
            setIsGroupInfoOpen(false);
          }}
          isAssistantActive={isAssistantOpen}
          pendingRadarRequests={pendingRadarRequests}
          onToggleArchive={handleToggleArchive}
          notificationPermission={notifPermission}
          onRequestNotifications={handleRequestNotifications}
          lang={lang}
          isDark={isDark}
          onToggleTheme={toggleTheme}
        />
      </div>

      <div
        className={`h-full min-h-0 min-w-0 flex-1 flex flex-col overflow-hidden ${
          !activeConversationId && !isRadarOpen && !isAssistantOpen ? "hidden md:flex" : "flex"
        }`}
      >
        {isAssistantOpen ? (
          <AssistantPage
            onBack={() => setIsAssistantOpen(false)}
            onConversationsChanged={loadConversations}
            onOpenConversation={(convId) => {
              setIsAssistantOpen(false);
              loadConversations();
              setActiveConversationId(convId);
            }}
            onStartCallWithUser={({ conversationId, otherUser, isVideo }) => {
              setIsAssistantOpen(false);
              setIsCallMinimized(false);
              setActiveCall({
                isActive: true,
                isIncoming: false,
                isVideo,
                otherUser: {
                  id: otherUser.id,
                  displayName: otherUser.displayName,
                  username: otherUser.username,
                  avatarUrl: otherUser.avatarUrl || undefined,
                },
                conversationId,
              });
            }}
          />
        ) : isRadarOpen ? (
          <NearbyRadarPage
            initialTab={radarInitialTab}
            onBack={() => setIsRadarOpen(false)}
            onRequestsCountChange={setPendingRadarRequests}
            onOpenConversation={(convId) => {
              setIsRadarOpen(false);
              loadConversations();
              setActiveConversationId(convId);
            }}
          />
        ) : activeConversation ? (
          <ChatArea
            key={activeConversation.id}
            conversation={activeConversation}
            allConversations={conversations}
            onBack={() => {
              setActiveConversationId(null);
              setIsGroupInfoOpen(false);
            }}
            onToggleInfo={() => setIsGroupInfoOpen(!isGroupInfoOpen)}
            onConversationUpdated={loadConversations}
            onStartCall={handleStartCall}
            onStartGroupCall={handleStartGroupCall}
            onViewProfile={(u) => setViewingUser(u)}
            onToggleArchive={handleToggleArchive}
            lang={lang}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 chat-bg-pattern text-center">
            <div className="max-w-sm w-full bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl border border-slate-200/70 dark:border-slate-800/80 rounded-3xl p-7 shadow-xl space-y-4">
              <div className="w-14 h-14 bg-gradient-to-tr from-emerald-500 to-teal-500 text-white rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-emerald-600/20">
                <MessageSquare className="w-7 h-7" />
              </div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{t.appName}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                {lang === "hi" ? "बातचीत शुरू करने के लिए कोई चैट चुनें।" : "Select a chat or search anyone to start messaging."}
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsNewChatOpen(true)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-sm transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t.startNewChat}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsInviteOpen(true)}
                  className="px-3.5 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-700 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-colors"
                >
                  <QrCode className="w-3.5 h-3.5 text-emerald-600" />
                  <span>QR & Scan</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRadarInitialTab("NEARBY");
                    setIsRadarOpen(true);
                  }}
                  className="px-3.5 py-2 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors"
                >
                  <Radar className="w-3.5 h-3.5" />
                  <span>Nearby Radar</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRadarOpen(false);
                    setIsAssistantOpen(true);
                  }}
                  className="px-3.5 py-2 bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-sm transition-all"
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>AI Assistant</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {backToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-slate-900/90 text-white text-xs font-medium shadow-xl animate-fadeIn">
          {backToast}
        </div>
      )}

      {isGroupInfoOpen && activeConversation && activeConversation.type === "GROUP" && (
        <GroupInfoDrawer
          isOpen={isGroupInfoOpen}
          onClose={() => setIsGroupInfoOpen(false)}
          conversation={activeConversation}
          onUpdate={loadConversations}
          onViewMember={(u) => setViewingUser(u)}
        />
      )}

      <NewChatModal
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
        onConversationCreated={(id) => {
          loadConversations();
          setActiveConversationId(id);
        }}
      />

      <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />

      <UserProfileModal
        isOpen={Boolean(viewingUser)}
        onClose={() => setViewingUser(null)}
        user={viewingUser}
        onStartCall={
          activeConversation?.type === "DIRECT" ? (isVid) => handleStartCall(isVid) : undefined
        }
        onMessageUser={handleMessageUserById}
      />

      <InviteModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        user={user}
        onConversationOpened={(id) => {
          loadConversations();
          setActiveConversationId(id);
        }}
      />

      <E2EEModal
        isOpen={isAccountSecurityOpen}
        onClose={() => setIsAccountSecurityOpen(false)}
        peerName={user.displayName || user.username}
      />

      {activeCall && user && (
        <CallModal
          socket={socket}
          currentUser={user}
          callState={activeCall}
          isMinimized={isCallMinimized}
          onMinimize={() => setIsCallMinimized(true)}
          onExpand={() => setIsCallMinimized(false)}
          onEndCall={() => {
            setActiveCall(null);
            setIsCallMinimized(false);
          }}
        />
      )}

      {activeGroupCall && user && (
        <GroupCallModal
          socket={socket}
          currentUser={user}
          groupCall={activeGroupCall}
          onEndCall={() => setActiveGroupCall(null)}
        />
      )}
    </div>
  );
};
