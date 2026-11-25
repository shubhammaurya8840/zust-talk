import React, { useEffect, useState } from "react";
import { SocialLinks, User } from "../types";
import { api } from "../api/client";
import { useSocket } from "../context/SocketContext";
import { UserAvatar } from "../utils/avatars";
import { formatLastSeen } from "../utils/presence";
import { TARGET_LANGUAGES } from "../utils/translate";
import {
  X,
  AtSign,
  Phone,
  Mail,
  Calendar,
  MessageSquare,
  PhoneCall,
  Video,
  Languages,
  ExternalLink,
} from "lucide-react";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onStartCall?: (isVideo: boolean) => void;
  onMessageUser?: (userId: string) => void;
}

function normalizeSocialUrl(platform: keyof SocialLinks, raw: string): string {
  const val = raw.trim();
  if (val.startsWith("http://") || val.startsWith("https://")) return val;
  const clean = val.replace(/^@/, "");
  if (platform === "instagram") return `https://instagram.com/${clean}`;
  if (platform === "twitter") return `https://x.com/${clean}`;
  if (platform === "linkedin") return `https://linkedin.com/in/${clean}`;
  if (platform === "youtube") return `https://youtube.com/@${clean}`;
  if (platform === "github") return `https://github.com/${clean}`;
  return `https://${val}`;
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

  const primaryLangLabel =
    TARGET_LANGUAGES.find((l) => l.code === (profile.primaryLanguage || "en"))?.short ||
    profile.primaryLanguage ||
    "English";

  const socialEntries = profile.socialLinks
    ? (
        [
          { key: "instagram", label: "Instagram" },
          { key: "twitter", label: "X / Twitter" },
          { key: "linkedin", label: "LinkedIn" },
          { key: "youtube", label: "YouTube" },
          { key: "github", label: "GitHub" },
          { key: "website", label: "Website" },
        ] as const
      ).filter((item) => Boolean(profile.socialLinks?.[item.key]?.trim()))
    : [];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[90dvh] animate-scaleIn"
      >
        <div className="shrink-0 p-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Contact Info</span>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
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
            <div className="flex items-center flex-wrap justify-center gap-1.5 mt-2">
              <span
                className={`px-3 py-0.5 rounded-full text-[11px] font-semibold ${
                  isOnline
                    ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                }`}
              >
                {statusText}
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold flex items-center space-x-1">
                <Languages className="w-3 h-3" />
                <span>{primaryLangLabel}</span>
              </span>
            </div>
          </div>

          {(onStartCall || onMessageUser) && (
            <div className="grid grid-cols-3 gap-2">
              {onMessageUser && (
                <button
                  type="button"
                  onClick={() => {
                    onMessageUser(profile.id);
                    onClose();
                  }}
                  className="py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 text-slate-700 dark:text-slate-200 hover:text-emerald-600 flex flex-col items-center space-y-1 text-[11px] font-semibold"
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
                    className="py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 text-slate-700 dark:text-slate-200 hover:text-emerald-600 flex flex-col items-center space-y-1 text-[11px] font-semibold"
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
                    className="py-2.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 flex flex-col items-center space-y-1 text-[11px] font-semibold"
                  >
                    <Video className="w-4 h-4" />
                    <span>Video</span>
                  </button>
                </>
              )}
            </div>
          )}

          {/* Read-Only Bio, Contact & Social Links */}
          <div className="space-y-3 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                About / Bio
              </span>
              <p className="text-slate-700 dark:text-slate-200 mt-0.5 leading-relaxed">
                {loading && !profile.bio ? "Loading..." : profile.bio || "Hey there!"}
              </p>
            </div>

            {socialEntries.length > 0 && (
              <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Social Links
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {socialEntries.map((item) => {
                    const href = normalizeSocialUrl(item.key, profile.socialLinks![item.key]!);
                    return (
                      <a
                        key={item.key}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                      >
                        <span>{item.label}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

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
