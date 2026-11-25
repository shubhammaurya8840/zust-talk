import React from "react";
import { X, Lock, ShieldCheck, Key } from "lucide-react";

interface E2EEModalProps {
  isOpen: boolean;
  onClose: () => void;
  peerName: string;
}

export const E2EEModal: React.FC<E2EEModalProps> = ({ isOpen, onClose, peerName }) => {
  if (!isOpen) return null;

  const safetyNumber = "39482 10492 84930 28401 94820 18492";

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-center p-6 animate-scaleIn"
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center space-x-1.5">
            <Lock className="w-4 h-4 text-emerald-600" />
            <span>End-to-End Encryption</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
          <ShieldCheck className="w-8 h-8" />
        </div>

        <h4 className="font-bold text-slate-800 dark:text-slate-100 text-base">Verified Private Session</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4 leading-relaxed">
          Messages with <strong>{peerName}</strong> are protected with device-level encryption. Only you and {peerName} can read or listen to them.
        </p>

        <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-3.5 mb-4 text-left">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            Safety Number Fingerprint
          </span>
          <p className="font-mono text-xs font-bold text-slate-700 dark:text-slate-200 tracking-wider">
            {safetyNumber}
          </p>
          <div className="flex items-center space-x-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 mt-2 font-medium">
            <Key className="w-3 h-3" />
            <span>Cryptographic Session Active</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors"
        >
          Confirm & Close
        </button>
      </div>
    </div>
  );
};
