export function formatLastSeen(isOnline?: boolean, lastSeenAt?: string | null): string {
  if (isOnline) return "Online";
  if (!lastSeenAt) return "Offline";

  const date = new Date(lastSeenAt);
  if (Number.isNaN(date.getTime())) return "Offline";

  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return "Last seen just now";
  if (diffMins < 60) return `Last seen ${diffMins}m ago`;

  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const timeStr = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) {
    return `Last seen today at ${timeStr}`;
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return `Last seen yesterday at ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `Last seen ${dateStr} at ${timeStr}`;
}
