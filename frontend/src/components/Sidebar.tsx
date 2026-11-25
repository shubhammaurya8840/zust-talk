import React, { useState } from "react";
import { Conversation, User } from "../types";
import { useAuth } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { Language, translations } from "../utils/i18n";
import { UserAvatar } from "../utils/avatars";
import {
  MessageSquarePlus,
  Users,
  Search,
  LogOut,
  Settings,
  CheckCheck,
  QrCode,
  Moon,
  Sun,
  X,
  Archive,
  Radar,
  Bell,
} from "lucide-react";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onOpenProfile: () => void;
  onOpenInvite: () => void;
  onOpenRadar?: () => void;
  isRadarActive?: boolean;
  pendingRadarRequests?: number;
  onToggleArchive?: (conversationId: string, archived: boolean) => void;
  notificationPermission?: NotificationPermission | "unsupported";
  onRequestNotifications?: () => void;
  lang: Language;
  onToggleLang: () => void;
  isDark?: boolean;
  onToggleTheme?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onOpenProfile,
  onOpenInvite,
  onOpenRadar,
  isRadarActive = false,
  pendingRadarRequests = 0,
  onToggleArchive,
  notificationPermission,
  onRequestNotifications,
  lang,
  onToggleLang,
  isDark = false,
  onToggleTheme,
}) => {
  const { user, logout } = useAuth();
  const { presenceMap, isConnected } = useSocket();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "DIRECT" | "GROUP" | "ARCHIVED">("ALL");

  const t = translations[lang];

  const getConversationTitle = (c: Conversation): string => {
    if (c.type === "GROUP") return c.title || t.groups;
    const otherMember = c.members.find((m) => m.userId !== user?.id);
    return otherMember?.user?.displayName || otherMember?.user?.username || t.direct;
  };

  const getOtherUser = (c: Conversation): User | undefined => {
    if (c.type === "GROUP") return undefined;
    return c.members.find((m) => m.userId !== user?.id)?.user;
  };

  const isArchivedForMe = (c: Conversation): boolean => {
    const me = c.members.find((m) => m.userId === user?.id);
    return Boolean(me?.archivedAt);
  };

  const archivedCount = conversations.filter((c) => isArchivedForMe(c)).length;

  const filtered = conversations.filter((c) => {
    const archived = isArchivedForMe(c);
    if (filter === "ARCHIVED") {
      if (!archived) return false;
    } else {
      if (archived) return false;
      if (filter === "DIRECT" && c.type !== "DIRECT") return false;
      if (filter === "GROUP" && c.type !== "GROUP") return false;
    }
    if (!search.trim()) return true;
    const title = getConversationTitle(c).toLowerCase();
    return title.includes(search.toLowerCase());
  });

  const formatTime = (dateStr?: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  return (
    <div className="relative h-full min-h-0 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 w-full md:w-80 lg:w-96 shrink-0">
      {/* Top Profile & Action Bar */}
      <div className="shrink-0 px-3.5 py-3 bg-slate-50/80 dark:bg-slate-900 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
        <div
          className="flex items-center space-x-2.5 cursor-pointer min-w-0 flex-1 group"
          onClick={onOpenProfile}
        >
          <UserAvatar
            name={user?.displayName}
            username={user?.username}
            avatarUrl={user?.avatarUrl}
            size="md"
            isOnline={isConnected}
            showOnlineDot
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight truncate">
              {user?.displayName || user?.username}
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
              {user?.bio || (isConnected ? t.online : "Connecting...")}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-0.5 shrink-0">
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              title={isDark ? "Light Mode" : "Dark Mode"}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-amber-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleLang}
            title="Switch Language"
            className="px-2 py-1.5 text-slate-600 dark:text-slate-300 hover:text-emerald-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-[11px] font-bold"
          >
            {lang === "en" ? "हिं" : "EN"}
          </button>

          <button
            type="button"
            onClick={onOpenInvite}
            title="QR Code & Scanner"
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-xl transition-colors"
          >
            <QrCode className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onNewChat}
            title={t.startNewChat}
            className="p-2 text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm mx-0.5"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onOpenProfile}
            title={t.profileSettings}
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={logout}
            title={t.logout}
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Compact Chrome Notification Opt-In Strip when Permission is Default */}
      {notificationPermission === "default" && onRequestNotifications && (
        <div className="shrink-0 px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200/70 dark:border-emerald-900 flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2 text-[11px] text-emerald-800 dark:text-emerald-200 font-medium min-w-0">
            <Bell className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="truncate">Turn on Chrome notifications for messages & calls</span>
          </div>
          <button
            type="button"
            onClick={onRequestNotifications}
            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shrink-0"
          >
            Enable
          </button>
        </div>
      )}

      {/* Search & Filter Tabs */}
      <div className="shrink-0 p-3 border-b border-slate-100 dark:border-slate-800 space-y-2.5 bg-white dark:bg-slate-900">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-950 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 border border-transparent focus:border-emerald-500 focus:outline-none transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar">
          {(["ALL", "DIRECT", "GROUP"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`text-xs px-3 py-1 rounded-full font-semibold shrink-0 transition-all ${
                filter === tab
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {tab === "ALL" ? t.chats : tab === "DIRECT" ? t.direct : t.groups}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setFilter("ARCHIVED")}
            className={`text-xs px-3 py-1 rounded-full font-semibold shrink-0 flex items-center space-x-1 transition-all ${
              filter === "ARCHIVED"
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            <Archive className="w-3 h-3" />
            <span>Archived{archivedCount > 0 ? ` (${archivedCount})` : ""}</span>
          </button>
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 overscroll-contain pb-20">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 flex flex-col items-center justify-center h-full">
            <Users className="w-10 h-10 text-slate-300 dark:text-slate-700 mb-2" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {filter === "ARCHIVED" ? "No archived chats" : "No chats yet"}
            </p>
            {filter !== "ARCHIVED" && (
              <button
                type="button"
                onClick={onNewChat}
                className="mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
              >
                {t.startNewChat}
              </button>
            )}
          </div>
        ) : (
          filtered.map((c) => {
            const isSelected = c.id === activeId;
            const title = getConversationTitle(c);
            const otherUser = getOtherUser(c);
            const lastMsg = c.messages?.[0];
            const isMyLastMsg = lastMsg?.senderId === user?.id;
            const isRead = lastMsg?.receipts?.some((r) => r.readAt);
            const archived = isArchivedForMe(c);

            const livePresence = otherUser ? presenceMap[otherUser.id] : undefined;
            const isOnline = livePresence ? livePresence.isOnline : Boolean(otherUser?.isOnline);

            return (
              <div
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`px-3.5 py-3 flex items-center space-x-3 cursor-pointer transition-all group ${
                  isSelected
                    ? "bg-emerald-50/90 dark:bg-emerald-950/40 border-l-4 border-emerald-600"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                }`}
              >
                {c.type === "GROUP" ? (
                  <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center shadow-sm shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                ) : (
                  <UserAvatar
                    name={otherUser?.displayName}
                    username={otherUser?.username}
                    avatarUrl={otherUser?.avatarUrl}
                    size="md"
                    isOnline={isOnline}
                    showOnlineDot
                  />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                      {title}
                    </h3>
                    <div className="flex items-center space-x-1 shrink-0">
                      <span className="text-[10px] font-medium text-slate-400">
                        {formatTime(lastMsg?.createdAt || c.updatedAt)}
                      </span>
                      {onToggleArchive && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleArchive(c.id, !archived);
                          }}
                          title={archived ? "Unarchive chat" : "Archive chat"}
                          className="p-1 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {isMyLastMsg && (
                      <CheckCheck
                        className={`w-3.5 h-3.5 mr-1 shrink-0 ${
                          isRead ? "text-sky-500" : "text-slate-400"
                        }`}
                      />
                    )}
                    <span className="truncate">
                      {lastMsg?.deletedAt
                        ? "This message was deleted"
                        : lastMsg?.isViewOnce
                        ? "📷 View once photo"
                        : lastMsg?.body || (lastMsg?.attachments?.length ? "Shared an attachment" : "Tap to start chatting")}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Bottom-Right Circular Nearby Radar Button */}
      {onOpenRadar && (
        <button
          type="button"
          onClick={onOpenRadar}
          title="Nearby Radar (100m)"
          className={`absolute bottom-5 right-5 z-20 w-14 h-14 rounded-full flex items-center justify-center shadow-2xl transition-all hover:scale-105 active:scale-95 border-2 ${
            isRadarActive
              ? "bg-slate-900 dark:bg-emerald-500 text-white border-emerald-400 ring-4 ring-emerald-500/30"
              : "bg-gradient-to-tr from-emerald-500 to-teal-600 text-white border-white/80 dark:border-slate-800 shadow-emerald-600/35"
          }`}
        >
          <Radar className="w-6 h-6" />
          {pendingRadarRequests > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-amber-400 text-slate-950 text-[10px] font-extrabold flex items-center justify-center shadow">
              {pendingRadarRequests}
            </span>
          )}
        </button>
      )}
    </div>
  );
};
