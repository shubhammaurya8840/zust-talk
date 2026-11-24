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
  Languages,
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
    <div className="h-full flex flex-col bg-white border-r border-slate-200 w-full md:w-80 lg:w-96 shrink-0">
      {/* Top Profile / Action Bar */}
      <div className="p-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center space-x-2.5 cursor-pointer" onClick={onOpenProfile}>
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-bold text-sm shadow-sm ring-2 ring-emerald-500/20 shrink-0">
            {user?.displayName?.[0]?.toUpperCase() || user?.username?.[0]?.toUpperCase() || "U"}
          </div>
          <div className="truncate">
            <h2 className="text-sm font-semibold text-slate-800 leading-tight truncate">
              {user?.displayName || user?.username}
            </h2>
            <p className="text-[11px] text-emerald-600 font-medium">{t.online}</p>
          </div>
        </div>

        <div className="flex items-center space-x-0.5">
          {/* Language Switcher */}
          <button
            onClick={onToggleLang}
            title="Switch Language (English / हिंदी)"
            className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-slate-200/60 rounded-xl transition-colors text-xs font-bold"
          >
            {lang === "en" ? "हिं" : "EN"}
          </button>

          {/* QR / Invite Link Modal */}
          <button
            onClick={onOpenInvite}
            title={t.inviteLink}
            className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
          >
            <QrCode className="w-4 h-4" />
          </button>

          {/* New Chat Button */}
          <button
            onClick={onNewChat}
            title={t.startNewChat}
            className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>

          {/* Profile Settings */}
          <button
            onClick={onOpenProfile}
            title={t.profileSettings}
            className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          {/* Logout */}
          <button
            onClick={logout}
            title={t.logout}
            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search Input & Filter Pills */}
      <div className="p-3 border-b border-slate-100 space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-100 hover:bg-slate-200/70 focus:bg-white rounded-xl text-xs text-slate-800 placeholder-slate-400 border border-transparent focus:border-emerald-500 focus:outline-none transition-all"
          />
        </div>

        <div className="flex items-center space-x-1.5 pt-0.5">
          {(["ALL", "DIRECT", "GROUP"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${
                filter === tab
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {tab === "ALL" ? t.chats : tab === "DIRECT" ? t.direct : t.groups}
            </button>
          ))}
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Users className="w-12 h-12 mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-medium">No conversations found</p>
            <p className="text-xs mt-1 text-slate-400">
              Click the <MessageSquarePlus className="w-3.5 h-3.5 inline mx-0.5 text-emerald-600" /> icon to message someone or create a group!
            </p>
          </div>
        ) : (
          filtered.map((c) => {
            const isSelected = c.id === activeId;
            const title = getConversationTitle(c);
            const otherUser = getOtherUser(c);
            const lastMsg = c.messages?.[0];
            const isMyLastMsg = lastMsg?.senderId === user?.id;

            return (
              <div
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={`p-3 flex items-center space-x-3 cursor-pointer transition-colors ${
                  isSelected ? "bg-emerald-50/70 border-l-4 border-emerald-600" : "hover:bg-slate-50"
                }`}
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div
                    className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-white shadow-sm ${
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
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800 truncate">{title}</h3>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {formatTime(lastMsg?.createdAt || c.updatedAt)}
                    </span>
                  </div>

                  <div className="flex items-center text-xs text-slate-500 mt-0.5 truncate">
                    {isMyLastMsg && (
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-600 mr-1 shrink-0" />
                    )}
                    <span className="truncate">
                      {lastMsg?.deletedAt
                        ? "This message was deleted"
                        : lastMsg?.body || (lastMsg?.attachments?.length ? "Shared an attachment" : "No messages yet")}
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
