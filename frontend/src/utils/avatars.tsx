import React from "react";

export interface AvatarPreset {
  id: string;
  label: string;
  bg: string;
  accent: string;
  emoji: string;
}

// 24 distinct illustrated avatars — zero external CDN dependency
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "avatar:panda", label: "Panda", bg: "from-emerald-500 to-teal-600", accent: "#a7f3d0", emoji: "🐼" },
  { id: "avatar:tiger", label: "Bengal Tiger", bg: "from-orange-500 to-amber-600", accent: "#fde68a", emoji: "🐯" },
  { id: "avatar:fox", label: "Clever Fox", bg: "from-rose-500 to-orange-500", accent: "#fecdd3", emoji: "🦊" },
  { id: "avatar:lion", label: "Lion", bg: "from-amber-500 to-yellow-600", accent: "#fef08a", emoji: "🦁" },
  { id: "avatar:koala", label: "Koala", bg: "from-slate-500 to-slate-700", accent: "#e2e8f0", emoji: "🐨" },
  { id: "avatar:cat", label: "Cool Cat", bg: "from-pink-500 to-rose-600", accent: "#fbcfe8", emoji: "🐱" },
  { id: "avatar:dog", label: "Puppy", bg: "from-amber-600 to-orange-700", accent: "#fed7aa", emoji: "🐶" },
  { id: "avatar:owl", label: "Wise Owl", bg: "from-indigo-500 to-purple-600", accent: "#c7d2fe", emoji: "🦉" },
  { id: "avatar:unicorn", label: "Unicorn", bg: "from-fuchsia-500 to-violet-600", accent: "#f5d0fe", emoji: "🦄" },
  { id: "avatar:dragon", label: "Dragon", bg: "from-emerald-600 to-green-800", accent: "#bbf7d0", emoji: "🐲" },
  { id: "avatar:butterfly", label: "Butterfly", bg: "from-sky-400 to-indigo-500", accent: "#bae6fd", emoji: "🦋" },
  { id: "avatar:dolphin", label: "Dolphin", bg: "from-cyan-500 to-blue-600", accent: "#a5f3fc", emoji: "🐬" },
  { id: "avatar:astronaut", label: "Astronaut", bg: "from-slate-800 to-indigo-900", accent: "#c7d2fe", emoji: "🧑‍🚀" },
  { id: "avatar:ninja", label: "Ninja", bg: "from-zinc-700 to-zinc-900", accent: "#d4d4d8", emoji: "🥷" },
  { id: "avatar:wizard", label: "Wizard", bg: "from-violet-600 to-purple-800", accent: "#ddd6fe", emoji: "🧙" },
  { id: "avatar:artist", label: "Artist", bg: "from-pink-500 to-purple-600", accent: "#f5d0fe", emoji: "🧑‍🎨" },
  { id: "avatar:coder", label: "Developer", bg: "from-blue-600 to-cyan-600", accent: "#bae6fd", emoji: "🧑‍💻" },
  { id: "avatar:rockstar", label: "Music", bg: "from-red-500 to-pink-600", accent: "#fecdd3", emoji: "🧑‍🎤" },
  { id: "avatar:crown", label: "Royal", bg: "from-yellow-500 to-amber-600", accent: "#fef08a", emoji: "👑" },
  { id: "avatar:cricket", label: "Cricket", bg: "from-blue-600 to-indigo-700", accent: "#bfdbfe", emoji: "🏏" },
  { id: "avatar:chai", label: "Chai Lover", bg: "from-amber-700 to-orange-800", accent: "#fed7aa", emoji: "☕" },
  { id: "avatar:lotus", label: "Lotus", bg: "from-rose-400 to-pink-600", accent: "#fbcfe8", emoji: "🪷" },
  { id: "avatar:fire", label: "Spark", bg: "from-orange-500 to-red-600", accent: "#fecaca", emoji: "🔥" },
  { id: "avatar:robot", label: "AI Bot", bg: "from-teal-500 to-cyan-700", accent: "#99f6e4", emoji: "🤖" },
];

const AVATAR_MAP = new Map(AVATAR_PRESETS.map((a) => [a.id, a]));

export function getAvatarPreset(avatarUrl?: string | null): AvatarPreset | undefined {
  if (!avatarUrl) return undefined;
  return AVATAR_MAP.get(avatarUrl);
}

interface UserAvatarProps {
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  isOnline?: boolean;
  showOnlineDot?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps["size"]>, { box: string; emoji: string; text: string; dot: string }> = {
  xs: { box: "w-7 h-7 rounded-xl", emoji: "text-sm", text: "text-xs", dot: "w-2 h-2" },
  sm: { box: "w-9 h-9 rounded-xl", emoji: "text-base", text: "text-xs", dot: "w-2.5 h-2.5" },
  md: { box: "w-11 h-11 rounded-2xl", emoji: "text-xl", text: "text-sm", dot: "w-3 h-3" },
  lg: { box: "w-16 h-16 rounded-2xl", emoji: "text-3xl", text: "text-xl", dot: "w-3.5 h-3.5" },
  xl: { box: "w-20 h-20 rounded-3xl", emoji: "text-4xl", text: "text-2xl", dot: "w-4 h-4" },
};

export const UserAvatar: React.FC<UserAvatarProps> = ({
  name,
  username,
  avatarUrl,
  size = "md",
  isOnline = false,
  showOnlineDot = false,
  className = "",
}) => {
  const s = SIZE_CLASSES[size];
  const preset = getAvatarPreset(avatarUrl);
  const isHttpImage = Boolean(avatarUrl && (avatarUrl.startsWith("http") || avatarUrl.startsWith("data:image")));
  const initial = (name?.[0] || username?.[0] || "U").toUpperCase();

  return (
    <div className={`relative shrink-0 inline-flex ${className}`}>
      {preset ? (
        <div
          className={`${s.box} bg-gradient-to-tr ${preset.bg} flex items-center justify-center shadow-sm select-none ring-1 ring-black/5`}
        >
          <span className={`${s.emoji} leading-none`} role="img" aria-label={preset.label}>
            {preset.emoji}
          </span>
        </div>
      ) : isHttpImage ? (
        <img
          src={avatarUrl!}
          alt={name || username || "User"}
          className={`${s.box} object-cover shadow-sm`}
        />
      ) : (
        <div
          className={`${s.box} bg-gradient-to-tr from-emerald-500 to-teal-600 text-white flex items-center justify-center font-bold ${s.text} shadow-sm`}
        >
          {initial}
        </div>
      )}

      {showOnlineDot && isOnline && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 ${s.dot} rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900`}
        />
      )}
    </div>
  );
};
