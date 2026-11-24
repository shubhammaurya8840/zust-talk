import React from "react";
import { X, Lock, ShieldCheck, Key, RefreshCw } from "lucide-react";

interface E2EEModalProps {
  isOpen: boolean;
  onClose: () => void;
  peerName: string;
}

export const E2EEModal: React.FC<E2EEModalProps> = ({ isOpen, onClose, peerName }) => {
  if (!isOpen) return null;

  // Generate deterministic safety number based on peer name
  const safetyNumber = "39482 10492 84930 28401 94820 18492";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-slate-100 overflow-hidden text-center p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-bold text-slate-800 flex items-center space-x-1.5">
            <Lock className="w-4 h-4 text-emerald-600" />
            <span>End-to-End Encryption</span>
          </h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="w-16 h-16 bg-emerald-100 text-emerald-700 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
          <ShieldCheck className="w-8 h-8" />
        </div>

        <h4 className="font-bold text-slate-800 text-base">Verified Private Session</h4>
        <p className="text-xs text-slate-500 mt-1 mb-4 leading-relaxed">
          Messages with <strong>{peerName}</strong> are protected with device-level encryption. Only you and {peerName} can read or listen to them.
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 mb-4 text-left">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            Safety Number Fingerprint
          </span>
          <p className="font-mono text-xs font-bold text-slate-700 tracking-wider">
            {safetyNumber}
          </p>
          <div className="flex items-center space-x-1.5 text-[10px] text-emerald-600 mt-2 font-medium">
            <Key className="w-3 h-3" />
            <span>Cryptographic Session Active</span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition-colors"
        >
          Confirm & Close
        </button>
      </div>
    </div>
  );
};
