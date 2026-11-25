import React, { useState } from "react";
import { User } from "../types";
import { api } from "../api/client";
import { UserAvatar } from "../utils/avatars";
import { X, Search, UserCheck, Users, MessageSquare } from "lucide-react";

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConversationCreated: (conversationId: string) => void;
}

export const NewChatModal: React.FC<NewChatModalProps> = ({ isOpen, onClose, onConversationCreated }) => {
  const [tab, setTab] = useState<"DIRECT" | "GROUP">("DIRECT");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSearch = async (val: string) => {
    setQuery(val);
    setError(null);
    if (val.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      setLoading(true);
      const res = await api.users.search(val.trim());
      setSearchResults(res.users);
    } catch (err: any) {
      setError(err.message || "Failed to search users.");
    } finally {
      setLoading(false);
    }
  };

  const handleStartDirectChat = async (userId: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.conversations.createDirect(userId);
      onConversationCreated(res.conversation.id);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to start direct conversation.");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelectUser = (user: User) => {
    if (selectedUsers.some((u) => u.id === user.id)) {
      setSelectedUsers(selectedUsers.filter((u) => u.id !== user.id));
    } else {
      setSelectedUsers([...selectedUsers, user]);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupTitle.trim()) {
      setError("Please provide a group title.");
      return;
    }
    if (selectedUsers.length === 0) {
      setError("Please select at least 1 member for the group.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const res = await api.conversations.createGroup(
        groupTitle.trim(),
        selectedUsers.map((u) => u.id)
      );
      onConversationCreated(res.conversation.id);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create group.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85dvh] animate-scaleIn"
      >
        <div className="p-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => { setTab("DIRECT"); setError(null); }}
              className={`text-xs px-3.5 py-2 rounded-xl font-bold transition-colors flex items-center space-x-1.5 ${
                tab === "DIRECT"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Direct Chat</span>
            </button>
            <button
              type="button"
              onClick={() => { setTab("GROUP"); setError(null); }}
              className={`text-xs px-3.5 py-2 rounded-xl font-bold transition-colors flex items-center space-x-1.5 ${
                tab === "GROUP"
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              <Users className="w-4 h-4" />
              <span>New Group</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs rounded-xl">
              {error}
            </div>
          )}

          {tab === "GROUP" && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                Group Title
              </label>
              <input
                type="text"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="e.g. Project Bharat, Weekend Cricket..."
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selectedUsers.map((u) => (
                    <span
                      key={u.id}
                      onClick={() => toggleSelectUser(u)}
                      className="inline-flex items-center space-x-1 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                    >
                      <span>{u.displayName || u.username}</span>
                      <X className="w-3 h-3" />
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Search by name, username or mobile number
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={query}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Type name, username or mobile..."
                className="w-full pl-9 pr-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
                autoFocus
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading && <p className="text-xs text-slate-400 py-3 text-center">Searching...</p>}
            {!loading && searchResults.length === 0 && query.length >= 2 && (
              <p className="text-xs text-slate-400 py-3 text-center">No users found</p>
            )}
            {searchResults.map((u) => {
              const isSelected = selectedUsers.some((sel) => sel.id === u.id);
              return (
                <div
                  key={u.id}
                  onClick={() => {
                    if (tab === "DIRECT") handleStartDirectChat(u.id);
                    else toggleSelectUser(u);
                  }}
                  className="py-2.5 px-2 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 rounded-xl cursor-pointer transition-colors"
                >
                  <div className="flex items-center space-x-3">
                    <UserAvatar
                      name={u.displayName}
                      username={u.username}
                      avatarUrl={u.avatarUrl}
                      size="sm"
                      isOnline={u.isOnline}
                      showOnlineDot
                    />
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{u.displayName}</p>
                      <div className="flex items-center space-x-2 text-xs text-slate-400">
                        <span>@{u.username}</span>
                        {u.phone && <span className="font-mono text-emerald-600 dark:text-emerald-400 font-medium">{u.phone}</span>}
                      </div>
                    </div>
                  </div>

                  {tab === "DIRECT" ? (
                    <button
                      type="button"
                      className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Chat
                    </button>
                  ) : (
                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                        isSelected ? "bg-emerald-600 border-emerald-600 text-white" : "border-slate-300 dark:border-slate-600"
                      }`}
                    >
                      {isSelected && <UserCheck className="w-3.5 h-3.5" />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {tab === "GROUP" && (
          <div className="p-4 bg-slate-50 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-800 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateGroup}
              disabled={loading || !groupTitle.trim() || selectedUsers.length === 0}
              className="px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium disabled:opacity-50 transition-colors shadow-sm"
            >
              Create Group ({selectedUsers.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
