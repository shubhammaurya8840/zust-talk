import React, { useState, useEffect } from "react";
import { useAuth } from "./context/AuthContext";
import { useSocket } from "./context/SocketContext";
import { api } from "./api/client";
import { Conversation } from "./types";
import { Language, translations } from "./utils/i18n";
import { AuthScreen } from "./components/AuthScreen";
import { Sidebar } from "./components/Sidebar";
import { ChatArea } from "./components/ChatArea";
import { NewChatModal } from "./components/NewChatModal";
import { ProfileModal } from "./components/ProfileModal";
import { GroupInfoDrawer } from "./components/GroupInfoDrawer";
import { InviteModal } from "./components/InviteModal";
import { CallModal, ActiveCallState } from "./components/CallModal";
import { MessageSquare, ShieldCheck, Plus } from "lucide-react";

export const AppContent: React.FC = () => {
  const { user, loading } = useAuth();
  const { socket } = useSocket();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [lang, setLang] = useState<Language>("en");

  // Modals state
  const [isNewChatOpen, setIsNewChatOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isGroupInfoOpen, setIsGroupInfoOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCallState | null>(null);

  const t = translations[lang];

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

  // Listen to socket events for real-time list updates
  useEffect(() => {
    if (!socket) return;

    const handleConversationUpdated = () => {
      loadConversations();
    };

    socket.on("conversation:updated", handleConversationUpdated);
    socket.on("message:new", handleConversationUpdated);
    socket.on("user:updated", handleConversationUpdated);

    // Incoming Call Listener
    const handleIncomingCall = (data: {
      fromUserId: string;
      callerName: string;
      callerAvatar?: string;
      isVideo: boolean;
      conversationId: string;
    }) => {
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

  const handleStartCall = (isVideo: boolean) => {
    if (!activeConversation) return;
    const otherMember = activeConversation.members.find((m) => m.userId !== user?.id);
    if (!otherMember || !otherMember.user) return;

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
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-900 text-white space-y-3">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-medium text-slate-300">Loading {t.appName}...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen lang={lang} onToggleLang={toggleLanguage} />;
  }

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  return (
    <div className="h-screen w-screen flex bg-slate-100 overflow-hidden font-sans">
      {/* Sidebar: Visible on desktop or when no conversation is active on mobile */}
      <div
        className={`h-full ${
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
        />
      </div>

      {/* Main Chat Area */}
      <div
        className={`h-full flex-1 flex flex-col ${
          !activeConversationId ? "hidden md:flex" : "flex"
        }`}
      >
        {activeConversation ? (
          <ChatArea
            key={activeConversation.id}
            conversation={activeConversation}
            allConversations={conversations}
            onBack={() => setActiveConversationId(null)}
            onToggleInfo={() => setIsGroupInfoOpen(!isGroupInfoOpen)}
            onConversationUpdated={loadConversations}
            onStartCall={handleStartCall}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 bg-slate-50 text-center">
            <div className="max-w-md space-y-4">
              <div className="w-20 h-20 bg-emerald-100 text-emerald-700 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
                <MessageSquare className="w-10 h-10" />
              </div>
              <h2 className="text-2xl font-bold text-slate-800">{t.appName}</h2>
              <p className="text-sm text-slate-500">
                {lang === "hi"
                  ? "साइडबार से चैट चुनें या नई बातचीत व ग्रुप शुरू करें।"
                  : "Select a conversation from the sidebar or start a new 1-on-1 chat or group discussion."}
              </p>
              <div className="pt-2 flex justify-center space-x-3">
                <button
                  onClick={() => setIsNewChatOpen(true)}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center space-x-2 shadow-md shadow-emerald-600/20 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t.startNewChat}</span>
                </button>
              </div>
              <div className="pt-8 flex items-center justify-center space-x-2 text-slate-400 text-xs">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>{t.e2eeEncrypted} • Zero cloud cost</span>
              </div>
            </div>
          </div>
        )}
      </div>

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

      {/* WebRTC Video & Voice Call Modal */}
      {activeCall && user && (
        <CallModal
          socket={socket}
          currentUser={user}
          callState={activeCall}
          onEndCall={() => setActiveCall(null)}
        />
      )}
    </div>
  );
};
