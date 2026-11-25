import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";

const router = Router();
router.use(requireAuth);

const translateSchema = z.object({
  text: z.string().min(1).max(5000),
  targetLang: z.enum(["en", "hi"]).default("en"),
});

// Common Hinglish (Romanized Hindi) markers to distinguish Hinglish from pure English
const HINGLISH_MARKERS = new Set([
  "kya", "kaise", "kaisi", "kaisa", "hai", "hain", "ho", "hu", "hun", "hoon",
  "main", "mein", "hum", "tum", "aap", "woh", "yeh", "ye", "vo", "wo",
  "kar", "karo", "karna", "karenge", "kiya", "raha", "rahi", "rahe",
  "tha", "thi", "the", "hoga", "hogi", "honge", "nahi", "nhi", "na", "mat",
  "haan", "ha", "ji", "bhai", "yaar", "dost", "ghar", "kal", "aaj", "abhi",
  "kab", "kahan", "kaha", "kyun", "kyu", "kyunki", "kaun", "kitna", "kitni",
  "bahut", "bohot", "bhot", "accha", "acha", "achha", "theek", "thik",
  "chalo", "chal", "batao", "btao", "bata", "sun", "suno", "dekh", "dekho",
  "milte", "milna", "bhej", "bhejo", "bhejna", "jana", "ja", "jao", "aana", "aa", "aao",
  "khana", "kha", "khao", "paani", "pani", "kaam", "paisa", "paise",
  "samajh", "pata", "chahiye", "chahta", "chahti", "mera", "meri", "mere",
  "tera", "teri", "tere", "tumhara", "aapka", "apna", "apni", "apne",
  "sab", "kuch", "koi", "aur", "lekin", "par", "toh", "bhi", "se", "ko",
  "ka", "ki", "ke", "pe", "liye", "saath", "sath", "baad", "pehle",
  "namaste", "dhanyawad", "shukriya", "madad", "zaroor", "jaldi", "der",
  "raat", "subah", "shaam", "din", "waqt", "samay", "baat", "bol", "bolo",
  "likh", "likho", "padh", "padho", "sunao", "rakho", "lena", "dena", "dedo", "lelo",
  "kr", "kro", "rha", "rhi", "rhe", "h", "k", "m", "tu", "mujhe", "mujhko",
  "tujhe", "unko", "unhe", "humko", "hume", "isko", "usko", "idhar", "udhar",
  "yahan", "wahan", "upar", "niche", "andar", "bahar", "paas", "door",
  "khush", "udaas", "gussa", "pyaar", "pyar", "dhyan", "intezar", "maaf",
  "sahi", "galat", "mushkil", "aasan", "naya", "purana", "bada", "chota"
]);

// Local fallback phrase/word dictionary when external translation APIs are unavailable
const LOCAL_HINGLISH_PHRASES: Array<[RegExp, string]> = [
  [/\bkaise ho\b/gi, "how are you"],
  [/\baap kaise hain\b/gi, "how are you"],
  [/\bkya haal hai\b/gi, "how are things"],
  [/\bmain theek hu[n]?\b/gi, "I am fine"],
  [/\bmain thik hu[n]?\b/gi, "I am fine"],
  [/\btheek hai\b/gi, "okay"],
  [/\bthik hai\b/gi, "okay"],
  [/\bkya kar rahe ho\b/gi, "what are you doing"],
  [/\bkya kr rhe ho\b/gi, "what are you doing"],
  [/\bghar ja raha hu[n]?\b/gi, "going home"],
  [/\bkal milte hai[n]?\b/gi, "see you tomorrow"],
  [/\babhi aa raha hu[n]?\b/gi, "coming right now"],
  [/\bkhana kha liya\b/gi, "did you eat food"],
  [/\bnamaste\b/gi, "hello"],
  [/\bdhanyawad\b/gi, "thank you"],
  [/\bshukriya\b/gi, "thank you"],
  [/\bmaaf karna\b/gi, "sorry"],
  [/\bsubah ho gayi\b/gi, "it is morning"],
  [/\bshubh ratri\b/gi, "good night"],
  [/\bsuprabhat\b/gi, "good morning"],
];

function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

function isLikelyHinglish(text: string): boolean {
  if (hasDevanagari(text)) return false;
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;

  let matches = 0;
  for (const w of words) {
    if (HINGLISH_MARKERS.has(w)) matches++;
  }
  return matches >= 1;
}

async function fetchWithTimeout(url: string, timeoutMs = 4500): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function transliterateToDevanagari(text: string): Promise<string> {
  try {
    const url =
      "https://inputtools.google.com/request?text=" +
      encodeURIComponent(text) +
      "&itc=hi-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8";
    const res = await fetchWithTimeout(url);
    if (!res.ok) return text;
    const data = (await res.json()) as any;
    if (data?.[0] !== "SUCCESS" || !Array.isArray(data[1])) return text;

    let result = "";
    let cursor = 0;
    for (const seg of data[1]) {
      const src = typeof seg?.[0] === "string" ? seg[0] : "";
      const conv = typeof seg?.[1]?.[0] === "string" ? seg[1][0] : src;
      const idx = src ? text.indexOf(src, cursor) : -1;
      if (idx !== -1) {
        result += text.slice(cursor, idx) + conv;
        cursor = idx + src.length;
      } else {
        result += conv;
      }
    }
    result += text.slice(cursor);
    return result || text;
  } catch {
    return text;
  }
}

async function googleTranslate(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<{ translatedText: string; detectedLang?: string } | null> {
  try {
    const url =
      `https://translate.googleapis.com/translate_a/single?client=gtx` +
      `&sl=${encodeURIComponent(sourceLang)}` +
      `&tl=${encodeURIComponent(targetLang)}` +
      `&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (!Array.isArray(data?.[0])) return null;
    const translatedText = data[0]
      .map((chunk: any) => (typeof chunk?.[0] === "string" ? chunk[0] : ""))
      .join("")
      .trim();
    const detectedLang = typeof data?.[2] === "string" ? data[2] : undefined;
    return translatedText ? { translatedText, detectedLang } : null;
  } catch {
    return null;
  }
}

function localFallbackToEnglish(text: string): string {
  let out = text;
  for (const [pattern, replacement] of LOCAL_HINGLISH_PHRASES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

router.post(
  "/",
  validateBody(translateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { text, targetLang } = req.body as { text: string; targetLang: "en" | "hi" };
    const trimmed = text.trim();

    if (!trimmed) {
      return res.json({
        success: true,
        originalText: text,
        translatedText: text,
        detectedSource: targetLang,
        converted: false,
      });
    }

    if (targetLang === "en") {
      // 1. If Devanagari script is present, translate directly hi -> en
      if (hasDevanagari(trimmed)) {
        const result = await googleTranslate(trimmed, "hi", "en");
        const translatedText = result?.translatedText || trimmed;
        return res.json({
          success: true,
          originalText: text,
          translatedText,
          intermediateHindi: trimmed,
          detectedSource: "hi",
          converted: translatedText !== trimmed,
        });
      }

      // 2. Check if text looks like Romanized Hindi (Hinglish)
      const hinglishDetected = isLikelyHinglish(trimmed);
      if (hinglishDetected) {
        const hindiScript = await transliterateToDevanagari(trimmed);
        if (hasDevanagari(hindiScript)) {
          const result = await googleTranslate(hindiScript, "hi", "en");
          if (result?.translatedText) {
            return res.json({
              success: true,
              originalText: text,
              translatedText: result.translatedText,
              intermediateHindi: hindiScript,
              detectedSource: "hinglish",
              converted: true,
            });
          }
        }
        const fallback = localFallbackToEnglish(trimmed);
        return res.json({
          success: true,
          originalText: text,
          translatedText: fallback,
          detectedSource: "hinglish",
          converted: fallback.toLowerCase() !== trimmed.toLowerCase(),
        });
      }

      // 3. Auto-detect other scripts/languages -> English (or keep pure English intact)
      const autoResult = await googleTranslate(trimmed, "auto", "en");
      if (autoResult) {
        return res.json({
          success: true,
          originalText: text,
          translatedText: autoResult.translatedText,
          detectedSource: autoResult.detectedLang || "en",
          converted: autoResult.translatedText.toLowerCase() !== trimmed.toLowerCase(),
        });
      }

      return res.json({
        success: true,
        originalText: text,
        translatedText: trimmed,
        detectedSource: "en",
        converted: false,
      });
    }

    // Target = "hi" (English / Hinglish -> Devanagari Hindi)
    if (hasDevanagari(trimmed)) {
      return res.json({
        success: true,
        originalText: text,
        translatedText: trimmed,
        detectedSource: "hi",
        converted: false,
      });
    }

    if (isLikelyHinglish(trimmed)) {
      const hindiScript = await transliterateToDevanagari(trimmed);
      return res.json({
        success: true,
        originalText: text,
        translatedText: hindiScript,
        detectedSource: "hinglish",
        converted: hindiScript !== trimmed,
      });
    }

    const result = await googleTranslate(trimmed, "auto", "hi");
    const translatedText = result?.translatedText || trimmed;
    return res.json({
      success: true,
      originalText: text,
      translatedText,
      detectedSource: result?.detectedLang || "en",
      converted: translatedText !== trimmed,
    });
  })
);

export default router;
