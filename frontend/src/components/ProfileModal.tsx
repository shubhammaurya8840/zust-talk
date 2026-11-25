import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { AVATAR_PRESETS, UserAvatar } from "../utils/avatars";
import { X, User, Check, Edit2, RotateCcw } from "lucide-react";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  const { user, updateUser } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl || null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && user) {
      setDisplayName(user.displayName || "");
      setBio(user.bio || "");
      setAvatarUrl(user.avatarUrl || null);
      setError(null);
      setSuccess(false);
    }
  }, [isOpen, user]);

  if (!isOpen || !user) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    try {
      setLoading(true);
      const res = await api.users.updateMe({
        displayName: displayName.trim() || undefined,
        bio: bio.trim() || null,
        avatarUrl,
      });
      if (res.success && res.user) {
        updateUser(res.user);
        setSuccess(true);
        setTimeout(() => {
          setSuccess(false);
          onClose();
        }, 900);
      }
    } catch (err: any) {
      setError(err.message || "Failed to update profile.");
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
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90dvh] animate-scaleIn"
      >
        <div className="shrink-0 p-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center space-x-2">
            <User className="w-4 h-4 text-emerald-600" />
            <span>My Profile & Avatar</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs rounded-xl">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs rounded-xl flex items-center space-x-2">
              <Check className="w-4 h-4" />
              <span>Profile saved!</span>
            </div>
          )}

          {/* Live Selected Avatar Preview */}
          <div className="text-center py-1">
            <UserAvatar
              name={displayName || user.displayName}
              username={user.username}
              avatarUrl={avatarUrl}
              size="xl"
              className="mx-auto ring-4 ring-emerald-500/20 rounded-3xl"
            />
            <p className="text-xs text-slate-400 mt-2">@{user.username}</p>
          </div>

          {/* Curated 24-Avatar Picker Grid */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Choose DP Avatar
              </label>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl(null)}
                  className="text-[11px] text-slate-400 hover:text-emerald-600 flex items-center space-x-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset to Initials</span>
                </button>
              )}
            </div>
            <div className="grid grid-cols-6 gap-2 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 max-h-44 overflow-y-auto">
              {AVATAR_PRESETS.map((av) => {
                const selected = avatarUrl === av.id;
                return (
                  <button
                    key={av.id}
                    type="button"
                    onClick={() => setAvatarUrl(av.id)}
                    title={av.label}
                    className={`aspect-square rounded-2xl bg-gradient-to-tr ${av.bg} flex items-center justify-center text-xl transition-transform hover:scale-105 ${
                      selected
                        ? "ring-3 ring-emerald-500 ring-offset-2 dark:ring-offset-slate-900 scale-105 shadow-md"
                        : "opacity-85 hover:opacity-100"
                    }`}
                  >
                    <span>{av.emoji}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your full name"
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
              About / Bio
            </label>
            <textarea
              rows={2}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Available, at work, in a meeting..."
              className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="pt-2 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl font-medium"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium disabled:opacity-50 transition-colors shadow-sm flex items-center space-x-1.5"
            >
              <Edit2 className="w-3.5 h-3.5" />
              <span>{loading ? "Saving..." : "Save Changes"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
