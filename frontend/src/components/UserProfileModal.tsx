import React, { useEffect, useState } from "react";
import { User } from "../types";
import { api } from "../api/client";
import { useSocket } from "../context/SocketContext";
import { UserAvatar } from "../utils/avatars";
import { formatLastSeen } from "../utils/presence";
import { X, AtSign, Phone, Mail, Calendar, MessageSquare, PhoneCall, Video } from "lucide-react";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onStartCall?: (isVideo: boolean) => void;
  onMessageUser?: (userId: string) => void;
}

export const UserProfileModal: React.FC<UserProfileModalProps> = ({
  isOpen,
  onClose,
  user: initialUser,
  onStartCall,
  onMessageUser,
}) => {
  const { presenceMap } = useSocket();
  const [profile, setProfile] = useState<User | null>(initialUser);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !initialUser?.id) return;
    setProfile(initialUser);
    setLoading(true);
    api.users
      .getProfile(initialUser.id)
      .then((res) => {
        if (res.success && res.user) {
          setProfile(res.user);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, initialUser?.id]);

  if (!isOpen || !profile) return null;

  const livePresence = presenceMap[profile.id];
  const isOnline = livePresence ? livePresence.isOnline : Boolean(profile.isOnline);
  const lastSeenAt = livePresence?.lastSeenAt ?? profile.lastSeenAt;
  const statusText = formatLastSeen(isOnline, lastSeenAt);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-scaleIn"
      >
        <div className="p-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Contact Info</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex flex-col items-center text-center">
            <UserAvatar
              name={profile.displayName}
              username={profile.username}
              avatarUrl={profile.avatarUrl}
              size="xl"
              isOnline={isOnline}
              showOnlineDot
            />
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-3">
              {profile.displayName || profile.username}
            </h3>
            <p className="text-xs text-slate-400 flex items-center space-x-1 mt-0.5">
              <AtSign className="w-3 h-3" />
              <span>{profile.username}</span>
            </p>
            <span
              className={`mt-2 px-3 py-0.5 rounded-full text-[11px] font-semibold ${
                isOnline
                  ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              }`}
            >
              {statusText}
            </span>
          </div>

          {/* Quick Actions */}
          {(onStartCall || onMessageUser) && (
            <div className="grid grid-cols-3 gap-2">
              {onMessageUser && (
                <button
                  type="button"
                  onClick={() => {
                    onMessageUser(profile.id);
                    onClose();
                  }}
                  className="py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-slate-700 dark:text-slate-200 hover:text-emerald-600 flex flex-col items-center space-y-1 text-[11px] font-semibold transition-colors"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Message</span>
                </button>
              )}
              {onStartCall && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onStartCall(false);
                    }}
                    className="py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 text-slate-700 dark:text-slate-200 hover:text-emerald-600 flex flex-col items-center space-y-1 text-[11px] font-semibold transition-colors"
                  >
                    <PhoneCall className="w-4 h-4" />
                    <span>Audio</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onStartCall(true);
                    }}
                    className="py-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 flex flex-col items-center space-y-1 text-[11px] font-semibold transition-colors"
                  >
                    <Video className="w-4 h-4" />
                    <span>Video</span>
                  </button>
                </>
              )}
            </div>
          )}

          {/* Read-Only Info Fields */}
          <div className="space-y-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                About / Bio
              </span>
              <p className="text-slate-700 dark:text-slate-200 mt-0.5 leading-relaxed">
                {loading && !profile.bio ? "Loading..." : profile.bio || "Hey there! Using Zust Talk."}
              </p>
            </div>

            {profile.phone && (
              <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-200/70 dark:border-slate-700">
                <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{profile.phone}</span>
              </div>
            )}

            {profile.email && (
              <div className="flex items-center space-x-2 text-slate-600 dark:text-slate-300 pt-2 border-t border-slate-200/70 dark:border-slate-700">
                <Mail className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="truncate">{profile.email}</span>
              </div>
            )}

            {profile.createdAt && (
              <div className="flex items-center space-x-2 text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200/70 dark:border-slate-700">
                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Joined {new Date(profile.createdAt).toLocaleDateString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
