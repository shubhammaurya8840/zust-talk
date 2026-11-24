import React, { useState, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { Language, translations } from "../utils/i18n";
import {
  MessageSquare,
  ShieldCheck,
  ArrowRight,
  CheckCircle2,
  UserX,
  Check,
  Eye,
  EyeOff,
  Lock,
  User,
  AtSign,
} from "lucide-react";

interface AuthScreenProps {
  lang: Language;
  onToggleLang: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ lang, onToggleLang }) => {
  const { loginWithPassword, registerWithPassword, loginAsGuest } = useAuth();
  const [tab, setTab] = useState<"SIGNIN" | "REGISTER">("SIGNIN");

  // Sign In state
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register state
  const [regDisplayName, setRegDisplayName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regIdentifier, setRegIdentifier] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"IDLE" | "CHECKING" | "AVAILABLE" | "TAKEN">("IDLE");
  const checkTimeoutRef = useRef<any>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = translations[lang];

  // Handle Username Change with live check
  const handleUsernameChange = (val: string) => {
    const clean = val.toLowerCase().replace(/[^a-z0-9_]/g, "");
    setRegUsername(clean);
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

  // Sign In Handler
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const identifier = loginIdentifier.trim();
    if (!identifier) {
      setError("Please enter your Username, Mobile or Email.");
      return;
    }
    if (!loginPassword) {
      setError("Please enter your password.");
      return;
    }

    try {
      setLoading(true);
      await loginWithPassword({
        identifier,
        password: loginPassword,
      });
    } catch (err: any) {
      setError(err.message || "Invalid credentials. Please check your username and password.");
    } finally {
      setLoading(false);
    }
  };

  // Register Handler
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!regDisplayName.trim()) {
      setError("Please enter your full name / display name.");
      return;
    }
    if (!regUsername.trim() || regUsername.length < 3) {
      setError("Username must be at least 3 characters (letters, numbers, underscore).");
      return;
    }
    if (usernameStatus === "TAKEN") {
      setError("This username is already taken. Please choose another username.");
      return;
    }
    if (regPassword.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setError("Passwords do not match. Please re-enter.");
      return;
    }

    try {
      setLoading(true);
      await registerWithPassword({
        username: regUsername.trim(),
        displayName: regDisplayName.trim(),
        password: regPassword,
        identifier: regIdentifier.trim() || undefined,
      });
    } catch (err: any) {
      setError(err.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Quick Guest Login
  const handleGuestLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      await loginAsGuest();
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

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-100 bg-slate-50/50">
          <button
            type="button"
            onClick={() => {
              setTab("SIGNIN");
              setError(null);
            }}
            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all border-b-2 ${
              tab === "SIGNIN"
                ? "border-emerald-600 text-emerald-700 bg-white shadow-sm"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {t.signInTab}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("REGISTER");
              setError(null);
            }}
            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider transition-all border-b-2 ${
              tab === "REGISTER"
                ? "border-emerald-600 text-emerald-700 bg-white shadow-sm"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            {t.registerTab}
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 sm:p-8">
          {error && (
            <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs flex items-start space-x-2">
              <span className="font-bold">Error:</span>
              <span className="flex-1">{error}</span>
            </div>
          )}

          {tab === "SIGNIN" ? (
            /* Sign In Form */
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {t.identifierLabel}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder={t.identifierPlaceholder}
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 placeholder-slate-400 text-sm"
                    autoFocus
                  />
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {t.passwordLabel}
                </label>
                <div className="relative">
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder={t.passwordPlaceholder}
                    className="w-full pl-9 pr-10 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 placeholder-slate-400 text-sm"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  >
                    {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50"
              >
                <span>{loading ? "Signing in..." : t.signInBtn}</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="text-center pt-1">
                <span className="text-xs text-slate-500">{t.dontHaveAccount} </span>
                <button
                  type="button"
                  onClick={() => {
                    setTab("REGISTER");
                    setError(null);
                  }}
                  className="text-xs text-emerald-600 hover:underline font-semibold"
                >
                  {t.createOneNow}
                </button>
              </div>

              <div className="relative py-2 flex items-center justify-center">
                <div className="border-t border-slate-200 w-full"></div>
                <span className="bg-white px-2 text-[11px] text-slate-400 uppercase font-semibold absolute">
                  or
                </span>
              </div>

              <button
                type="button"
                onClick={handleGuestLogin}
                disabled={loading}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-medium text-xs transition-colors flex items-center justify-center space-x-2"
              >
                <UserX className="w-4 h-4 text-slate-500" />
                <span>{t.continueAsGuest}</span>
              </button>
            </form>
          ) : (
            /* Register Form */
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {t.displayNameLabel} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={regDisplayName}
                  onChange={(e) => setRegDisplayName(e.target.value)}
                  placeholder={t.displayNamePlaceholder}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 text-xs"
                  autoFocus
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-semibold text-slate-600">
                    {t.usernameLabel} <span className="text-red-500">*</span>
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
                <div className="relative">
                  <input
                    type="text"
                    value={regUsername}
                    onChange={(e) => handleUsernameChange(e.target.value)}
                    placeholder={t.usernamePlaceholder}
                    className={`w-full pl-8 pr-3.5 py-2.5 rounded-xl border text-slate-800 text-xs focus:outline-none focus:ring-2 ${
                      usernameStatus === "TAKEN"
                        ? "border-red-300 focus:ring-red-400 bg-red-50/50"
                        : usernameStatus === "AVAILABLE"
                          ? "border-emerald-300 focus:ring-emerald-400 bg-emerald-50/30"
                          : "border-slate-200 focus:ring-emerald-500"
                    }`}
                  />
                  <AtSign className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {t.optionalContactLabel}
                </label>
                <input
                  type="text"
                  value={regIdentifier}
                  onChange={(e) => setRegIdentifier(e.target.value)}
                  placeholder={t.optionalContactPlaceholder}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {t.passwordLabel} (min. 6 characters) <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showRegPassword ? "text" : "password"}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Create a strong password"
                    className="w-full pl-8 pr-9 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 text-xs"
                  />
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                  <button
                    type="button"
                    onClick={() => setShowRegPassword(!showRegPassword)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    {showRegPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  {t.confirmPasswordLabel} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showRegPassword ? "text" : "password"}
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    placeholder={t.confirmPasswordPlaceholder}
                    className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 text-xs"
                  />
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || usernameStatus === "TAKEN"}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/20 disabled:opacity-50 mt-2"
              >
                <span>{loading ? "Registering..." : t.registerBtn}</span>
                <CheckCircle2 className="w-4 h-4" />
              </button>

              <div className="text-center pt-1">
                <span className="text-xs text-slate-500">{t.alreadyHaveAccount} </span>
                <button
                  type="button"
                  onClick={() => {
                    setTab("SIGNIN");
                    setError(null);
                  }}
                  className="text-xs text-emerald-600 hover:underline font-semibold"
                >
                  {t.signInNow}
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-center space-x-2 text-slate-400 text-xs">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Encrypted session • Direct login, no OTP required</span>
          </div>
        </div>
      </div>
    </div>
  );
};
