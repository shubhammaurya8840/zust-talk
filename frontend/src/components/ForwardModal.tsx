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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[70vh]">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Forward className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">Forward Message</h3>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-slate-100 border-b border-slate-200 text-xs text-slate-600 italic truncate">
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
                  isSelected ? "bg-emerald-50 border border-emerald-300 text-emerald-900 font-semibold" : "hover:bg-slate-50 text-slate-700"
                }`}
              >
                <span className="truncate">{c.title || "Direct Chat"}</span>
                {isSelected && <span className="text-[10px] font-bold text-emerald-600">Selected</span>}
              </div>
            );
          })}
        </div>

        <div className="p-3 bg-slate-50 border-t border-slate-200 flex justify-end space-x-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSendForward}
            disabled={!selectedId || loading}
            className="px-4 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center space-x-1"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Forward</span>
          </button>
        </div>
      </div>
    </div>
  );
};
