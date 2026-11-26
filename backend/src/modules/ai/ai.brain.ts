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

export function getConfiguredAiProvider(): { configured: boolean; provider: string } {
  if (env.GROQ_API_KEY?.trim()) return { configured: true, provider: "Groq Llama" };
  if (env.GEMINI_API_KEY?.trim()) return { configured: true, provider: "Google Gemini" };
  if (env.OPENROUTER_API_KEY?.trim()) return { configured: true, provider: "OpenRouter" };
  if (env.OPENAI_API_KEY?.trim()) return { configured: true, provider: "OpenAI" };
  if (env.POLLINATIONS_API_KEY?.trim()) return { configured: true, provider: "Pollinations AI" };
  return { configured: false, provider: "Zust Smart AI" };
}

function stripJsonFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
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
  const { provider } = getConfiguredAiProvider();
  if (!getConfiguredAiProvider().configured) return null;

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

  const chatMessages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-8).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content.slice(0, 600),
    })),
    { role: "user", content: text },
  ];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9500);

  try {
    let rawJsonText = "";

    if (env.GROQ_API_KEY?.trim()) {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.GROQ_API_KEY.trim()}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: chatMessages,
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        rawJsonText = data?.choices?.[0]?.message?.content || "";
      }
    }

    if (!rawJsonText && env.GEMINI_API_KEY?.trim()) {
      const geminiContents = [
        ...history.slice(-8).map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content.slice(0, 600) }],
        })),
        { role: "user", parts: [{ text }] },
      ];
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY.trim()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: geminiContents,
            generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
          }),
          signal: controller.signal,
        }
      );
      if (res.ok) {
        const data = (await res.json()) as any;
        rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    }

    if (!rawJsonText && env.OPENROUTER_API_KEY?.trim()) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENROUTER_API_KEY.trim()}`,
        },
        body: JSON.stringify({
          model: "meta-llama/llama-3.3-70b-instruct:free",
          temperature: 0.4,
          messages: chatMessages,
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        rawJsonText = data?.choices?.[0]?.message?.content || "";
      }
    }

    if (!rawJsonText && (env.OPENAI_API_KEY?.trim() || env.POLLINATIONS_API_KEY?.trim())) {
      const endpoint = env.OPENAI_API_KEY?.trim()
        ? "https://api.openai.com/v1/chat/completions"
        : "https://gen.pollinations.ai/v1/chat/completions";
      const token = env.OPENAI_API_KEY?.trim() || env.POLLINATIONS_API_KEY!.trim();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          model: env.OPENAI_API_KEY?.trim() ? "gpt-4o-mini" : "openai",
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: chatMessages,
        }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as any;
        rawJsonText = data?.choices?.[0]?.message?.content || "";
      }
    }

    if (!rawJsonText) return null;
    const parsed = JSON.parse(stripJsonFences(rawJsonText));
    const act = parsed?.action || {};

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
      providerName: provider,
      reply: String(parsed?.reply || "").trim(),
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
    console.error("[AI Brain] LLM error:", err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
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
  if (llmResult && llmResult.reply) {
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
      conversationalReply = pickText(parsed.replyStyle, {
        en: "I didn't fully catch that one cleanly — try rephrasing, or tell me any topic, calculation, message, call, or reminder you'd like! (Tip: Add a free GROQ_API_KEY or GEMINI_API_KEY on the server for full deep LLM conversations.)",
        hinglish: "Ye baat main poori tarah samajh nahi paaya — thoda aur clear likh kar ya bol kar bataiye! (Full ChatGPT/Gemini level deep AI ke liye server par free GROQ_API_KEY ya GEMINI_API_KEY bhi add kar sakte hain.)",
        hi: "मैं इसे पूरी तरह समझ नहीं पाया — कृपया थोड़ा और स्पष्ट लिखें या बोलें!",
      });
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
