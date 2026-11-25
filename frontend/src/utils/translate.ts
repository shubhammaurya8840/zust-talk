import { api } from "../api/client";

export interface LangOption {
  code: string;
  label: string;
  short: string;
}

export const TARGET_LANGUAGES: LangOption[] = [
  { code: "ORIGINAL", label: "As Typed (No Translate)", short: "Original" },
  { code: "en", label: "English", short: "English" },
  { code: "hi", label: "हिन्दी (Hindi)", short: "हिंदी" },
  { code: "bn", label: "বাংলা (Bengali)", short: "বাংলা" },
  { code: "mr", label: "मराठी (Marathi)", short: "मराठी" },
  { code: "ta", label: "தமிழ் (Tamil)", short: "தமிழ்" },
  { code: "te", label: "తెలుగు (Telugu)", short: "తెలుగు" },
  { code: "gu", label: "ગુજરાતી (Gujarati)", short: "ગુજરાતી" },
  { code: "pa", label: "ਪੰਜਾਬੀ (Punjabi)", short: "ਪੰਜਾਬੀ" },
  { code: "kn", label: "ಕನ್ನಡ (Kannada)", short: "ಕನ್ನಡ" },
  { code: "ml", label: "മലയാളം (Malayalam)", short: "മലയാളം" },
  { code: "ur", label: "اردو (Urdu)", short: "اردو" },
  { code: "es", label: "Español (Spanish)", short: "Español" },
  { code: "fr", label: "Français (French)", short: "Français" },
  { code: "de", label: "Deutsch (German)", short: "Deutsch" },
  { code: "ar", label: "العربية (Arabic)", short: "العربية" },
  { code: "ja", label: "日本語 (Japanese)", short: "日本語" },
  { code: "ko", label: "한국어 (Korean)", short: "한국어" },
  { code: "zh-CN", label: "中文 (Chinese)", short: "中文" },
  { code: "ru", label: "Русский (Russian)", short: "Русский" },
  { code: "pt", label: "Português (Portuguese)", short: "Português" },
  { code: "it", label: "Italiano (Italian)", short: "Italiano" },
];

export const SOURCE_LANGUAGES: LangOption[] = [
  { code: "auto", label: "Auto Detect (All + Hinglish)", short: "Auto" },
  { code: "hinglish", label: "Hinglish (Hindi in English letters)", short: "Hinglish" },
  { code: "hi", label: "Hindi (हिन्दी)", short: "Hindi" },
  { code: "en", label: "English", short: "English" },
  { code: "bn", label: "Bengali", short: "Bengali" },
  { code: "mr", label: "Marathi", short: "Marathi" },
  { code: "ta", label: "Tamil", short: "Tamil" },
  { code: "te", label: "Telugu", short: "Telugu" },
  { code: "gu", label: "Gujarati", short: "Gujarati" },
  { code: "pa", label: "Punjabi", short: "Punjabi" },
  { code: "ur", label: "Urdu", short: "Urdu" },
  { code: "es", label: "Spanish", short: "Spanish" },
  { code: "fr", label: "French", short: "French" },
  { code: "de", label: "German", short: "German" },
  { code: "ar", label: "Arabic", short: "Arabic" },
  { code: "ja", label: "Japanese", short: "Japanese" },
  { code: "ko", label: "Korean", short: "Korean" },
  { code: "zh-CN", label: "Chinese", short: "Chinese" },
];

async function browserFallbackTranslate(
  text: string,
  targetLang: string,
  sourceLang = "auto"
): Promise<string> {
  // Direct CORS-friendly Google Translate fallback from user's phone/browser
  try {
    const sl = sourceLang === "hinglish" ? "hi" : sourceLang;
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx` +
      `&sl=${encodeURIComponent(sl)}` +
      `&tl=${encodeURIComponent(targetLang)}` +
      `&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.[0])) {
        const out = data[0].map((c: any) => (typeof c?.[0] === "string" ? c[0] : "")).join("").trim();
        if (out) return out;
      }
    }
  } catch {
    // Fall through to MyMemory
  }

  // Secondary CORS-friendly fallback via MyMemory API
  try {
    const sl = sourceLang === "auto" || sourceLang === "hinglish" ? "hi" : sourceLang;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(sl)}|${encodeURIComponent(targetLang)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const out = data?.responseData?.translatedText;
      if (typeof out === "string" && out.trim()) return out.trim();
    }
  } catch {
    // Return original if completely offline
  }

  return text;
}

/**
 * Resilient universal translator:
 * 1. Tries backend `/api/translate` (which handles Hinglish -> Devanagari -> Any Target).
 * 2. If backend fails/unavailable (e.g. cold start, network, stale deploy), runs direct browser CORS fallback so it works on all phones & laptops.
 */
export async function smartTranslate(
  text: string,
  targetLang: string,
  sourceLang = "auto"
): Promise<{ translatedText: string; converted: boolean }> {
  const trimmed = text.trim();
  if (!trimmed || targetLang === "ORIGINAL") {
    return { translatedText: text, converted: false };
  }

  try {
    const res = await api.translate.convert(trimmed, targetLang, sourceLang);
    if (res?.success && typeof res.translatedText === "string" && res.translatedText.trim()) {
      // If backend didn't convert (e.g. missed a Hinglish phrase), check browser fallback if sourceLang was hinglish
      if (
        res.translatedText.trim().toLowerCase() === trimmed.toLowerCase() &&
        sourceLang === "hinglish"
      ) {
        const direct = await browserFallbackTranslate(trimmed, targetLang, "hi");
        return {
          translatedText: direct,
          converted: direct.trim().toLowerCase() !== trimmed.toLowerCase(),
        };
      }
      return {
        translatedText: res.translatedText.trim(),
        converted: Boolean(res.converted),
      };
    }
  } catch {
    // Backend unavailable — transparently use browser fallback!
  }

  const fallbackText = await browserFallbackTranslate(trimmed, targetLang, sourceLang);
  return {
    translatedText: fallbackText,
    converted: fallbackText.trim().toLowerCase() !== trimmed.toLowerCase(),
  };
}
