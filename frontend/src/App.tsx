import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "./context/AuthContext";
import { useSocket } from "./context/SocketContext";
import { api } from "./api/client";
import { Conversation } from "./types";
import { Language, translations } from "./utils/i18n";
import { useInitAppBackGuard, useBackLayer } from "./utils/useBackNavigation";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { NewChatModal } from "./components/NewChatModal";
import { ProfileModal } from "./components/ProfileModal";
import { GroupInfoDrawer } from "./components/GroupInfoDrawer";
import { InviteModal } from "./components/InviteModal";
import { CallModal, ActiveCallState } from "./components/CallModal";
import { MessageSquare, ShieldCheck, Plus, Video, Languages, Sparkles, QrCode } from "lucide-react";

export const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const { socket } = useSocket();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [lang, setLang] = useState<Language>("en");
  const [isDark, setIsDark] = useState<boolean>(() => {
    return localStorage.getItem("zust_theme") === "dark";
  });

  // Modals & Call state
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [backToast, setBackToast] = useState<string | null>(null);

  const t = translations[lang];

  // Sync dark mode class on <html>
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    localStorage.setItem("zust_theme", isDark ? "dark" : "light");
  }, [isDark]);

  const handleRootBack = useCallback(() => {
    setBackToast("You're on the home screen");
    setTimeout(() => {
      setBackToast(null);
    }, 2000);
  }, []);

  // Keep all browser Back button actions inside the app
  useInitAppBackGuard(handleRootBack);

  useBackLayer("active-call", 90, Boolean(activeCall && !isCallMinimized), () => {
    setIsCallMinimized(true);
  });
  useBackLayer("new-chat-modal", 60, isNewChatOpen, () => setIsNewChatOpen(false));
  useBackLayer("profile-modal", 60, isProfileOpen, () => setIsProfileOpen(false));
  useBackLayer("invite-modal", 60, isInviteOpen, () => setIsInviteOpen(false));
  useBackLayer("group-info-drawer", 50, isGroupInfoOpen, () => setIsGroupInfoOpen(false));
  useBackLayer("active-conversation", 40, Boolean(activeConversationId), () => {
    setActiveConversationId(null);
    setIsGroupInfoOpen(false);
  });

  const loadConversations = async () => {
    try {
      const res = await api.conversations.list();
      setConversations(res.conversations);
    } catch (err) {
      console.error("Failed to fetch conversations:", err);
    }
  };

  useEffect(() => {
    if (user) {
      loadConversations();
    }
  }, [user]);

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
    socket.on("call:incoming", handleIncomingCall);

    return () => {
      socket.off("conversation:updated", handleConversationUpdated);
      socket.off("message:new", handleConversationUpdated);
      socket.off("user:updated", handleConversationUpdated);
      socket.off("call:incoming", handleIncomingCall);
    };
  }, [socket]);

  const toggleLanguage = () => {
    setLang((prev) => (prev === "en" ? "hi" : "en"));
  };

  const toggleTheme = () => {
    setIsDark((prev) => !prev);
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

  if (loading) {
    return (
      <div className="fixed inset-0 h-dvh w-screen flex flex-col items-center justify-center bg-slate-950 text-white space-y-3">
        <div className="w-11 h-11 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-semibold text-slate-300 tracking-wide">Loading {t.appName}...</p>
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
      {/* Sidebar: Visible on desktop or when no conversation is active on mobile */}
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
          lang={lang}
          onToggleLang={toggleLanguage}
          isDark={isDark}
          onToggleTheme={toggleTheme}
        />
      </div>

      {/* Main Chat Area */}
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
            lang={lang}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50 dark:bg-slate-950 text-center overflow-y-auto">
            <div className="max-w-lg space-y-6 animate-scaleIn">
              <div className="w-20 h-20 bg-gradient-to-tr from-emerald-500 to-teal-500 text-white rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-emerald-600/25">
                <MessageSquare className="w-10 h-10" />
              </div>

              <div>
                <h2 className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">
                  {t.appName}
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-md mx-auto leading-relaxed">
                  {lang === "hi"
                    ? "साइडबार से चैट चुनें या नई बातचीत व ग्रुप शुरू करें।"
                    : "Select a conversation from the sidebar or start a new chat with HD video calling & smart Hindi-to-English messaging."}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-left max-w-md mx-auto">
                <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs mb-1">
                    <Video className="w-4 h-4" />
                    <span>Full-Screen Calls</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Edge-to-edge video calls with instant Front & Back camera flip.
                  </p>
                </div>
                <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center space-x-2 text-amber-600 dark:text-amber-400 font-bold text-xs mb-1">
                    <Languages className="w-4 h-4" />
                    <span>Hindi → English</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Type Hindi or Hinglish and auto-send in clean English directly!
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setIsNewChatOpen(true)}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl text-xs font-bold flex items-center space-x-2 shadow-lg shadow-emerald-600/25 transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t.startNewChat}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsInviteOpen(true)}
                  className="px-5 py-2.5 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold flex items-center space-x-2 transition-all"
                >
                  <QrCode className="w-4 h-4 text-emerald-600" />
                  <span>{t.inviteLink}</span>
                </button>
              </div>

              <div className="pt-4 flex items-center justify-center space-x-2 text-slate-400 text-xs">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                <span>{t.e2eeEncrypted}</span>
                <span>•</span>
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Smart Translate Enabled</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Home Back Button Guard Toast */}
      {backToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-slate-900/90 dark:bg-slate-800 text-white text-xs font-medium shadow-xl animate-fadeIn">
          {backToast}
        </div>
      )}

      {/* Group Info Drawer */}
      {isGroupInfoOpen && activeConversation && activeConversation.type === "GROUP" && (
        <GroupInfoDrawer
          isOpen={isGroupInfoOpen}
          onClose={() => setIsGroupInfoOpen(false)}
          conversation={activeConversation}
          onUpdate={loadConversations}
        />
      )}

      {/* Modals */}
      <NewChatModal
        isOpen={isNewChatOpen}
        onClose={() => setIsNewChatOpen(false)}
        onConversationCreated={(id) => {
          loadConversations();
          setActiveConversationId(id);
        }}
      />

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
      />

      <InviteModal
        isOpen={isInviteOpen}
        onClose={() => setIsInviteOpen(false)}
        user={user}
      />

      {/* WebRTC Full-Screen Video & Voice Call Modal */}
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
    </div>
  );
};
