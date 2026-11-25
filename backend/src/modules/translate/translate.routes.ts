import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { validateBody } from "../../middleware/validate";
import { asyncHandler } from "../../utils/async-handler";

const router = Router();
router.use(requireAuth);

const translateSchema = z.object({
  text: z.string().min(1).max(5000),
  targetLang: z.string().min(2).max(12).default("en"),
  sourceLang: z.string().min(2).max(12).default("auto"),
});

// Comprehensive Romanized Hindi (Hinglish) markers
const HINGLISH_MARKERS = new Set([
  "kya", "kaise", "kaisi", "kaisa", "hai", "hain", "ho", "hu", "hun", "hoon",
  "main", "mein", "hum", "tum", "aap", "woh", "yeh", "ye", "vo", "wo",
  "kar", "karo", "karna", "karenge", "karega", "karegi", "kiya", "raha", "rahi", "rahe",
  "tha", "thi", "the", "hoga", "hogi", "honge", "nahi", "nhi", "na", "mat",
  "haan", "ha", "ji", "bhai", "yaar", "dost", "ghar", "kal", "aaj", "abhi",
  "kab", "kahan", "kaha", "kyun", "kyu", "kyunki", "kaun", "kitna", "kitni",
  "bahut", "bohot", "bhot", "accha", "acha", "achha", "theek", "thik", "badiya", "mast",
  "chalo", "chal", "batao", "btao", "bata", "sun", "suno", "dekh", "dekho",
  "milte", "milna", "milenge", "bhej", "bhejo", "bhejna", "bhejdo", "jana", "ja", "jao", "jaunga",
  "aana", "aa", "aao", "aaunga", "khana", "kha", "khao", "paani", "pani", "kaam", "paisa", "paise",
  "samajh", "pata", "pta", "chahiye", "chahta", "chahti", "mera", "meri", "mere",
  "tera", "teri", "tere", "tumhara", "aapka", "apna", "apni", "apne", "naam",
  "sab", "kuch", "koi", "aur", "lekin", "par", "toh", "bhi", "se", "ko",
  "ka", "ki", "ke", "pe", "liye", "saath", "sath", "baad", "pehle",
  "namaste", "dhanyawad", "shukriya", "madad", "zaroor", "jaldi", "der",
  "raat", "subah", "shaam", "din", "waqt", "samay", "baat", "bol", "bolo",
  "likh", "likho", "padh", "padho", "sunao", "rakho", "lena", "dena", "dedo", "lelo",
  "kr", "kro", "rha", "rhi", "rhe", "tu", "mujhe", "mujhko",
  "tujhe", "unko", "unhe", "humko", "hume", "isko", "usko", "idhar", "udhar",
  "yahan", "wahan", "upar", "niche", "andar", "bahar", "paas", "door",
  "khush", "udaas", "gussa", "pyaar", "pyar", "dhyan", "intezar", "maaf",
  "sahi", "galat", "mushkil", "aasan", "naya", "purana", "bada", "chota",
  "gaya", "gayi", "gaye", "diya", "liya", "kkrh", "bhaiya", "didi"
]);

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
};

function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

function isLikelyHinglish(text: string): boolean {
  if (hasDevanagari(text)) return false;
  // Ignore pure non-Latin scripts (Arabic, Tamil, Bengali, Japanese, etc.)
  if (/[^\u0000-\u024F\s\p{P}\p{S}\p{N}]/u.test(text)) return false;

  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;

  for (const w of words) {
    if (HINGLISH_MARKERS.has(w)) return true;
  }
  return false;
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal, headers: REQUEST_HEADERS });
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

async function myMemoryTranslate(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<{ translatedText: string } | null> {
  try {
    const sl = sourceLang === "auto" ? "autodetect" : sourceLang;
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(sl)}|${encodeURIComponent(targetLang)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const translatedText = data?.responseData?.translatedText;
    if (typeof translatedText === "string" && translatedText.trim() && data?.responseStatus === 200) {
      return { translatedText: translatedText.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

async function translateAny(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<{ translatedText: string; detectedLang?: string } | null> {
  const g = await googleTranslate(text, sourceLang, targetLang);
  if (g) return g;
  const mm = await myMemoryTranslate(text, sourceLang === "auto" ? "en" : sourceLang, targetLang);
  if (mm) return { translatedText: mm.translatedText, detectedLang: sourceLang };
  return null;
}

router.post(
  "/",
  validateBody(translateSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { text, targetLang, sourceLang } = req.body as {
      text: string;
      targetLang: string;
      sourceLang: string;
    };
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

    // Explicit Hinglish or auto-detected Hinglish -> transliterate to Hindi first, then translate to ANY targetLang!
    const treatAsHinglish =
      sourceLang === "hinglish" || (sourceLang === "auto" && isLikelyHinglish(trimmed));

    if (treatAsHinglish) {
      const hindiScript = await transliterateToDevanagari(trimmed);
      if (targetLang === "hi" && hasDevanagari(hindiScript)) {
        return res.json({
          success: true,
          originalText: text,
          translatedText: hindiScript,
          detectedSource: "hinglish",
          converted: hindiScript !== trimmed,
        });
      }

      if (hasDevanagari(hindiScript)) {
        const result = await translateAny(hindiScript, "hi", targetLang);
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
    }

    // Standard Any-to-Any translation (Devanagari, English, Tamil, Spanish, Arabic, etc. -> targetLang)
    const effectiveSource = hasDevanagari(trimmed) && sourceLang === "auto" ? "hi" : sourceLang;
    const result = await translateAny(trimmed, effectiveSource, targetLang);
    if (result?.translatedText) {
      return res.json({
        success: true,
        originalText: text,
        translatedText: result.translatedText,
        detectedSource: result.detectedLang || effectiveSource,
        converted: result.translatedText.toLowerCase() !== trimmed.toLowerCase(),
      });
    }

    return res.json({
      success: true,
      originalText: text,
      translatedText: trimmed,
      detectedSource: effectiveSource,
      converted: false,
    });
  })
);

export default router;
