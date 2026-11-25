import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "./context/AuthContext";
import { useSocket } from "./context/SocketContext";
import { api } from "./api/client";
import { Conversation, User } from "./types";
import { Language, translations } from "./utils/i18n";
import { useInitAppBackGuard, useBackLayer } from "./utils/useBackNavigation";
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
import { MessageSquare, Plus, QrCode } from "lucide-react";

export const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const { socket, syncPresence, updatePresenceBulk } = useSocket();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [lang, setLang] = useState<Language>("en");
  const [isDark, setIsDark] = useState<boolean>(() => localStorage.getItem("zust_theme") === "dark");

  // Modals & Call state
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [viewingUser, setViewingUser] = useState<User | null>(null);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [activeGroupCall, setActiveGroupCall] = useState<ActiveGroupCallState | null>(null);
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [backToast, setBackToast] = useState<string | null>(null);

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
  useBackLayer("group-info-drawer", 50, isGroupInfoOpen, () => setIsGroupInfoOpen(false));
  useBackLayer("active-conversation", 40, Boolean(activeConversationId), () => {
    setActiveConversationId(null);
    setIsGroupInfoOpen(false);
  });

  const loadConversations = useCallback(async () => {
    try {
      const res = await api.conversations.list();
      setConversations(res.conversations);

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
    }
  }, [user, loadConversations]);

  // Handle QR Deep-Link (`/?chat=@username` or `/chat/@username`) automatically!
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
    if (!socket) return;

    const handleConversationUpdated = () => {
      loadConversations();
    };

    socket.on("conversation:updated", handleConversationUpdated);
    socket.on("message:new", handleConversationUpdated);
    socket.on("user:updated", handleConversationUpdated);

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
    };

    socket.on("call:incoming", handleIncomingCall);
    socket.on("group-call:incoming", handleIncomingGroupCall);

    return () => {
      socket.off("conversation:updated", handleConversationUpdated);
      socket.off("message:new", handleConversationUpdated);
      socket.off("user:updated", handleConversationUpdated);
      socket.off("call:incoming", handleIncomingCall);
      socket.off("group-call:incoming", handleIncomingGroupCall);
    };
  }, [socket, loadConversations]);

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
          activeConversationId ? "hidden md:flex" : "flex"
        } w-full md:w-auto`}
      >
        <Sidebar
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={(id) => {
            setActiveConversationId(id);
            setIsGroupInfoOpen(false);
          }}
          onNewChat={() => setIsNewChatOpen(true)}
          onOpenProfile={() => setIsProfileOpen(true)}
          onOpenInvite={() => setIsInviteOpen(true)}
          onToggleArchive={handleToggleArchive}
          lang={lang}
          onToggleLang={toggleLanguage}
          isDark={isDark}
          onToggleTheme={toggleTheme}
        />
      </div>

      <div
        className={`h-full min-h-0 min-w-0 flex-1 flex flex-col overflow-hidden ${
          !activeConversationId ? "hidden md:flex" : "flex"
        }`}
      >
        {activeConversation ? (
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
          /* Minimal Clean Desktop Empty State (no marketing cards or feature text!) */
          <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50 dark:bg-slate-950 text-center">
            <div className="max-w-sm space-y-4">
              <div className="w-16 h-16 bg-gradient-to-tr from-emerald-500 to-teal-500 text-white rounded-3xl flex items-center justify-center mx-auto shadow-lg shadow-emerald-600/20">
                <MessageSquare className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t.appName}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {lang === "hi" ? "बातचीत शुरू करने के लिए कोई चैट चुनें।" : "Select a chat to start messaging."}
              </p>
              <div className="flex justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setIsNewChatOpen(true)}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t.startNewChat}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsInviteOpen(true)}
                  className="px-4 py-2.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold flex items-center space-x-1.5"
                >
                  <QrCode className="w-4 h-4 text-emerald-600" />
                  <span>QR & Scan</span>
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
          activeConversation?.type === "DIRECT"
            ? (isVid) => handleStartCall(isVid)
            : undefined
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
