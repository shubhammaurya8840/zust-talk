import React, { useState } from "react";
import { Conversation, User } from "../types";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { UserAvatar } from "../utils/avatars";
import { X, Users, UserPlus, Trash2, LogOut, ShieldCheck, Crown, Edit2, Check } from "lucide-react";

interface GroupInfoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: Conversation;
  onUpdate: () => void;
  onViewMember?: (memberUser: User) => void;
}

export const GroupInfoDrawer: React.FC<GroupInfoDrawerProps> = ({
  isOpen,
  onClose,
  conversation,
  onUpdate,
  onViewMember,
}) => {
  const { user } = useAuth();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState(conversation.title || "");
  const [showAddMember, setShowAddMember] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const myMember = conversation.members.find((m) => m.userId === user?.id);
  const canManage = myMember?.role === "OWNER" || myMember?.role === "ADMIN";

  const handleUpdateTitle = async () => {
    if (!newTitle.trim()) return;
    try {
      setLoading(true);
      await api.conversations.updateGroup(conversation.id, newTitle.trim());
      setIsEditingTitle(false);
      onUpdate();
    } catch (err: any) {
      setError(err.message || "Failed to update title");
    } finally {
      setLoading(false);
    }
  };

  const handleSearchUsers = async (q: string) => {
    setSearchQuery(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await api.users.search(q.trim());
      const existingIds = new Set(conversation.members.map((m) => m.userId));
      setSearchResults(res.users.filter((u) => !existingIds.has(u.id)));
    } catch {
      // Ignore
    }
  };

  const handleAddMember = async (userId: string) => {
    try {
      setLoading(true);
      await api.conversations.addMember(conversation.id, userId);
      setShowAddMember(false);
      setSearchQuery("");
      setSearchResults([]);
      onUpdate();
    } catch (err: any) {
      setError(err.message || "Failed to add member");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm("Are you sure you want to remove this member?")) return;
    try {
      setLoading(true);
      await api.conversations.removeMember(conversation.id, userId);
      onUpdate();
    } catch (err: any) {
      setError(err.message || "Failed to remove member");
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveGroup = async () => {
    if (!user) return;
    if (!confirm("Are you sure you want to leave this group?")) return;
    try {
      setLoading(true);
      await api.conversations.removeMember(conversation.id, user.id);
      onClose();
      onUpdate();
    } catch (err: any) {
      setError(err.message || "Failed to leave group");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40 backdrop-blur-[2px] animate-fadeIn" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-96 h-full bg-white dark:bg-slate-900 shadow-2xl border-l border-slate-200 dark:border-slate-800 flex flex-col"
      >
        <div className="p-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center space-x-2">
            <Users className="w-4 h-4 text-emerald-600" />
            <span>Group Information</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs rounded-xl">
              {error}
            </div>
          )}

          <div className="text-center pb-4 border-b border-slate-100 dark:border-slate-800">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-2xl mx-auto shadow-md">
              <Users className="w-10 h-10" />
            </div>

            <div className="mt-3 flex items-center justify-center space-x-2">
              {isEditingTitle ? (
                <div className="flex items-center space-x-1">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="px-2.5 py-1 text-sm border border-emerald-500 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-lg focus:outline-none"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={handleUpdateTitle}
                    disabled={loading}
                    className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingTitle(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">{conversation.title}</h2>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => setIsEditingTitle(true)}
                      className="p-1 text-slate-400 hover:text-emerald-600"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">{conversation.members.length} participants</p>
          </div>

          {canManage && (
            <div>
              {!showAddMember ? (
                <button
                  type="button"
                  onClick={() => setShowAddMember(true)}
                  className="w-full py-2.5 px-3 bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 dark:hover:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-semibold flex items-center justify-center space-x-2 transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Add Participant</span>
                </button>
              ) : (
                <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Add Member</span>
                    <button
                      type="button"
                      onClick={() => { setShowAddMember(false); setSearchResults([]); }}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Cancel
                    </button>
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchUsers(e.target.value)}
                    placeholder="Search user..."
                    className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    autoFocus
                  />
                  <div className="divide-y divide-slate-100 dark:divide-slate-700 max-h-40 overflow-y-auto">
                    {searchResults.map((su) => (
                      <div
                        key={su.id}
                        onClick={() => handleAddMember(su.id)}
                        className="py-1.5 flex items-center justify-between cursor-pointer hover:bg-white dark:hover:bg-slate-700 px-2 rounded-lg"
                      >
                        <span className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">
                          {su.displayName} (@{su.username})
                        </span>
                        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">+ Add</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
              Members ({conversation.members.length})
            </h4>
            <div className="space-y-2">
              {conversation.members.map((m) => {
                const isMe = m.userId === user?.id;
                return (
                  <div key={m.id} className="flex items-center justify-between py-1.5">
                    <div
                      onClick={() => m.user && !isMe && onViewMember?.(m.user)}
                      className={`flex items-center space-x-2.5 ${!isMe && m.user && onViewMember ? "cursor-pointer hover:opacity-80" : ""}`}
                    >
                      <UserAvatar
                        name={m.user?.displayName}
                        username={m.user?.username}
                        avatarUrl={m.user?.avatarUrl}
                        size="sm"
                        isOnline={m.user?.isOnline}
                        showOnlineDot
                      />
                      <div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                          {m.user?.displayName || m.user?.username} {isMe && "(You)"}
                        </p>
                        <div className="flex items-center space-x-1 mt-0.5">
                          {m.role === "OWNER" && (
                            <span className="inline-flex items-center text-[10px] bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-1.5 py-0.2 rounded-full font-semibold">
                              <Crown className="w-2.5 h-2.5 mr-0.5" /> Owner
                            </span>
                          )}
                          {m.role === "ADMIN" && (
                            <span className="inline-flex items-center text-[10px] bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.2 rounded-full font-semibold">
                              <ShieldCheck className="w-2.5 h-2.5 mr-0.5" /> Admin
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {canManage && !isMe && m.role !== "OWNER" && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m.userId)}
                        title="Remove participant"
                        className="p-1.5 text-slate-300 hover:text-red-600 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={handleLeaveGroup}
              disabled={loading}
              className="w-full py-2.5 px-4 text-red-600 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/60 rounded-xl text-xs font-semibold flex items-center justify-center space-x-2 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Exit / Leave Group</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
