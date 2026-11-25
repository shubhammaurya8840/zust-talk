import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { Language, translations } from "../utils/i18n";
import { TARGET_LANGUAGES } from "../utils/translate";
import {
  MessageSquare,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Check,
  Eye,
  EyeOff,
  Lock,
  User,
  AtSign,
  Mail,
  Zap,
  Moon,
  Sun,
  KeyRound,
  Languages,
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
  const [mode, setMode] = useState<"SIGNIN" | "REGISTER" | "FORGOT">("SIGNIN");

  // Sign In state
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register Email OTP Verification state
  const [regEmail, setRegEmail] = useState("");
  const [regOtpSent, setRegOtpSent] = useState(false);
  const [regOtpCode, setRegOtpCode] = useState("");
  const [regVerificationToken, setRegVerificationToken] = useState<string | null>(null);
  const [regDevOtpHint, setRegDevOtpHint] = useState<string | null>(null);

  // Register Account details (unlocked after email OTP verification)
  const [regDisplayName, setRegDisplayName] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPrimaryLanguage, setRegPrimaryLanguage] = useState("en");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"IDLE" | "CHECKING" | "AVAILABLE" | "TAKEN">("IDLE");
  const checkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Forgot Password state
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotOtpSent, setForgotOtpSent] = useState(false);
  const [forgotOtpCode, setForgotOtpCode] = useState("");
  const [forgotNewPassword, setForgotNewPassword] = useState("");
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState("");
  const [forgotDevOtpHint, setForgotDevOtpHint] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const t = translations[lang];

  useEffect(() => {
    const handlePop = () => {
      setMode((curr) => (curr !== "SIGNIN" ? "SIGNIN" : curr));
    };
    window.addEventListener("popstate", handlePop);
    return () => window.removeEventListener("popstate", handlePop);
  }, []);

  const switchMode = (nextMode: "SIGNIN" | "REGISTER" | "FORGOT") => {
    if (nextMode !== "SIGNIN" && mode === "SIGNIN") {
      try {
        window.history.pushState({ __zustAuthTab: nextMode }, "");
      } catch {}
    }
    setMode(nextMode);
    setError(null);
    setSuccessMsg(null);
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
    setSuccessMsg(null);
    const identifier = loginIdentifier.trim();
    if (!identifier) return setError("Enter your registered email address or username.");
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

  // Step 1 of Register: Send Email OTP
  const handleSendRegisterOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    const cleanEmail = regEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return setError("Please enter a valid email address.");
    }
    try {
      setLoading(true);
      const res = await api.auth.sendEmailOtp(cleanEmail, "REGISTER");
      setRegOtpSent(true);
      setRegDevOtpHint(res.devOtp ? `Test OTP: ${res.devOtp}` : null);
      setSuccessMsg(res.message);
    } catch (err: any) {
      setError(err.message || "Failed to send OTP.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2 of Register: Verify Email OTP -> unlock Password & Account Setup
  const handleVerifyRegisterOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    const cleanEmail = regEmail.trim().toLowerCase();
    if (regOtpCode.trim().length !== 6) {
      return setError("Please enter the 6-digit OTP sent to your email.");
    }
    try {
      setLoading(true);
      const res = await api.auth.verifyEmailOtp(cleanEmail, regOtpCode.trim(), "REGISTER");
      setRegVerificationToken(res.verificationToken);
      setRegDevOtpHint(null);
      setSuccessMsg("Email verified! Now set your profile & password.");
    } catch (err: any) {
      setError(err.message || "Invalid or expired OTP.");
    } finally {
      setLoading(false);
    }
  };

  // Step 3 of Register: Create Account
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!regVerificationToken) return setError("Please verify your email first.");
    if (!regDisplayName.trim()) return setError("Enter your name.");
    if (!regUsername.trim() || regUsername.length < 3) return setError("Username must be at least 3 characters.");
    if (usernameStatus === "TAKEN") return setError("Username already taken.");
    if (regPassword.length < 6) return setError("Password must be at least 6 characters.");
    if (regPassword !== regConfirmPassword) return setError("Passwords do not match.");

    try {
      setLoading(true);
      await registerWithPassword({
        email: regEmail.trim().toLowerCase(),
        verificationToken: regVerificationToken,
        username: regUsername.trim(),
        displayName: regDisplayName.trim(),
        primaryLanguage: regPrimaryLanguage,
        password: regPassword,
      });
    } catch (err: any) {
      setError(err.message || "Registration failed.");
    } finally {
      setLoading(false);
    }
  };

  // Forgot Password Step 1: Send Reset OTP to registered email
  const handleSendForgotOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    const cleanEmail = forgotEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      return setError("Enter your registered email address.");
    }
    try {
      setLoading(true);
      const res = await api.auth.sendEmailOtp(cleanEmail, "RESET_PASSWORD");
      setForgotOtpSent(true);
      setForgotDevOtpHint(res.devOtp ? `Test OTP: ${res.devOtp}` : null);
      setSuccessMsg(res.message);
    } catch (err: any) {
      setError(err.message || "Could not send reset OTP.");
    } finally {
      setLoading(false);
    }
  };

  // Forgot Password Step 2: Verify OTP & Reset Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    if (forgotOtpCode.trim().length !== 6) return setError("Enter the 6-digit OTP.");
    if (forgotNewPassword.length < 6) return setError("New password must be at least 6 characters.");
    if (forgotNewPassword !== forgotConfirmPassword) return setError("Passwords do not match.");

    try {
      setLoading(true);
      const res = await api.auth.resetPasswordWithOtp({
        email: forgotEmail.trim().toLowerCase(),
        code: forgotOtpCode.trim(),
        newPassword: forgotNewPassword,
      });
      setMode("SIGNIN");
      setLoginIdentifier(forgotEmail.trim().toLowerCase());
      setLoginPassword("");
      setForgotOtpSent(false);
      setForgotOtpCode("");
      setForgotNewPassword("");
      setForgotConfirmPassword("");
      setForgotDevOtpHint(null);
      setSuccessMsg(res.message);
    } catch (err: any) {
      setError(err.message || "Failed to reset password.");
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

      {/* Centered Aesthetic Login / Register / Forgot Card */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-[400px] bg-white/95 dark:bg-slate-900/90 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/20 dark:border-slate-800 overflow-hidden animate-scaleIn">
          <div className="pt-7 pb-3 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center mx-auto shadow-lg shadow-emerald-500/30 mb-3">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
              {mode === "FORGOT" ? "Reset Password" : t.appName}
            </h1>
          </div>

          {mode !== "FORGOT" && (
            <div className="mx-6 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => switchMode("SIGNIN")}
                className={`py-2 text-xs font-bold rounded-xl transition-all ${
                  mode === "SIGNIN"
                    ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {t.signInTab}
              </button>
              <button
                type="button"
                onClick={() => switchMode("REGISTER")}
                className={`py-2 text-xs font-bold rounded-xl transition-all ${
                  mode === "REGISTER"
                    ? "bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                {t.registerTab}
              </button>
            </div>
          )}

          <div className="p-6">
            {error && (
              <div className="mb-3.5 p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-300 text-xs">
                {error}
              </div>
            )}

            {successMsg && (
              <div className="mb-3.5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs">
                {successMsg}
              </div>
            )}

            {mode === "SIGNIN" && (
              <form onSubmit={handleSignIn} className="space-y-3.5">
                <div className="relative">
                  <input
                    type="text"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder="Email address or username"
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

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(loginIdentifier.includes("@") ? loginIdentifier : "");
                      switchMode("FORGOT");
                    }}
                    className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                  >
                    Forgot Password?
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
            )}

            {mode === "REGISTER" && (
              <>
                {!regVerificationToken ? (
                  /* Mandatory Email OTP Step before creating account & password */
                  <form
                    onSubmit={regOtpSent ? handleVerifyRegisterOtp : handleSendRegisterOtp}
                    className="space-y-3.5"
                  >
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                        Email Address <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <input
                          type="email"
                          required
                          disabled={regOtpSent}
                          value={regEmail}
                          onChange={(e) => setRegEmail(e.target.value)}
                          placeholder="you@example.com"
                          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                          autoFocus
                        />
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                      </div>
                    </div>

                    {regOtpSent && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                            Enter 6-Digit Email OTP
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              setRegOtpSent(false);
                              setRegOtpCode("");
                              setRegDevOtpHint(null);
                            }}
                            className="text-[11px] text-emerald-600 hover:underline"
                          >
                            Change Email
                          </button>
                        </div>
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={regOtpCode}
                          onChange={(e) => setRegOtpCode(e.target.value.replace(/\D/g, ""))}
                          placeholder="6-digit OTP"
                          className="w-full px-4 py-2.5 text-center font-mono tracking-[0.4em] text-base font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          autoFocus
                        />
                        {regDevOtpHint && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 font-mono">
                            {regDevOtpHint}
                          </p>
                        )}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/25 disabled:opacity-50"
                    >
                      <span>
                        {loading
                          ? "Please wait..."
                          : regOtpSent
                          ? "Verify Email OTP"
                          : "Send Verification OTP"}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                ) : (
                  /* Account & Password Creation unlocked after Email Verified */
                  <form onSubmit={handleRegister} className="space-y-3">
                    <div className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between text-xs">
                      <span className="text-emerald-700 dark:text-emerald-300 font-semibold truncate flex items-center space-x-1.5">
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{regEmail}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setRegVerificationToken(null);
                          setRegOtpSent(false);
                          setRegOtpCode("");
                        }}
                        className="text-[11px] text-slate-500 hover:underline shrink-0 ml-2"
                      >
                        Change
                      </button>
                    </div>

                    <input
                      type="text"
                      value={regDisplayName}
                      onChange={(e) => setRegDisplayName(e.target.value)}
                      placeholder={t.displayNameLabel}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      autoFocus
                    />

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

                    {/* Primary Language Selector */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1 flex items-center space-x-1">
                        <Languages className="w-3 h-3 text-emerald-600" />
                        <span>Your Primary Language</span>
                      </label>
                      <select
                        value={regPrimaryLanguage}
                        onChange={(e) => setRegPrimaryLanguage(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        {TARGET_LANGUAGES.filter((l) => l.code !== "ORIGINAL").map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="relative">
                      <input
                        type={showRegPassword ? "text" : "password"}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="Set password (min. 6 characters)"
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
              </>
            )}

            {mode === "FORGOT" && (
              <form
                onSubmit={forgotOtpSent ? handleResetPassword : handleSendForgotOtp}
                className="space-y-3.5"
              >
                <div className="relative">
                  <input
                    type="email"
                    required
                    disabled={forgotOtpSent}
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="Registered email address"
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-70"
                    autoFocus
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                </div>

                {forgotOtpSent && (
                  <>
                    <div>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={forgotOtpCode}
                        onChange={(e) => setForgotOtpCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="6-digit OTP"
                        className="w-full px-4 py-2.5 text-center font-mono tracking-[0.4em] text-base font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        autoFocus
                      />
                      {forgotDevOtpHint && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-mono">
                          {forgotDevOtpHint}
                        </p>
                      )}
                    </div>

                    <div className="relative">
                      <input
                        type="password"
                        value={forgotNewPassword}
                        onChange={(e) => setForgotNewPassword(e.target.value)}
                        placeholder="New password (min. 6 characters)"
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    </div>

                    <div className="relative">
                      <input
                        type="password"
                        value={forgotConfirmPassword}
                        onChange={(e) => setForgotConfirmPassword(e.target.value)}
                        placeholder="Confirm new password"
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    </div>
                  </>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center space-x-2 shadow-lg shadow-emerald-600/25 disabled:opacity-50"
                >
                  <span>
                    {loading
                      ? "Please wait..."
                      : forgotOtpSent
                      ? "Reset Password"
                      : "Send Reset OTP"}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setForgotOtpSent(false);
                    switchMode("SIGNIN");
                  }}
                  className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 flex items-center justify-center space-x-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Sign In</span>
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
