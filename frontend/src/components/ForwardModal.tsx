import React, { useState } from "react";
import { Conversation, Message } from "../types";
import { X, Send, Forward } from "lucide-react";

interface ForwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  message: Message | null;
  conversations: Conversation[];
  onForward: (targetConversationId: string, messageText?: string) => Promise<void>;
}

export const ForwardModal: React.FC<ForwardModalProps> = ({
  isOpen,
  onClose,
  message,
  conversations,
  onForward,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen || !message) return null;

  const handleSendForward = async () => {
    if (!selectedId) return;
    try {
      setLoading(true);
      await onForward(selectedId, message.body || "[Forwarded attachment]");
      onClose();
    } catch {
      alert("Failed to forward message");
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
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[75dvh] animate-scaleIn"
      >
        <div className="p-4 bg-slate-50 dark:bg-slate-800/70 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Forward className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Forward Message</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 italic truncate">
          "{message.body || "Attachment"}"
        </div>

        <div className="p-3 overflow-y-auto flex-1 space-y-1">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
            Select Destination Chat
          </span>
          {conversations.map((c) => {
            const isSelected = selectedId === c.id;
            return (
              <div
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`p-2.5 rounded-xl cursor-pointer flex items-center justify-between text-xs transition-colors ${
                  isSelected
                    ? "bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 font-semibold"
                    : "hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                }`}
              >
                <span className="truncate">{c.title || "Direct Chat"}</span>
                {isSelected && <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Selected</span>}
              </div>
            );
          })}
        </div>

        <div className="p-3 bg-slate-50 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-800 flex justify-end space-x-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSendForward}
            disabled={!selectedId || loading}
            className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold disabled:opacity-50 flex items-center space-x-1"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Forward</span>
          </button>
        </div>
      </div>
    </div>
  );
};
