import React, { useState, useRef, useEffect } from "react";
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
  Video,
  Languages,
  Sparkles,
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
  const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFeatureIdx, setActiveFeatureIdx] = useState(0);

  const t = translations[lang];

  const features = [
    {
      icon: Video,
      title: lang === "hi" ? "फुल-स्क्रीन HD वीडियो कॉल" : "Full-Screen HD Video Calls",
      desc:
        lang === "hi"
          ? "फ्रंट/बैक कैमरा फ्लिप और ऑन/ऑफ कंट्रोल के साथ क्रिस्टल-क्लियर कॉल।"
          : "Crystal-clear calls with instant front/back camera flip & live camera controls.",
      badge: "WebRTC HD",
    },
    {
      icon: Languages,
      title: lang === "hi" ? "हिंदी → English स्मार्ट सेंड" : "Smart Hindi → English Send",
      desc:
        lang === "hi"
          ? "हिंदी या हिंग्लिश में टाइप करें और English चुनें — मैसेज अपने आप अनुवाद होकर जाएगा!"
          : "Type in Hindi or Hinglish, select English — auto-converts & sends in English directly!",
      badge: "Unique AI",
    },
    {
      icon: ShieldCheck,
      title: lang === "hi" ? "सुरक्षित और तेज़ चैट" : "Private & Lightning Fast",
      desc:
        lang === "hi"
          ? "वॉइस नोट्स, फ़ाइल शेयरिंग, ग्रुप चैट और रीयल-टाइम ब्लू टिक।"
          : "Voice notes, instant media sharing, group rooms & real-time read receipts.",
      badge: "E2EE Ready",
    },
  ];

  // Auto-cycle showcase feature pill
  useEffect(() => {
    const id = setInterval(() => {
      setActiveFeatureIdx((prev) => (prev + 1) % features.length);
    }, 4000);
    return () => clearInterval(id);
  }, [features.length]);

  // Keep Register tab synchronized with Browser Back Button
  useEffect(() => {
    const handlePop = () => {
      setTab((curr) => (curr === "REGISTER" ? "SIGNIN" : curr));
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const switchTab = (nextTab: "SIGNIN" | "REGISTER") => {
    if (nextTab === "REGISTER" && tab === "SIGNIN") {
      window.history.pushState({ __zustAuthTab: "REGISTER" }, "");
    }
    setTab(nextTab);
    setError(null);
  };

  // Live username check
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

  const getPasswordStrength = (pw: string) => {
    if (!pw) return { score: 0, label: "", color: "bg-slate-200" };
    let score = 0;
    if (pw.length >= 6) score++;
    if (pw.length >= 10) score++;
    if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    if (score <= 1) return { score: 25, label: "Weak", color: "bg-red-500" };
    if (score === 2) return { score: 55, label: "Good", color: "bg-amber-500" };
    if (score === 3) return { score: 80, label: "Strong", color: "bg-emerald-500" };
    return { score: 100, label: "Very Strong", color: "bg-teal-500" };
  };

  const pwStrength = getPasswordStrength(regPassword);

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
    <div className="h-dvh w-screen overflow-y-auto bg-slate-950 text-white relative flex flex-col">
      {/* Animated Ambient Gradient Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl animate-floatSlow" />
        <div className="absolute top-1/3 -right-24 w-96 h-96 bg-teal-500/20 rounded-full blur-3xl animate-floatSlow [animation-delay:2s]" />
        <div className="absolute -bottom-32 left-1/3 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl animate-floatSlow [animation-delay:4s]" />
      </div>

      {/* Top Floating Controls */}
      <div className="relative z-20 w-full max-w-6xl mx-auto px-4 sm:px-8 pt-4 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight text-white">{t.appName}</span>
        </div>

        <div className="flex items-center space-x-2">
          {onToggleTheme && (
            <button
              type="button"
              onClick={onToggleTheme}
              title={isDark ? "Switch to Light Mode" : "Switch to Dark Mode"}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white/90 backdrop-blur-md border border-white/10 transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-300" /> : <Moon className="w-4 h-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={onToggleLang}
            className="bg-white/10 hover:bg-white/20 text-white px-3.5 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md transition-all border border-white/15 flex items-center space-x-1.5"
          >
            <Languages className="w-3.5 h-3.5 text-emerald-300" />
            <span>{lang === "en" ? "🇮🇳 हिंदी" : "🇬🇧 English"}</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative z-10 flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 py-6 flex items-center justify-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          {/* Left Interactive Brand & Feature Showcase (Desktop) */}
          <div className="hidden lg:flex lg:col-span-6 flex-col space-y-6 pr-4">
            <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 w-fit">
              <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
              <span className="text-xs font-semibold text-emerald-200">
                Built for India • Smart Hindi → English Chat
              </span>
            </div>

            <h1 className="text-4xl xl:text-5xl font-extrabold tracking-tight leading-tight text-white">
              Connect Instantly.
              <span className="block bg-gradient-to-r from-emerald-400 via-teal-300 to-amber-300 bg-clip-text text-transparent">
                Speak Any Language.
              </span>
            </h1>

            <p className="text-slate-300 text-base leading-relaxed max-w-lg">
              {t.appTagline}. Experience lag-free messaging, full-screen HD video calls with camera flip, and instant Hindi-to-English message translation.
            </p>

            {/* Interactive Feature Cards */}
            <div className="space-y-3 pt-2">
              {features.map((feat, idx) => {
                const Icon = feat.icon;
                const isActive = activeFeatureIdx === idx;
                return (
                  <div
                    key={feat.title}
                    onClick={() => setActiveFeatureIdx(idx)}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all duration-300 ${
                      isActive
                        ? "bg-white/10 border-emerald-400/50 shadow-lg shadow-emerald-950/50 scale-[1.01]"
                        : "bg-white/[0.04] border-white/10 hover:bg-white/[0.07]"
                    }`}
                  >
                    <div className="flex items-start space-x-3.5">
                      <div
                        className={`p-2.5 rounded-xl shrink-0 ${
                          isActive
                            ? "bg-gradient-to-tr from-emerald-500 to-teal-500 text-white shadow-md"
                            : "bg-white/10 text-emerald-300"
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-white">{feat.title}</h3>
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                            {feat.badge}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">{feat.desc}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Interactive Auth Card */}
          <div className="lg:col-span-6 w-full max-w-md mx-auto">
            <div className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 rounded-3xl shadow-2xl overflow-hidden border border-white/20 dark:border-slate-800 backdrop-blur-xl animate-scaleIn">
              {/* Mobile Top Accent Banner */}
              <div className="relative bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-800 px-6 py-5 text-white overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-orange-500 via-white to-green-500" />
                <div className="flex items-center space-x-3">
                  <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur-md flex items-center justify-center shadow-inner shrink-0">
                    <MessageSquare className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">
                      {tab === "SIGNIN" ? t.loginTitle : t.registerTab}
                    </h2>
                    <p className="text-emerald-100/90 text-xs mt-0.5">
                      {t.appTagline}
                    </p>
                  </div>
                </div>
              </div>

              {/* Sliding Pill Tab Switcher */}
              <div className="p-2 bg-slate-100 dark:bg-slate-800/80 m-5 mb-0 rounded-2xl grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => switchTab("SIGNIN")}
                  className={`py-2.5 text-xs font-bold rounded-xl transition-all ${
                    tab === "SIGNIN"
                      ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {t.signInTab}
                </button>
                <button
                  type="button"
                  onClick={() => switchTab("REGISTER")}
                  className={`py-2.5 text-xs font-bold rounded-xl transition-all ${
                    tab === "REGISTER"
                      ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {t.registerTab}
                </button>
              </div>

              {/* Card Body */}
              <div className="p-5 sm:p-6">
                {error && (
                  <div className="mb-4 p-3 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs flex items-start space-x-2 animate-fadeIn">
                    <span className="font-bold">!</span>
                    <span className="flex-1">{error}</span>
                  </div>
                )}

                {tab === "SIGNIN" ? (
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                        {t.identifierLabel}
                      </label>
                      <div className="relative group">
                        <input
                          type="text"
                          value={loginIdentifier}
                          onChange={(e) => setLoginIdentifier(e.target.value)}
                          placeholder={t.identifierPlaceholder}
                          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm transition-all"
                          autoFocus
                        />
                        <User className="w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 absolute left-3.5 top-3.5 transition-colors" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                        {t.passwordLabel}
                      </label>
                      <div className="relative group">
                        <input
                          type={showLoginPassword ? "text" : "password"}
                          value={loginPassword}
                          onChange={(e) => setLoginPassword(e.target.value)}
                          placeholder={t.passwordPlaceholder}
                          className="w-full pl-10 pr-10 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 dark:text-slate-100 placeholder-slate-400 text-sm transition-all"
                        />
                        <Lock className="w-4 h-4 text-slate-400 group-focus-within:text-emerald-500 absolute left-3.5 top-3.5 transition-colors" />
                        <button
                          type="button"
                          onClick={() => setShowLoginPassword(!showLoginPassword)}
                          className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/25 disabled:opacity-50 active:scale-[0.99]"
                    >
                      <span>{loading ? "Signing in..." : t.signInBtn}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>

                    <div className="relative py-2 flex items-center justify-center">
                      <div className="border-t border-slate-200 dark:border-slate-700 w-full" />
                      <span className="bg-white dark:bg-slate-900 px-2.5 text-[11px] text-slate-400 uppercase font-semibold absolute">
                        or
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={handleGuestLogin}
                      disabled={loading}
                      className="w-full py-2.5 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-semibold text-xs transition-all flex items-center justify-center space-x-2 border border-slate-200/80 dark:border-slate-700"
                    >
                      <Zap className="w-4 h-4 text-amber-500" />
                      <span>{t.continueAsGuest}</span>
                    </button>

                    <div className="text-center pt-1">
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t.dontHaveAccount} </span>
                      <button
                        type="button"
                        onClick={() => switchTab("REGISTER")}
                        className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-bold"
                      >
                        {t.createOneNow}
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleRegister} className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        {t.displayNameLabel} <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={regDisplayName}
                        onChange={(e) => setRegDisplayName(e.target.value)}
                        placeholder={t.displayNamePlaceholder}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 dark:text-slate-100 text-xs transition-all"
                        autoFocus
                      />
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-1">
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                          {t.usernameLabel} <span className="text-red-500">*</span>
                        </label>
                        {usernameStatus === "CHECKING" && (
                          <span className="text-[10px] text-slate-400 animate-pulse">Checking...</span>
                        )}
                        {usernameStatus === "AVAILABLE" && (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center">
                            <Check className="w-3 h-3 mr-0.5" /> Available
                          </span>
                        )}
                        {usernameStatus === "TAKEN" && (
                          <span className="text-[10px] text-red-500 font-bold">
                            Already taken
                          </span>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          value={regUsername}
                          onChange={(e) => handleUsernameChange(e.target.value)}
                          placeholder={t.usernamePlaceholder}
                          className={`w-full pl-8 pr-3.5 py-2.5 rounded-xl border text-slate-800 dark:text-slate-100 bg-slate-50/70 dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 transition-all ${
                            usernameStatus === "TAKEN"
                              ? "border-red-400 focus:ring-red-400"
                              : usernameStatus === "AVAILABLE"
                              ? "border-emerald-400 focus:ring-emerald-400"
                              : "border-slate-200 dark:border-slate-700 focus:ring-emerald-500"
                          }`}
                        />
                        <AtSign className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        {t.optionalContactLabel}
                      </label>
                      <input
                        type="text"
                        value={regIdentifier}
                        onChange={(e) => setRegIdentifier(e.target.value)}
                        placeholder={t.optionalContactPlaceholder}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-slate-800 dark:text-slate-100 text-xs"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                          {t.passwordLabel} (min 6) <span className="text-red-500">*</span>
                        </label>
                        {pwStrength.label && (
                          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                            {pwStrength.label}
                          </span>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type={showRegPassword ? "text" : "password"}
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Create a strong password"
                          className="w-full pl-8 pr-9 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
                      {regPassword && (
                        <div className="w-full h-1 bg-slate-200 dark:bg-slate-700 rounded-full mt-1.5 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${pwStrength.color}`}
                            style={{ width: `${pwStrength.score}%` }}
                          />
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        {t.confirmPasswordLabel} <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type={showRegPassword ? "text" : "password"}
                          value={regConfirmPassword}
                          onChange={(e) => setRegConfirmPassword(e.target.value)}
                          placeholder={t.confirmPasswordPlaceholder}
                          className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                        <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={loading || usernameStatus === "TAKEN"}
                      className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/25 disabled:opacity-50 mt-1 active:scale-[0.99]"
                    >
                      <span>{loading ? "Registering..." : t.registerBtn}</span>
                      <CheckCircle2 className="w-4 h-4" />
                    </button>

                    <div className="text-center pt-1">
                      <span className="text-xs text-slate-500 dark:text-slate-400">{t.alreadyHaveAccount} </span>
                      <button
                        type="button"
                        onClick={() => switchTab("SIGNIN")}
                        className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline font-bold"
                      >
                        {t.signInNow}
                      </button>
                    </div>
                  </form>
                )}

                <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-slate-400 text-[11px]">
                  <div className="flex items-center space-x-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    <span>Encrypted session</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <UserX className="w-3.5 h-3.5 text-teal-500" />
                    <span>No OTP wait</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
