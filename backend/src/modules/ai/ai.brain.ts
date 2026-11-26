import { env } from "../../config/env";
import { smartTranslateServer, translateAny } from "../../utils/translator";
import { detectLanguageStyle, parseNaturalDateTime, parseUserInstruction, pickText, ReplyStyle } from "./ai.nlu";

export type BrainAction = {
  type:
    | "CONFIRM_PENDING"
    | "CANCEL_PENDING"
    | "SEND_MESSAGE"
    | "SCHEDULE_MESSAGE"
    | "START_CALL"
    | "CREATE_GROUP"
    | "CREATE_POLL"
    | "SET_REMINDER"
    | "TASK_CREATE"
    | "TASK_LIST"
    | "TASK_COMPLETE"
    | "UNREAD_SUMMARY"
    | "LAST_CONVERSATION"
    | "SUMMARIZE_CHAT"
    | "SEARCH_CHATS"
    | "SCHEDULED_LIST"
    | "SCHEDULED_CANCEL"
    | "NONE";
  targetName?: string;
  messageBody?: string;
  scheduledForIso?: string;
  isVideoCall?: boolean;
  groupTitle?: string;
  memberNames?: string[];
  pollQuestion?: string;
  pollOptions?: string[];
  reminderText?: string;
  taskTitle?: string;
  searchQuery?: string;
};

export interface BrainResponse {
  mode: "llm" | "built-in";
  providerName: string;
  reply: string;
  replyStyle: ReplyStyle;
  replyIso: string;
  action: BrainAction;
}

const VALID_ACTION_TYPES = new Set<BrainAction["type"]>([
  "CONFIRM_PENDING",
  "CANCEL_PENDING",
  "SEND_MESSAGE",
  "SCHEDULE_MESSAGE",
  "START_CALL",
  "CREATE_GROUP",
  "CREATE_POLL",
  "SET_REMINDER",
  "TASK_CREATE",
  "TASK_LIST",
  "TASK_COMPLETE",
  "UNREAD_SUMMARY",
  "LAST_CONVERSATION",
  "SUMMARIZE_CHAT",
  "SEARCH_CHATS",
  "SCHEDULED_LIST",
  "SCHEDULED_CANCEL",
  "NONE",
]);

let lastLlmDiagnostic: { error?: string; updatedAt?: number } = {};

export function cleanEnvKey(raw?: string): string {
  if (!raw) return "";
  return raw.trim().replace(/^["']+|["']+$/g, "").trim();
}

function getGeminiKey(): string {
  return cleanEnvKey(env.GEMINI_API_KEY) || cleanEnvKey(env.GOOGLE_API_KEY);
}

export function getConfiguredAiProvider(): { configured: boolean; provider: string; lastError?: string } {
  let provider = "Zust Smart AI";
  let configured = false;

  if (cleanEnvKey(env.GROQ_API_KEY)) {
    configured = true;
    provider = "Groq Llama";
  } else if (getGeminiKey()) {
    configured = true;
    provider = "Google Gemini";
  } else if (cleanEnvKey(env.OPENROUTER_API_KEY)) {
    configured = true;
    provider = "OpenRouter";
  } else if (cleanEnvKey(env.OPENAI_API_KEY)) {
    configured = true;
    provider = "OpenAI";
  } else if (cleanEnvKey(env.POLLINATIONS_API_KEY)) {
    configured = true;
    provider = "Pollinations AI";
  }

  const recentError =
    configured &&
    lastLlmDiagnostic.error &&
    lastLlmDiagnostic.updatedAt &&
    Date.now() - lastLlmDiagnostic.updatedAt < 15 * 60_000
      ? lastLlmDiagnostic.error
      : undefined;

  return { configured, provider, ...(recentError ? { lastError: recentError } : {}) };
}

function stripJsonFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function buildChatMessages(
  systemPrompt: string,
  history: Array<{ role: string; content: string }>,
  currentText: string
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of history.slice(-8)) {
    const content = String(m.content || "").trim().slice(0, 600);
    if (!content) continue;
    const role: "user" | "assistant" = m.role === "assistant" ? "assistant" : "user";
    if (turns.length > 0 && turns[turns.length - 1].role === role) {
      turns[turns.length - 1].content += `\n${content}`;
    } else {
      turns.push({ role, content });
    }
  }
  const cleanCurrent = currentText.trim();
  if (turns.length > 0 && turns[turns.length - 1].role === "user") {
    turns[turns.length - 1].content += `\n${cleanCurrent}`;
  } else {
    turns.push({ role: "user", content: cleanCurrent });
  }
  return [{ role: "system", content: systemPrompt }, ...turns];
}

export function buildAlternatingGeminiContents(
  history: Array<{ role: string; content: string }>,
  currentText: string
): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
  const normalized: Array<{ role: "user" | "model"; text: string }> = [];
  for (const m of history.slice(-8)) {
    const content = String(m.content || "").trim().slice(0, 600);
    if (!content) continue;
    const role: "user" | "model" = m.role === "assistant" ? "model" : "user";
    if (normalized.length === 0 && role === "model") continue;
    if (normalized.length > 0 && normalized[normalized.length - 1].role === role) {
      normalized[normalized.length - 1].text += `\n${content}`;
    } else {
      normalized.push({ role, text: content });
    }
  }
  const cleanCurrent = currentText.trim();
  if (normalized.length > 0 && normalized[normalized.length - 1].role === "user") {
    normalized[normalized.length - 1].text += `\n${cleanCurrent}`;
  } else {
    normalized.push({ role: "user", text: cleanCurrent });
  }
  return normalized.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

export function parseLlmOutputText(rawText: string): { reply: string; action: Record<string, any> } | null {
  const cleaned = stripJsonFences(rawText);
  if (!cleaned) return null;

  const tryParse = (candidate: string): Record<string, any> | null => {
    try {
      const obj = JSON.parse(candidate);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj as Record<string, any>;
    } catch {}
    return null;
  };

  let parsed = tryParse(cleaned);
  if (!parsed) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      parsed = tryParse(cleaned.slice(firstBrace, lastBrace + 1));
    }
  }

  if (parsed && (typeof parsed.reply === "string" || typeof parsed.action === "object")) {
    const rawAct = (parsed.action && typeof parsed.action === "object" ? parsed.action : {}) as Record<string, any>;
    const rawType = String(rawAct.type || "NONE").toUpperCase() as BrainAction["type"];
    const safeType: BrainAction["type"] = VALID_ACTION_TYPES.has(rawType) ? rawType : "NONE";
    return {
      reply: String(parsed.reply || "").trim(),
      action: { ...rawAct, type: safeType },
    };
  }

  // LLM answered cleanly in natural prose instead of strict JSON — preserve the reply instead of discarding!
  return {
    reply: cleaned,
    action: { type: "NONE" },
  };
}

function summarizeHttpError(providerLabel: string, status: number, bodyText: string): string {
  let msg = "";
  try {
    const j = JSON.parse(bodyText);
    msg = String(j?.error?.message || j?.message || "");
  } catch {}
  if (!msg) msg = bodyText.replace(/\s+/g, " ").trim();
  // Never reflect keys/tokens
  msg = msg.replace(/(gsk_|AIza|sk-[a-zA-Z0-9_-]{8,})[a-zA-Z0-9_-]*/g, "[REDACTED]").slice(0, 100);
  return `${providerLabel} HTTP ${status}${msg ? `: ${msg}` : ""}`;
}

async function callOpenAiCompatibleProvider(params: {
  providerLabel: string;
  endpoint: string;
  apiKey: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  attempts: Array<{ model: string; jsonMode: boolean }>;
  errors: string[];
}): Promise<string> {
  const { providerLabel, endpoint, apiKey, messages, attempts, errors } = params;
  for (const attempt of attempts) {
    try {
      const body: Record<string, any> = {
        model: attempt.model,
        temperature: 0.4,
        messages,
      };
      if (attempt.jsonMode) {
        body.response_format = { type: "json_object" };
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        const text = String(data?.choices?.[0]?.message?.content || "").trim();
        if (text) return text;
        errors.push(`${providerLabel} (${attempt.model}) empty response`);
        continue;
      }
      const errBody = await res.text().catch(() => "");
      const summary = summarizeHttpError(providerLabel, res.status, errBody);
      errors.push(summary);
      if (res.status === 401 || res.status === 403) break;
    } catch (err: any) {
      errors.push(`${providerLabel}: ${err?.name === "TimeoutError" ? "Timeout" : err?.message || "Network error"}`);
    }
  }
  return "";
}

async function callGeminiProvider(params: {
  apiKey: string;
  systemPrompt: string;
  contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }>;
  errors: string[];
}): Promise<string> {
  const { apiKey, systemPrompt, contents, errors } = params;
  const attempts = [
    { model: "gemini-2.5-flash", jsonMode: true },
    { model: "gemini-2.0-flash", jsonMode: true },
    { model: "gemini-2.5-flash-lite", jsonMode: true },
    { model: "gemini-2.0-flash", jsonMode: false },
  ];
  for (const attempt of attempts) {
    try {
      const generationConfig: Record<string, any> = { temperature: 0.4 };
      if (attempt.jsonMode) generationConfig.responseMimeType = "application/json";

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig,
          }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
        if (text) return text;
        const finishReason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason;
        errors.push(`Google Gemini (${attempt.model}) empty (${finishReason || "no text"})`);
        continue;
      }
      const errBody = await res.text().catch(() => "");
      const summary = summarizeHttpError("Google Gemini", res.status, errBody);
      errors.push(summary);
      if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|API key not valid/i.test(errBody)) {
        break;
      }
    } catch (err: any) {
      errors.push(`Google Gemini: ${err?.name === "TimeoutError" ? "Timeout" : err?.message || "Network error"}`);
    }
  }
  return "";
}

async function callFullLlmBrain(params: {
  text: string;
  userName: string;
  contacts: Array<{ label: string; username: string; isOnline: boolean }>;
  groups: Array<{ label: string }>;
  history: Array<{ role: string; content: string }>;
  pendingSummary?: string;
  tzOffsetMinutes: number;
}): Promise<{ reply: string; action: BrainAction; providerName: string } | null> {
  const { text, userName, contacts, groups, history, pendingSummary, tzOffsetMinutes } = params;
  const aiStatus = getConfiguredAiProvider();
  if (!aiStatus.configured) return null;

  const localNow = new Date(Date.now() - tzOffsetMinutes * 60_000).toISOString().replace("T", " ").slice(0, 19);

  const systemPrompt = `You are Zust AI — a full, intelligent, warm, helpful conversational AI inside the Zust Talk messaging app.
Current user: ${userName}
Local date/time: ${localNow} (timezone offset minutes: ${tzOffsetMinutes})
User contacts: ${contacts.slice(0, 20).map((c) => `${c.label} (@${c.username}${c.isOnline ? ", online" : ""})`).join(", ") || "none yet"}
User groups: ${groups.slice(0, 12).map((g) => g.label).join(", ") || "none yet"}
Pending unconfirmed action awaiting Yes/No: ${pendingSummary || "None"}

CAPABILITIES:
1. Answer ANY general knowledge, coding, writing, translation, jokes, advice, study, email/letter drafting, math, life advice, or conversation naturally — just like ChatGPT or Gemini — in the EXACT same language & script the user wrote in (Hindi Devanagari, Hinglish Roman Hindi, English, or any other language).
2. Whenever the user asks to perform an app action, fill the structured "action" object AND give a warm reply confirming or presenting the action.

Return ONLY valid JSON matching this schema:
{
  "reply": "Your natural, intelligent, human-like response in the user's exact language/style",
  "action": {
    "type": "NONE|CONFIRM_PENDING|CANCEL_PENDING|SEND_MESSAGE|SCHEDULE_MESSAGE|START_CALL|CREATE_GROUP|CREATE_POLL|SET_REMINDER|TASK_CREATE|TASK_LIST|TASK_COMPLETE|UNREAD_SUMMARY|LAST_CONVERSATION|SUMMARIZE_CHAT|SEARCH_CHATS|SCHEDULED_LIST|SCHEDULED_CANCEL",
    "targetName": "contact or group name if applicable, else null",
    "messageBody": "crafted/polished message text to send/schedule if applicable, else null",
    "scheduledForText": "original date/time expression like 'kal 12 baje' or ISO datetime if scheduled/reminder, else null",
    "isVideoCall": false,
    "groupTitle": "group name if CREATE_GROUP, else null",
    "memberNames": ["name1"] or null,
    "pollQuestion": "string or null",
    "pollOptions": ["opt1", "opt2"] or null,
    "reminderText": "string or null",
    "taskTitle": "string or null",
    "searchQuery": "string or null"
  }
}

Rules:
- For general chat / questions / writing / jokes / explanation / advice -> action.type = "NONE", give a genuinely smart, helpful, complete answer in "reply".
- If user says "write a poem/wish and send to Rahul" -> craft the actual poem/wish cleanly into action.messageBody and set action.type = "SEND_MESSAGE"!
- Never execute a call or send silently — let the confirmation card appear cleanly unless Pending exists and user confirmed ("yes", "haan", "kar do").`;

  const chatMessages = buildChatMessages(systemPrompt, history, text);
  const errors: string[] = [];
  let rawText = "";
  let activeProvider = aiStatus.provider;

  try {
    const groqKey = cleanEnvKey(env.GROQ_API_KEY);
    if (!rawText && groqKey) {
      rawText = await callOpenAiCompatibleProvider({
        providerLabel: "Groq Llama",
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        apiKey: groqKey,
        messages: chatMessages,
        attempts: [
          { model: "llama-3.3-70b-versatile", jsonMode: true },
          { model: "llama-3.3-70b-versatile", jsonMode: false },
          { model: "llama-3.1-8b-instant", jsonMode: true },
          { model: "llama-3.1-8b-instant", jsonMode: false },
        ],
        errors,
      });
      if (rawText) activeProvider = "Groq Llama";
    }

    const geminiKey = getGeminiKey();
    if (!rawText && geminiKey) {
      rawText = await callGeminiProvider({
        apiKey: geminiKey,
        systemPrompt,
        contents: buildAlternatingGeminiContents(history, text),
        errors,
      });
      if (rawText) activeProvider = "Google Gemini";
    }

    const openrouterKey = cleanEnvKey(env.OPENROUTER_API_KEY);
    if (!rawText && openrouterKey) {
      rawText = await callOpenAiCompatibleProvider({
        providerLabel: "OpenRouter",
        endpoint: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: openrouterKey,
        messages: chatMessages,
        attempts: [
          { model: "meta-llama/llama-3.3-70b-instruct:free", jsonMode: false },
          { model: "google/gemini-2.0-flash-exp:free", jsonMode: false },
        ],
        errors,
      });
      if (rawText) activeProvider = "OpenRouter";
    }

    const openaiKey = cleanEnvKey(env.OPENAI_API_KEY);
    const pollKey = cleanEnvKey(env.POLLINATIONS_API_KEY);
    if (!rawText && (openaiKey || pollKey)) {
      rawText = await callOpenAiCompatibleProvider({
        providerLabel: openaiKey ? "OpenAI" : "Pollinations AI",
        endpoint: openaiKey
          ? "https://api.openai.com/v1/chat/completions"
          : "https://gen.pollinations.ai/v1/chat/completions",
        apiKey: openaiKey || pollKey,
        messages: chatMessages,
        attempts: [
          { model: openaiKey ? "gpt-4o-mini" : "openai", jsonMode: true },
          { model: openaiKey ? "gpt-4o-mini" : "openai", jsonMode: false },
        ],
        errors,
      });
      if (rawText) activeProvider = openaiKey ? "OpenAI" : "Pollinations AI";
    }

    if (!rawText) {
      const diag = errors[0] || "Empty LLM response";
      lastLlmDiagnostic = { error: errors.join(" | ").slice(0, 180) || diag, updatedAt: Date.now() };
      console.error("[AI Brain] Configured LLM failed:", lastLlmDiagnostic.error);
      return null;
    }

    const parsed = parseLlmOutputText(rawText);
    if (!parsed) {
      lastLlmDiagnostic = { error: "Unparseable empty LLM response", updatedAt: Date.now() };
      return null;
    }

    lastLlmDiagnostic = {};
    const act = parsed.action || {};

    let scheduledForIso: string | undefined;
    if (act.scheduledForText) {
      const directDate = new Date(act.scheduledForText);
      if (!Number.isNaN(directDate.getTime()) && /\d{4}-\d{2}-\d{2}/.test(String(act.scheduledForText))) {
        scheduledForIso = directDate.toISOString();
      } else {
        const natural = parseNaturalDateTime(String(act.scheduledForText), tzOffsetMinutes);
        if (natural) scheduledForIso = natural.date.toISOString();
      }
    }
    if (!scheduledForIso && (act.type === "SCHEDULE_MESSAGE" || act.type === "SET_REMINDER")) {
      const fromText = parseNaturalDateTime(text, tzOffsetMinutes);
      if (fromText) scheduledForIso = fromText.date.toISOString();
    }

    return {
      providerName: activeProvider,
      reply: parsed.reply,
      action: {
        type: act.type || "NONE",
        targetName: act.targetName || undefined,
        messageBody: act.messageBody || undefined,
        scheduledForIso,
        isVideoCall: Boolean(act.isVideoCall),
        groupTitle: act.groupTitle || undefined,
        memberNames: Array.isArray(act.memberNames) ? act.memberNames : undefined,
        pollQuestion: act.pollQuestion || undefined,
        pollOptions: Array.isArray(act.pollOptions) ? act.pollOptions : undefined,
        reminderText: act.reminderText || undefined,
        taskTitle: act.taskTitle || undefined,
        searchQuery: act.searchQuery || undefined,
      },
    };
  } catch (err: any) {
    lastLlmDiagnostic = { error: String(err?.message || err).slice(0, 150), updatedAt: Date.now() };
    console.error("[AI Brain] LLM error:", lastLlmDiagnostic.error);
    return null;
  }
}

function trySafeArithmetic(text: string): string | null {
  const cleaned = text
    .toLowerCase()
    .replace(/(what is|calculate|solve|kitna hoga|batao|=|\?)/g, " ")
    .replace(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/g, "($1/100)*$2")
    .replace(/\b(plus|jod)\b/g, "+")
    .replace(/\b(minus|ghatao)\b/g, "-")
    .replace(/\b(times|multiply|guna|x)\b/g, "*")
    .replace(/\b(divided by|divide|bhag)\b/g, "/")
    .trim();

  if (!/^[0-9+\-*/().\s]{3,80}$/.test(cleaned) || !/[+\-*/]/.test(cleaned)) {
    return null;
  }
  try {
    const val = Function(`"use strict"; return (${cleaned});`)();
    if (typeof val === "number" && Number.isFinite(val)) {
      return Number.isInteger(val) ? String(val) : val.toFixed(4).replace(/\.?0+$/, "");
    }
  } catch {
    return null;
  }
  return null;
}

async function tryZeroKeyKnowledge(rawText: string, style: ReplyStyle, replyIso: string): Promise<string | null> {
  let enQuery = rawText.trim();
  if (style === "hi" || style === "hinglish" || style === "other") {
    const tr = await smartTranslateServer(enQuery, "en", "auto");
    if (tr?.translatedText) enQuery = tr.translatedText;
  }
  const lower = enQuery.toLowerCase().trim();

  // 1. Safe Math
  const mathAns = trySafeArithmetic(enQuery);
  if (mathAns !== null) {
    return pickText(style, {
      en: `The answer is **${mathAns}**.`,
      hinglish: `Iska jawab **${mathAns}** hai.`,
      hi: `इसका उत्तर **${mathAns}** है।`,
    });
  }

  // 2. Live Weather via wttr.in
  const weatherMatch = lower.match(/\b(?:weather|temperature|mausam|climate)\b(?:\s+(?:in|of|at|ka|ki|for)\s+([a-z\s]{2,30}))?/i) ||
    lower.match(/^([a-z\s]{2,25})\s+(?:weather|temperature|mausam)\b/i);
  if (weatherMatch) {
    const city = (weatherMatch[1] || "Delhi").replace(/\b(today|aaj|tomorrow|kal|kaisa|hai|is)\b/gi, "").trim() || "Delhi";
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const w = (await res.text()).trim();
        if (w && !w.toLowerCase().includes("unknown location")) {
          return pickText(style, {
            en: `Current weather: ${w}`,
            hinglish: `Abhi ka mausam: ${w}`,
            hi: `अभी का मौसम: ${w}`,
          });
        }
      }
    } catch {}
  }

  // 3. Built-in Jokes / Shayari / Writing Helpers
  if (/\b(joke|funny|chutkula|hasao)\b/i.test(lower)) {
    const jokes = [
      {
        en: "Why do programmers prefer dark mode? Because light attracts bugs!",
        hinglish: "Teacher: Agar tumhare paas 10 chocolates hain aur Rahul 4 maang le to kitni bachengi?\nStudent: 10 hi bachengi, kyunki main kisi ko ek bhi nahi dunga! 😄",
        hi: "टीचर: अगर तुम्हारे पास 10 चॉकलेट हैं और राहुल 4 माँग ले तो कितनी बचेंगी?\nछात्र: 10 ही बचेंगी, क्योंकि मैं किसी को एक भी नहीं दूँगा! 😄",
      },
      {
        en: "I told my computer I needed a break, and now it won't stop sending me KitKat ads!",
        hinglish: "Dost: Bhai life me koi stress mat lo!\nMain: Stress nahi le raha, bas Wi-Fi slow chal raha hai — wahi asli dukh hai! 😅",
        hi: "दोस्त: भाई ज़िंदगी में टेंशन मत लो!\nमैं: टेंशन नहीं है, बस वाई-फ़ाई धीरे चल रहा है — वही असली दुख है! 😅",
      },
    ];
    const picked = jokes[Math.floor(Math.random() * jokes.length)];
    return pickText(style, picked);
  }

  if (/\b(shayari|poem|kavita|quote|motivational)\b/i.test(lower)) {
    return pickText(style, {
      en: "\"Every step forward, no matter how small, brings you closer to where you want to be.\" Keep going! ✨",
      hinglish: "Koshish karne walon ki kabhi haar nahi hoti,\nChhote kadam hi sahi, par manzil zaroor milti hai! ✨",
      hi: "कोशिश करने वालों की कभी हार नहीं होती,\nछोटे कदम ही सही, पर मंज़िल ज़रूर मिलती है! ✨",
    });
  }

  if (/\b(leave application|sick leave|chutti)\b/i.test(lower)) {
    return `Here is a crisp Leave Application draft you can edit:\n\nSubject: Request for Leave\n\nRespected Sir/Madam,\nI am writing to request leave for today/tomorrow as I am unable to attend due to personal/health reasons. Kindly grant me leave for the mentioned duration.\n\nThank you,\n[Your Name]`;
  }

  // 4. Live Wikipedia / DuckDuckGo Factual Answer
  const topic = enQuery
    .replace(/^(what is|who is|tell me about|explain|define|where is|when was|meaning of|about)\s+/i, "")
    .replace(/[?!.]+$/g, "")
    .trim();

  if (topic.length >= 2) {
    try {
      const ddgRes = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(topic)}&format=json&no_html=1&skip_disambig=1`,
        { signal: AbortSignal.timeout(4500) }
      );
      if (ddgRes.ok) {
        const ddg = (await ddgRes.json()) as any;
        const abs = String(ddg?.AbstractText || ddg?.Answer || "").trim();
        if (abs && abs.length > 15) {
          const concise = abs.split(". ").slice(0, 3).join(". ") + (abs.includes(".") ? "." : "");
          if (style === "hi") {
            const tr = await translateAny(concise, "en", "hi");
            return tr?.translatedText || concise;
          }
          if (style === "other" && replyIso !== "en" && replyIso !== "auto") {
            const tr = await translateAny(concise, "en", replyIso);
            return tr?.translatedText || concise;
          }
          return concise;
        }
      }
    } catch {}

    try {
      const wikiSlug = topic.replace(/\s+/g, "_");
      const wikiRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiSlug)}`,
        { signal: AbortSignal.timeout(4500) }
      );
      if (wikiRes.ok) {
        const wiki = (await wikiRes.json()) as any;
        const extract = String(wiki?.extract || "").trim();
        if (extract && wiki?.type !== "disambiguation") {
          const concise = extract.split(". ").slice(0, 3).join(". ") + ".";
          if (style === "hi") {
            const tr = await translateAny(concise, "en", "hi");
            return tr?.translatedText || concise;
          }
          if (style === "other" && replyIso !== "en" && replyIso !== "auto") {
            const tr = await translateAny(concise, "en", replyIso);
            return tr?.translatedText || concise;
          }
          return concise;
        }
      }
    } catch {}
  }

  return null;
}

export async function thinkWithAiBrain(params: {
  text: string;
  userName: string;
  contacts: Array<{ label: string; username: string; isOnline: boolean }>;
  groups: Array<{ label: string }>;
  history: Array<{ role: string; content: string }>;
  pendingSummary?: string;
  tzOffsetMinutes: number;
}): Promise<BrainResponse> {
  const { text, tzOffsetMinutes, pendingSummary } = params;
  const detected = detectLanguageStyle(text);

  // 1. Primary: True Multi-Turn LLM Brain (Groq / Gemini / OpenRouter / OpenAI) when configured
  const llmResult = await callFullLlmBrain(params);
  if (llmResult && (llmResult.reply || llmResult.action.type !== "NONE")) {
    return {
      mode: "llm",
      providerName: llmResult.providerName,
      reply: llmResult.reply,
      replyStyle: detected.style,
      replyIso: detected.iso,
      action: llmResult.action,
    };
  }

  // 2. Fallback: Smart NLU + Live Knowledge/Math/Weather/Conversation Engine (Works cleanly without API key!)
  const parsed = await parseUserInstruction(text, {
    tzOffsetMinutes,
    hasPending: Boolean(pendingSummary),
  });

  if (parsed.intent !== "GENERAL_CHAT") {
    return {
      mode: "built-in",
      providerName: "Zust Smart AI",
      reply: "",
      replyStyle: parsed.replyStyle,
      replyIso: parsed.replyIso,
      action: {
        type: parsed.intent,
        targetName: parsed.targetName,
        messageBody: parsed.messageBody,
        scheduledForIso: parsed.scheduledForIso,
        isVideoCall: parsed.isVideoCall,
        groupTitle: parsed.groupTitle,
        memberNames: parsed.memberNames,
        pollQuestion: parsed.pollQuestion,
        pollOptions: parsed.pollOptions,
        reminderText: parsed.reminderText,
        taskTitle: parsed.taskTitle,
        searchQuery: parsed.searchQuery,
      },
    };
  }

  // Handle greetings & natural small talk warmly
  const lower = text.trim().toLowerCase();
  let conversationalReply = "";

  if (/^(hi|hello|hey|hii+|namaste|namaskar|hola)\b[!.\s]*$/i.test(lower)) {
    conversationalReply = pickText(parsed.replyStyle, {
      en: `Hi ${params.userName}! Ask me anything or tell me to text, call, schedule a reminder, summarize unread chats, or create a poll.`,
      hinglish: `Namaste ${params.userName}! Bataiye aaj kya help chahiye? Aap mujhse kuch bhi pooch sakte hain ya message/call/reminder karwa sakte hain!`,
      hi: `नमस्ते ${params.userName}! बताइए आज आपकी क्या मदद करूँ? आप मुझसे कुछ भी पूछ सकते हैं या मैसेज/कॉल/रिमाइंडर करवा सकते हैं!`,
    });
  } else if (/\b(kaise ho|how are you|kya haal|what's up|wassup|kkrh)\b/i.test(lower)) {
    conversationalReply = pickText(parsed.replyStyle, {
      en: "I'm doing great and ready to help! What's on your mind?",
      hinglish: "Main bilkul badhiya hoon! Aap bataiye kaise hain, aaj kya kaam karein?",
      hi: "मैं बिल्कुल बढ़िया हूँ! आप बताइए कैसे हैं, आज क्या काम करें?",
    });
  } else if (/\b(thanks|thank you|shukriya|dhanyawad|thnx|ty)\b/i.test(lower)) {
    conversationalReply = pickText(parsed.replyStyle, {
      en: "Anytime! Always here whenever you need anything.",
      hinglish: "Welcome ji! Jab bhi zaroorat ho, bas boliyega.",
      hi: "आपका स्वागत है! जब भी ज़रूरत हो, बस बोलिएगा।",
    });
  } else if (/\b(who are you|tum kaun ho|your name|mera naam)\b/i.test(lower)) {
    conversationalReply = pickText(parsed.replyStyle, {
      en: "I'm Zust AI, your personal AI assistant built right into Zust Talk!",
      hinglish: "Main Zust AI hoon — aapka personal AI! Sawalon ke jawab se lekar messages, calls aur reminders tak sab kar sakta hoon.",
      hi: "मैं ज़स्ट AI हूँ — आपका पर्सनल AI असिस्टेंट!",
    });
  } else {
    // Query live Math, Weather, Jokes/Poetry, Wikipedia/DuckDuckGo Facts!
    const knowledge = await tryZeroKeyKnowledge(text, parsed.replyStyle, parsed.replyIso);
    if (knowledge) {
      conversationalReply = knowledge;
    } else {
      const aiStatus = getConfiguredAiProvider();
      if (aiStatus.configured) {
        const errHint = aiStatus.lastError ? ` (${aiStatus.lastError})` : "";
        conversationalReply = pickText(parsed.replyStyle, {
          en: `${aiStatus.provider} could not answer right now${errHint}. Please check the API key/quota on Render or try again in a moment.`,
          hinglish: `${aiStatus.provider} se abhi response nahi aa paaya${errHint}. Kripya Render par API key/quota check karein ya thodi der baad dobara poochein.`,
          hi: `${aiStatus.provider} से अभी जवाब नहीं मिल पाया${errHint}। कृपया सर्वर की API कुंजी या कोटा जाँचें।`,
        });
      } else {
        conversationalReply = pickText(parsed.replyStyle, {
          en: "I didn't fully catch that one cleanly — try rephrasing, or tell me any topic, calculation, message, call, or reminder you'd like! (Tip: Add GROQ_API_KEY or GEMINI_API_KEY on Render and redeploy for full deep LLM conversations.)",
          hinglish: "Ye baat main poori tarah samajh nahi paaya — thoda aur clear likh kar ya bol kar bataiye! (Full ChatGPT/Gemini level deep AI ke liye Render par GROQ_API_KEY ya GEMINI_API_KEY add karke Manual Deploy karein.)",
          hi: "मैं इसे पूरी तरह समझ नहीं पाया — कृपया थोड़ा और स्पष्ट लिखें या बोलें!",
        });
      }
    }
  }

  return {
    mode: "built-in",
    providerName: "Zust Smart AI",
    reply: conversationalReply,
    replyStyle: parsed.replyStyle,
    replyIso: parsed.replyIso,
    action: { type: "NONE" },
  };
}
