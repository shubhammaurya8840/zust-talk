import React, { useState } from "react";
import { Conversation, User } from "../types";
import { useAuth } from "../context/AuthContext";
import { Language, translations } from "../utils/i18n";
import {
  MessageSquarePlus,
  Users,
  Search,
  LogOut,
  Settings,
  CheckCheck,
  User as UserIcon,
  QrCode,
  Moon,
  Sun,
  X,
  Sparkles,
} from "lucide-react";

interface SidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onOpenProfile: () => void;
  onOpenInvite: () => void;
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
  lang,
  onToggleLang,
  isDark = false,
  onToggleTheme,
}) => {
  const { user, logout } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "DIRECT" | "GROUP">("ALL");

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

  const filtered = conversations.filter((c) => {
    if (filter === "DIRECT" && c.type !== "DIRECT") return false;
    if (filter === "GROUP" && c.type !== "GROUP") return false;
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
    <div className="h-full min-h-0 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 w-full md:w-80 lg:w-96 shrink-0">
      {/* Top App & Profile Bar */}
      <div className="shrink-0 px-3.5 py-3 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900 dark:to-slate-900 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
        <div
          className="flex items-center space-x-2.5 cursor-pointer min-w-0 flex-1 group"
          onClick={onOpenProfile}
        >
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold text-sm shadow-md shadow-emerald-600/20 group-hover:scale-105 transition-transform">
              {user?.displayName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || "U"}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-1.5">
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight truncate">
                {user?.displayName || user?.username}
              </h2>
            </div>
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center space-x-1">
              <span>{t.appName}</span>
              <span className="text-slate-300 dark:text-slate-600">•</span>
              <span>{t.online}</span>
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

          {/* Language Switcher */}
          <button
            type="button"
            onClick={onToggleLang}
            title="Switch App Language (English / हिंदी)"
            className="px-2 py-1.5 text-slate-600 dark:text-slate-300 hover:text-emerald-700 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors text-[11px] font-bold"
          >
            {lang === "en" ? "हिं" : "EN"}
          </button>

          {/* QR / Invite Link Modal */}
          <button
            type="button"
            onClick={onOpenInvite}
            title={t.inviteLink}
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-xl transition-colors"
          >
            <QrCode className="w-4 h-4" />
          </button>

          {/* New Chat Button */}
          <button
            type="button"
            onClick={onNewChat}
            title={t.startNewChat}
            className="p-2 text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm shadow-emerald-600/20 mx-0.5"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>

          {/* Profile Settings */}
          <button
            type="button"
            onClick={onOpenProfile}
            title={t.profileSettings}
            className="p-2 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Logout */}
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

      {/* Search Input & Filter Pills */}
      <div className="shrink-0 p-3 border-b border-slate-100 dark:border-slate-800 space-y-2.5 bg-white dark:bg-slate-900">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full pl-9 pr-8 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/70 dark:hover:bg-slate-800/80 focus:bg-white dark:focus:bg-slate-950 rounded-xl text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 border border-transparent focus:border-emerald-500 focus:outline-none transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            {(["ALL", "DIRECT", "GROUP"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`text-xs px-3 py-1 rounded-full font-semibold transition-all ${
                  filter === tab
                    ? "bg-emerald-600 text-white shadow-sm shadow-emerald-600/20"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {tab === "ALL" ? t.chats : tab === "DIRECT" ? t.direct : t.groups}
              </button>
            ))}
          </div>

          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center space-x-1">
            <Sparkles className="w-3 h-3" />
            <span>हिं→EN</span>
          </span>
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 overscroll-contain">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 flex flex-col items-center justify-center h-full">
            <div className="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
              <Users className="w-8 h-8 text-slate-400" />
            </div>
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No conversations found</p>
            <p className="text-xs mt-1 text-slate-400 max-w-[220px]">
              Tap the green <MessageSquarePlus className="w-3.5 h-3.5 inline mx-0.5 text-emerald-600" /> button above to start chatting or create a group.
            </p>
            <button
              type="button"
              onClick={onNewChat}
              className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
            >
              {t.startNewChat}
            </button>
          </div>
        ) : (
          filtered.map((c) => {
            const isSelected = c.id === activeId;
            const title = getConversationTitle(c);
            const otherUser = getOtherUser(c);
            const lastMsg = c.messages?.[0];
            const isMyLastMsg = lastMsg?.senderId === user?.id;
            const isRead = lastMsg?.receipts?.some((r) => r.readAt);

            return (
              <div
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`px-3.5 py-3 flex items-center space-x-3 cursor-pointer transition-all ${
                  isSelected
                    ? "bg-emerald-50/90 dark:bg-emerald-950/40 border-l-4 border-emerald-600"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                }`}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-white shadow-sm ${
                      c.type === "GROUP"
                        ? "bg-gradient-to-tr from-indigo-500 to-purple-600"
                        : "bg-gradient-to-tr from-emerald-500 to-teal-600"
                    }`}
                  >
                    {c.type === "GROUP" ? (
                      <Users className="w-5 h-5" />
                    ) : otherUser?.displayName?.[0]?.toUpperCase() || otherUser?.username?.[0]?.toUpperCase() || (
                      <UserIcon className="w-5 h-5" />
                    )}
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                      {title}
                    </h3>
                    <span className="text-[10px] font-medium text-slate-400 shrink-0">
                      {formatTime(lastMsg?.createdAt || c.updatedAt)}
                    </span>
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
                        : lastMsg?.body || (lastMsg?.attachments?.length ? "Shared an attachment" : "Tap to start chatting")}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
