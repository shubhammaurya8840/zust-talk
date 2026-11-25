import React, { useState } from "react";
import { NearbyUser } from "../types";
import { UserAvatar } from "../utils/avatars";
import { formatLastSeen } from "../utils/presence";
import { X, AtSign, MapPin, Users, UserPlus, Check, MessageSquare, Clock, Ban } from "lucide-react";

interface NearbyProfileModalProps {
  user: NearbyUser | null;
  onClose: () => void;
  onConnect: (userId: string, message?: string) => Promise<void>;
  onAcceptRequest: (requestId: string) => Promise<void>;
  onRejectRequest: (requestId: string) => Promise<void>;
  onCancelRequest: (requestId: string) => Promise<void>;
  onOpenChat: (userId: string, conversationId?: string) => Promise<void>;
}

export const NearbyProfileModal: React.FC<NearbyProfileModalProps> = ({
  user,
  onClose,
  onConnect,
  onAcceptRequest,
  onRejectRequest,
  onCancelRequest,
  onOpenChat,
}) => {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const statusText = formatLastSeen(user.isOnline, user.lastSeenAt);

  const runAction = async (fn: () => Promise<void>) => {
    try {
      setBusy(true);
      setError(null);
      await fn();
    } catch (err: any) {
      setError(err.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-sm animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-scaleIn"
      >
        {/* Header */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-emerald-600 dark:text-emerald-400 text-xs font-bold">
            <MapPin className="w-4 h-4" />
            <span>~{user.distanceMeters}m away</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div className="flex flex-col items-center text-center">
            <UserAvatar
              name={user.displayName}
              username={user.username}
              avatarUrl={user.avatarUrl}
              size="xl"
              isOnline={user.isOnline}
              showOnlineDot
            />
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-3">
              {user.displayName || user.username}
            </h3>
            <p className="text-xs text-slate-400 flex items-center space-x-1 mt-0.5">
              <AtSign className="w-3 h-3" />
              <span>{user.username}</span>
            </p>
            <span
              className={`mt-2 px-3 py-0.5 rounded-full text-[11px] font-semibold ${
                user.isOnline
                  ? "bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
              }`}
            >
              {statusText}
            </span>
          </div>

          {user.bio && (
            <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-200 text-center">
              {user.bio}
            </div>
          )}

          {user.commonGroups && user.commonGroups.length > 0 && (
            <div className="bg-indigo-50/70 dark:bg-indigo-950/30 p-3 rounded-2xl border border-indigo-100 dark:border-indigo-900/50">
              <p className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 flex items-center space-x-1.5 mb-1.5">
                <Users className="w-3.5 h-3.5" />
                <span>
                  {user.commonGroups.length} Common{" "}
                  {user.commonGroups.length === 1 ? "Group" : "Groups"}
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {user.commonGroups.map((g) => (
                  <span
                    key={g.id}
                    className="px-2 py-0.5 rounded-full bg-white dark:bg-slate-800 text-[11px] font-medium text-indigo-700 dark:text-indigo-200 border border-indigo-200/70 dark:border-indigo-800"
                  >
                    {g.title}
                  </span>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs">
              {error}
            </div>
          )}

          {/* Connection Controls */}
          {user.connectionStatus === "CONNECTED" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction(() => onOpenChat(user.id, user.conversationId))}
              className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-2xl text-sm font-bold flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/25 disabled:opacity-50"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Message</span>
            </button>
          ) : user.connectionStatus === "PENDING_SENT" ? (
            <div className="space-y-2">
              <div className="w-full py-2.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-2xl text-xs font-bold flex items-center justify-center space-x-1.5">
                <Clock className="w-4 h-4" />
                <span>Connection Request Sent</span>
              </div>
              {user.requestId && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => runAction(() => onCancelRequest(user.requestId!))}
                  className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-red-600"
                >
                  Cancel Request
                </button>
              )}
            </div>
          ) : user.connectionStatus === "PENDING_RECEIVED" && user.requestId ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(() => onRejectRequest(user.requestId!))}
                className="py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-red-50 text-slate-700 dark:text-slate-200 hover:text-red-600 rounded-2xl text-xs font-bold"
              >
                Decline
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(() => onAcceptRequest(user.requestId!))}
                className="py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-xs font-bold flex items-center justify-center space-x-1 shadow-md"
              >
                <Check className="w-4 h-4" />
                <span>Accept</span>
              </button>
            </div>
          ) : user.connectionStatus === "REJECTED" ? (
            <div className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-2xl text-xs font-semibold flex items-center justify-center space-x-1.5">
              <Ban className="w-4 h-4" />
              <span>Request Declined</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={150}
                placeholder="Optional greeting (e.g. Hey, nearby!)"
                className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(() => onConnect(user.id, note.trim() || undefined))}
                className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-2xl text-sm font-bold flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/25 disabled:opacity-50"
              >
                <UserPlus className="w-4 h-4" />
                <span>{busy ? "Sending..." : "Connect"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
