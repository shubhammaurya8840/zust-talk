import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { Language, translations } from "../utils/i18n";
import {
  MessageSquare,
  ArrowRight,
  CheckCircle2,
  Check,
  Eye,
  EyeOff,
  Lock,
  User,
  AtSign,
  Zap,
  Moon,
  Sun,
} from "lucide-react";

interface AuthScreenProps {
  lang: Language;
  onToggleLang: () => void;
  isDark?: boolean;
  onToggleTheme?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  lang,
  onToggleLang,
  isDark = false,
  onToggleTheme,
}) => {
  const { loginWithPassword, registerWithPassword, loginAsGuest } = useAuth();
  const [tab, setTab] = useState<"SIGNIN" | "REGISTER">("SIGNIN");

  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [regDisplayName, setRegDisplayName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regIdentifier, setRegIdentifier] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"IDLE" | "CHECKING" | "AVAILABLE" | "TAKEN">("IDLE");
  const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = translations[lang];

  useEffect(() => {
    const handlePop = () => {
      setTab((curr) => (curr === "REGISTER" ? "SIGNIN" : curr));
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const switchTab = (nextTab: "SIGNIN" | "REGISTER") => {
    if (nextTab === "REGISTER" && tab === "SIGNIN") {
      try {
        window.history.pushState({ __zustAuthTab: "REGISTER" }, "");
      } catch {}
    }
    setTab(nextTab);
    setError(null);
  };

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
    }, 350);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const identifier = loginIdentifier.trim();
    if (!identifier) return setError("Enter your username, mobile or email.");
    if (!loginPassword) return setError("Enter your password.");

    try {
      setLoading(true);
      await loginWithPassword({ identifier, password: loginPassword });
    } catch (err: any) {
      setError(err.message || "Invalid credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!regDisplayName.trim()) return setError("Enter your name.");
    if (!regUsername.trim() || regUsername.length < 3) return setError("Username must be at least 3 characters.");
    if (usernameStatus === "TAKEN") return setError("Username already taken.");
    if (regPassword.length < 6) return setError("Password must be at least 6 characters.");
    if (regPassword !== regConfirmPassword) return setError("Passwords do not match.");

    try {
      setLoading(true);
      await registerWithPassword({
        username: regUsername.trim(),
        displayName: regDisplayName.trim(),
        password: regPassword,
        identifier: regIdentifier.trim() || undefined,
      });
    } catch (err: any) {
      setError(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      await loginAsGuest();
    } catch (err: any) {
      setError(err.message || "Failed to continue as guest");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-dvh w-screen overflow-y-auto bg-slate-950 text-white relative flex flex-col justify-between">
      {/* Aesthetic Soft Aurora Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-[28rem] h-[28rem] bg-emerald-500/20 rounded-full blur-3xl animate-floatSlow" />
        <div className="absolute -bottom-32 -right-32 w-[28rem] h-[28rem] bg-teal-500/20 rounded-full blur-3xl animate-floatSlow [animation-delay:3s]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[22rem] h-[22rem] bg-cyan-500/10 rounded-full blur-3xl" />
      </div>

      {/* Minimal Top Bar */}
      <div className="relative z-10 w-full px-5 pt-4 flex items-center justify-end space-x-2 shrink-0">
        {onToggleTheme && (
          <button
            type="button"
            onClick={onToggleTheme}
            title="Toggle Theme"
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/90 backdrop-blur-md border border-white/10 transition-colors"
          >
            {isDark ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleLang}
          className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs font-semibold text-white/90 backdrop-blur-md border border-white/10 transition-colors"
        >
          {lang === "en" ? "हिंदी" : "English"}
        </button>
      </div>

      {/* Centered Clean Aesthetic Login Card */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-[400px] bg-white/95 dark:bg-slate-900/90 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/20 dark:border-slate-800 overflow-hidden animate-scaleIn">
          {/* Minimal Header */}
          <div className="pt-7 pb-3 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/30 mb-3">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              {t.appName}
            </h1>
          </div>

          {/* Clean Tab Switch */}
          <div className="mx-6 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => switchTab("SIGNIN")}
              className={`py-2 text-xs font-bold rounded-xl transition-all ${
                tab === "SIGNIN"
                  ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {t.signInTab}
            </button>
            <button
              type="button"
              onClick={() => switchTab("REGISTER")}
              className={`py-2 text-xs font-bold rounded-xl transition-all ${
                tab === "REGISTER"
                  ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm"
                  : "text-slate-500 dark:text-slate-400"
              }`}
            >
              {t.registerTab}
            </button>
          </div>

          <div className="p-6">
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs">
                {error}
              </div>
            )}

            {tab === "SIGNIN" ? (
              <form onSubmit={handleSignIn} className="space-y-3.5">
                <div className="relative">
                  <input
                    type="text"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder={t.identifierLabel}
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                </div>

                <div className="relative">
                  <input
                    type={showLoginPassword ? "text" : "password"}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder={t.passwordLabel}
                    className="w-full pl-10 pr-10 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/25 disabled:opacity-50"
                >
                  <span>{loading ? "Signing in..." : t.signInBtn}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleGuestLogin}
                  disabled={loading}
                  className="w-full py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-semibold text-xs transition-all flex items-center justify-center space-x-1.5"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-500" />
                  <span>{t.continueAsGuest}</span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-3">
                <input
                  type="text"
                  value={regDisplayName}
                  onChange={(e) => setRegDisplayName(e.target.value)}
                  placeholder={t.displayNameLabel}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  autoFocus
                />

                <div>
                  <div className="relative">
                    <input
                      type="text"
                      value={regUsername}
                      onChange={(e) => handleUsernameChange(e.target.value)}
                      placeholder={t.usernameLabel}
                      className="w-full pl-8 pr-20 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <AtSign className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                    {usernameStatus === "AVAILABLE" && (
                      <span className="absolute right-2.5 top-2.5 text-[10px] text-emerald-600 font-bold flex items-center">
                        <Check className="w-3 h-3 mr-0.5" /> Free
                      </span>
                    )}
                    {usernameStatus === "TAKEN" && (
                      <span className="absolute right-2.5 top-2.5 text-[10px] text-red-500 font-bold">
                        Taken
                      </span>
                    )}
                  </div>
                </div>

                <input
                  type="text"
                  value={regIdentifier}
                  onChange={(e) => setRegIdentifier(e.target.value)}
                  placeholder={t.optionalContactLabel}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />

                <div className="relative">
                  <input
                    type={showRegPassword ? "text" : "password"}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Password (min. 6 characters)"
                    className="w-full pl-8 pr-9 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                  <button
                    type="button"
                    onClick={() => setShowRegPassword(!showRegPassword)}
                    className="absolute right-2.5 top-2.5 text-slate-400"
                  >
                    {showRegPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showRegPassword ? "text" : "password"}
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    placeholder={t.confirmPasswordLabel}
                    className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                </div>

                <button
                  type="submit"
                  disabled={loading || usernameStatus === "TAKEN"}
                  className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/25 disabled:opacity-50"
                >
                  <span>{loading ? "Creating..." : t.registerBtn}</span>
                  <CheckCircle2 className="w-4 h-4" />
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-10 pb-3 text-center text-[11px] text-slate-500">
        Encrypted • Private
      </div>
    </div>
  );
};
