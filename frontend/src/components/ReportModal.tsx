import React, { useState } from "react";
import { api } from "../api/client";
import { X, AlertTriangle, ShieldAlert, Check } from "lucide-react";

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  userName: string;
}

export const ReportModal: React.FC<ReportModalProps> = ({ isOpen, onClose, userId, userName }) => {
  const [reason, setReason] = useState("Spam or unwanted messages");
  const [details, setDetails] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const reasons = [
    "Spam or unwanted messages",
    "Harassment or abusive behavior",
    "Impersonation or fake account",
    "Inappropriate media or content",
    "Suspected scam or fraud",
    "Other violation",
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      await api.users.report(userId, reason, details.trim() || undefined);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1800);
    } catch (err: any) {
      setError(err.message || "Failed to submit report");
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
        className="bg-white dark:bg-slate-900 rounded-3xl w-full max-w-md shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-scaleIn"
      >
        <div className="p-4 bg-red-50 dark:bg-red-950/40 border-b border-red-100 dark:border-red-900 flex items-center justify-between text-red-900 dark:text-red-300">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            <h3 className="text-sm font-bold">Report User: {userName}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {success ? (
          <div className="p-8 text-center space-y-3">
            <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <Check className="w-6 h-6" />
            </div>
            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-base">Report Submitted</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Thank you for keeping our community safe. Our moderation team has logged this incident.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs rounded-xl">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Reason for Reporting
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
              >
                {reasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Additional Details (Optional)
              </label>
              <textarea
                rows={3}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Describe what occurred..."
                className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl text-[11px] text-slate-500 dark:text-slate-400 flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <span>
                Reports are treated confidentially. You may also block this user to prevent future communications.
              </span>
            </div>

            <div className="pt-2 flex justify-end space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2 text-xs bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium disabled:opacity-50 transition-colors shadow-sm"
              >
                {loading ? "Submitting..." : "Submit Report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
