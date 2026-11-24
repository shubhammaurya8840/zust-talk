import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { Language, translations } from "../utils/i18n";
import {
  MessageSquare,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  UserX,
  AlertCircle,
  Check,
  UserCheck,
} from "lucide-react";

interface AuthScreenProps {
  lang: Language;
  onToggleLang: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ lang, onToggleLang }) => {
  const { login } = useAuth();
  const [destination, setDestination] = useState("");
  const [step, setStep] = useState<"REQUEST" | "VERIFY">("REQUEST");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);

  // Existing user vs new user registration
  const [userExists, setUserExists] = useState<boolean | null>(null);
  const [existingDisplayName, setExistingDisplayName] = useState<string | null>(null);

  // Registration fields
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"IDLE" | "CHECKING" | "AVAILABLE" | "TAKEN">("IDLE");
  const checkTimeoutRef = useRef<any>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = translations[lang];

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!destination.trim() || destination.length < 5) {
      setError("Please enter a valid phone number (e.g. +919876543210) or email address.");
      return;
    }

    try {
      setLoading(true);
      const res = await api.auth.requestOtp(destination.trim());
      if (res.devOtp) {
        setDevOtp(res.devOtp);
      }
      setUserExists(Boolean(res.userExists));
      setExistingDisplayName(res.displayName || res.username || null);
      setStep("VERIFY");
    } catch (err: any) {
      setError(err.message || "Failed to generate OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Live username availability check
  const handleUsernameChange = (val: string) => {
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setUsername(clean);
    if (clean.length < 3) {
      setUsernameStatus("IDLE");
      return;
    }

    setUsernameStatus("CHECKING");
    if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
    checkTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await api.auth.checkUsername(clean);
        setUsernameStatus(res.available ? "AVAILABLE" : "TAKEN");
      } catch {
        setUsernameStatus("IDLE");
      }
    }, 400);
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (otp.length !== 6) {
      setError("Please enter the 6-digit verification code.");
      return;
    }

    // Validation for new user registration
    if (userExists === false) {
      if (!displayName.trim()) {
        setError("Please enter your display name.");
        return;
      }
      if (!username.trim() || username.length < 3) {
        setError("Please enter a valid username (at least 3 characters).");
        return;
      }
      if (usernameStatus === "TAKEN") {
        setError("This username already exists. Please choose a different username.");
        return;
      }
    }

    try {
      setLoading(true);
      await login({
        destination: destination.trim(),
        code: otp,
        displayName: userExists === false ? displayName.trim() : undefined,
        username: userExists === false ? username.trim() : undefined,
      });
    } catch (err: any) {
      setError(err.message || "Invalid or expired OTP code.");
    } finally {
      setLoading(false);
    }
  };

  const handleAnonymousLogin = async () => {
    const randomGuestId = `guest_${Math.random().toString(36).substring(2, 8)}`;
    const guestDest = `${randomGuestId}@guest.local`;
    try {
      setLoading(true);
      setError(null);
      const reqRes = await api.auth.requestOtp(guestDest);
      const code = reqRes.devOtp || "123456";
      await login({
        destination: guestDest,
        code,
        displayName: `Guest (${randomGuestId.slice(-4)})`,
        username: randomGuestId,
      });
    } catch (err: any) {
      setError(err.message || "Failed to create guest identity");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 p-4 relative">
      <button
        onClick={onToggleLang}
        className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-sm transition-colors border border-white/10"
      >
        {lang === "en" ? "🇮🇳 हिंदी में बदलें" : "🇮🇳 Switch to English"}
      </button>

      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100">
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-6 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 via-white to-green-600"></div>
          <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-3 backdrop-blur-sm shadow-inner">
            <MessageSquare className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{t.appName}</h1>
          <p className="text-emerald-100 text-xs mt-1 font-medium">{t.appTagline}</p>
        </div>

        {/* Content */}
        <div className="p-6 sm:p-8">
          {error && (
            <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs flex items-start space-x-2">
              <span className="font-bold">Error:</span>
              <span className="flex-1">{error}</span>
            </div>
          )}

          {step === "REQUEST" ? (
            <form onSubmit={handleRequestOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  {t.mobileOrEmail}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="+91 98765 43210 or user@example.com"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-slate-800 placeholder-slate-400 text-sm"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">{t.loginSubtitle}</p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50"
              >
                <span>{loading ? "..." : t.continueWithOtp}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="relative py-2 flex items-center justify-center">
                <div className="border-t border-slate-200 w-full"></div>
                <span className="bg-white px-2 text-[11px] text-slate-400 uppercase font-semibold absolute">
                  or
                </span>
              </div>

              <button
                type="button"
                onClick={handleAnonymousLogin}
                disabled={loading}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium text-xs transition-colors flex items-center justify-center space-x-2"
              >
                <UserX className="w-4 h-4 text-slate-500" />
                <span>{t.continueAsGuest}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              {/* Existing user alert vs new user prompt */}
              {userExists ? (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center space-x-2">
                  <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Welcome back, <strong>{existingDisplayName}</strong>! Enter OTP to sign in.
                  </span>
                </div>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span>
                    No account found with this number. Please register your profile below.
                  </span>
                </div>
              )}

              {/* Dev OTP Box */}
              {devOtp && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700 text-xs flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>{t.devOtpLabel} <strong>{devOtp}</strong></span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOtp(devOtp)}
                    className="text-emerald-600 hover:text-emerald-800 font-semibold underline text-xs"
                  >
                    {t.autoFill}
                  </button>
                </div>
              )}

              {/* OTP Input */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {t.verifyCode}
                  </label>
                  <button
                    type="button"
                    onClick={() => { setStep("REQUEST"); setOtp(""); }}
                    className="text-xs text-emerald-600 hover:underline"
                  >
                    {t.changeDestination}
                  </button>
                </div>
                <input
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="w-full px-4 py-3 text-center tracking-widest text-xl font-bold rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 text-sm"
                  autoFocus
                />
              </div>

              {/* Show Name and Username fields ONLY for NEW users */}
              {!userExists && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Display Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Rahul Sharma"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 text-xs"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-semibold text-slate-600">
                        Unique Username <span className="text-red-500">*</span>
                      </label>
                      {usernameStatus === "CHECKING" && (
                        <span className="text-[10px] text-slate-400">Checking...</span>
                      )}
                      {usernameStatus === "AVAILABLE" && (
                        <span className="text-[10px] text-emerald-600 font-semibold flex items-center">
                          <Check className="w-3 h-3 mr-0.5" /> Available
                        </span>
                      )}
                      {usernameStatus === "TAKEN" && (
                        <span className="text-[10px] text-red-600 font-semibold">
                          Already exists! Choose another
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => handleUsernameChange(e.target.value)}
                      placeholder="e.g. rahul_99"
                      className={`w-full px-3 py-2 rounded-xl border text-slate-800 text-xs focus:outline-none focus:ring-2 ${usernameStatus === "TAKEN"
                        ? "border-red-300 focus:ring-red-400 bg-red-50/50"
                        : usernameStatus === "AVAILABLE"
                          ? "border-emerald-300 focus:ring-emerald-400 bg-emerald-50/30"
                          : "border-slate-200 focus:ring-emerald-500"
                        }`}
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || otp.length !== 6 || (!userExists && usernameStatus === "TAKEN")}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-medium text-sm transition-colors flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50"
              >
                <span>
                  {loading
                    ? "..."
                    : userExists
                      ? "Verify & Sign In"
                      : "Register & Start Chatting"}
                </span>
                <CheckCircle2 className="w-4 h-4" />
              </button>
            </form>
          )}

          <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-center space-x-2 text-slate-400 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Encrypted local session • Zero cloud cost</span>
          </div>
        </div>
      </div>
    </div>
  );
};
