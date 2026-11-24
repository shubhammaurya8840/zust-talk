import React, { useState } from "react";
import { User } from "../types";
import { X, Copy, Check, QrCode, Share2 } from "lucide-react";

interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

export const InviteModal: React.FC<InviteModalProps> = ({ isOpen, onClose, user }) => {
  const [copied, setCopied] = useState(false);
  if (!isOpen) return null;

  const inviteUrl = `${window.location.origin}/chat/@${user.username}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-slate-100 overflow-hidden text-center p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold text-slate-800 flex items-center space-x-1.5">
            <QrCode className="w-4 h-4 text-emerald-600" />
            <span>My QR Code & Invite</span>
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR Code SVG Visual */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 mx-auto w-48 h-48 flex flex-col items-center justify-center shadow-inner mb-4 relative">
          <svg className="w-36 h-36 text-slate-800" viewBox="0 0 100 100" fill="currentColor">
            {/* Standard stylized QR pattern */}
            <rect x="10" y="10" width="24" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="6" />
            <rect x="17" y="17" width="10" height="10" rx="2" fill="currentColor" />
            <rect x="66" y="10" width="24" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="6" />
            <rect x="73" y="17" width="10" height="10" rx="2" fill="currentColor" />
            <rect x="10" y="66" width="24" height="24" rx="4" fill="none" stroke="currentColor" strokeWidth="6" />
            <rect x="17" y="73" width="10" height="10" rx="2" fill="currentColor" />
            <rect x="42" y="12" width="16" height="6" rx="1" fill="currentColor" />
            <rect x="42" y="24" width="8" height="8" rx="1" fill="currentColor" />
            <rect x="54" y="24" width="6" height="16" rx="1" fill="currentColor" />
            <rect x="12" y="42" width="6" height="16" rx="1" fill="currentColor" />
            <rect x="24" y="42" width="16" height="8" rx="1" fill="currentColor" />
            <rect x="44" y="44" width="12" height="12" rx="2" fill="#059669" />
            <rect x="66" y="42" width="12" height="8" rx="1" fill="currentColor" />
            <rect x="82" y="42" width="8" height="16" rx="1" fill="currentColor" />
            <rect x="42" y="66" width="8" height="16" rx="1" fill="currentColor" />
            <rect x="54" y="66" width="16" height="8" rx="1" fill="currentColor" />
            <rect x="74" y="66" width="16" height="16" rx="2" fill="currentColor" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs font-bold border-2 border-white shadow">
              {user.displayName?.[0]?.toUpperCase() || user.username[0].toUpperCase()}
            </div>
          </div>
        </div>

        <h4 className="font-bold text-slate-800 text-base">{user.displayName}</h4>
        <p className="text-xs text-slate-400 mb-4">@{user.username}</p>

        {/* Copy Link Input */}
        <div className="flex items-center space-x-1.5 p-1.5 bg-slate-100 rounded-xl border border-slate-200 text-xs">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            className="bg-transparent flex-1 px-2 text-slate-600 outline-none select-all truncate text-[11px]"
          />
          <button
            onClick={handleCopy}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center space-x-1 shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>

        <p className="text-[11px] text-slate-400 mt-3">
          Share this link or QR with friends in India to chat with you directly.
        </p>
      </div>
    </div>
  );
};
