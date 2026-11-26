import { env } from "../../config/env";
import { hasDevanagari, isLikelyHinglish, translateAny } from "../../utils/translator";

export type ReplyStyle = "en" | "hinglish" | "hi" | "other";

export type ParsedIntentType =
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
  | "GENERAL_CHAT";

export interface ParsedIntent {
  intent: ParsedIntentType;
  replyStyle: ReplyStyle;
  replyIso: string;
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
  chatReply?: string;
}

export function detectLanguageStyle(rawText: string): { style: ReplyStyle; iso: string } {
  if (hasDevanagari(rawText)) return { style: "hi", iso: "hi" };
  if (isLikelyHinglish(rawText)) return { style: "hinglish", iso: "en" };
  // Non-Latin script (Bengali, Tamil, Arabic, etc.)
  if (/[^\u0000-\u024F\s\p{P}\p{S}\p{N}]/u.test(rawText)) {
    return { style: "other", iso: "auto" };
  }
  return { style: "en", iso: "en" };
}

export function pickText(style: ReplyStyle, opts: { en: string; hinglish: string; hi?: string }): string {
  if (style === "hi") return opts.hi || opts.hinglish;
  if (style === "hinglish") return opts.hinglish;
  return opts.en;
}

const HINDI_NUMBERS: Record<string, number> = {
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhah: 6, che: 6,
  saat: 7, sat: 7, aath: 8, nau: 9, no: 9, das: 10, gyarah: 11, barah: 12,
  pandrah: 15, bees: 20, tees: 30,
};

function replaceHindiNumberWords(input: string): string {
  return input.replace(
    /\b(ek|do|teen|char|chaar|paanch|panch|chhah|che|saat|sat|aath|nau|das|gyarah|barah|pandrah|bees|tees)\b/gi,
    (m) => String(HINDI_NUMBERS[m.toLowerCase()] ?? m)
  );
}

/**
 * Parses Hindi/Hinglish/English natural dates & times into a UTC Date,
 * honoring client timezoneOffsetMinutes (JS Date.getTimezoneOffset(), e.g., -330 for IST).
 */
export function parseNaturalDateTime(
  rawText: string,
  tzOffsetMinutes = -330
): { date: Date; matchedText?: string } | null {
  const normalized = replaceHindiNumberWords(rawText.toLowerCase());
  const nowUtc = Date.now();
  // Shifting UTC epoch by -tzOffset makes UTC getters match user's local wall-clock!
  const offsetShiftMs = -tzOffsetMinutes * 60_000;
  const localNow = new Date(nowUtc + offsetShiftMs);

  // 1. Relative minutes / hours: "5 minute baad", "in 10 mins", "2 ghante baad", "in 1 hour"
  const relMinMatch = normalized.match(
    /(?:in\s+)?(\d{1,3})\s*(?:min|mins|minute|minutes|mint)\s*(?:baad|bad|later|after|mein|me)?/i
  );
  if (relMinMatch && /\b(in|baad|bad|later|after)\b/i.test(relMinMatch[0])) {
    const mins = Number(relMinMatch[1] || 0);
    if (mins > 0 && mins <= 1440) {
      return { date: new Date(nowUtc + mins * 60_000), matchedText: relMinMatch[0] };
    }
  }

  const relHrMatch = normalized.match(
    /(?:in\s+)?(\d{1,2})\s*(?:hr|hrs|hour|hours|ghanta|ghante)\s*(?:baad|bad|later|after|mein|me)?/i
  );
  if (relHrMatch && /\b(in|baad|bad|later|after|mein|me)\b/i.test(relHrMatch[0])) {
    const hrs = Number(relHrMatch[1]);
    if (hrs > 0 && hrs <= 168) {
      return { date: new Date(nowUtc + hrs * 3600_000), matchedText: relHrMatch[0] };
    }
  }

  // 2. Day shift (today / kal / parso / tomorrow)
  let dayShift = 0;
  let explicitDay = false;
  if (/\b(parso|day after tomorrow)\b/.test(normalized)) {
    dayShift = 2;
    explicitDay = true;
  } else if (/\b(kal|कल|tomorrow)\b/.test(normalized)) {
    dayShift = 1;
    explicitDay = true;
  } else if (/\b(aaj|आज|today|tonight)\b/.test(normalized)) {
    dayShift = 0;
    explicitDay = true;
  }

  // 3. Extract time of day
  let hour: number | null = null;
  let minute = 0;
  let matchedTime = "";

  const timePeriodMatch = normalized.match(
    /(?:(subah|morning|dopahar|afternoon|shaam|sham|evening|raat|night)\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje|बजे)?(?:\s*(subah|morning|dopahar|afternoon|shaam|sham|evening|raat|night|am|pm))?/i
  );

  // Guard: require at least a period word, `:`, `am/pm`, `baje`, or explicit day + number
  if (timePeriodMatch) {
    const beforePeriod = timePeriodMatch[1] || "";
    const rawHour = Number(timePeriodMatch[2]);
    const rawMin = timePeriodMatch[3] ? Number(timePeriodMatch[3]) : 0;
    const midUnit = timePeriodMatch[4] || "";
    const afterPeriod = timePeriodMatch[5] || "";
    const hasExplicitMarker = Boolean(beforePeriod || midUnit || afterPeriod || timePeriodMatch[3]);

    if (hasExplicitMarker && rawHour >= 0 && rawHour <= 23 && rawMin >= 0 && rawMin <= 59) {
      hour = rawHour;
      minute = rawMin;
      matchedTime = timePeriodMatch[0].trim();
      const marker = `${beforePeriod} ${midUnit} ${afterPeriod}`.toLowerCase();

      if (/\b(pm|shaam|sham|evening|dopahar|afternoon)\b/.test(marker)) {
        if (hour < 12) hour += 12;
      } else if (/\b(raat|night|tonight)\b/.test(marker) || /\btonight\b/.test(normalized)) {
        if (hour === 12) hour = 0;
        else if (hour < 12) hour += 12;
      } else if (/\b(am|subah|morning)\b/.test(marker)) {
        if (hour === 12) hour = 0;
      } else if (/\bbaje|बजे\b/.test(marker)) {
        // Default 12 baje -> 12:00 PM; small hours 1-6 without subah -> afternoon (13-18) unless future today matches
        if (hour >= 1 && hour <= 6) hour += 12;
      }
    }
  }

  if (hour === null) {
    if (!explicitDay) return null;
    // Day mentioned without clock time -> default 9:00 AM local (or 8:00 PM if "tonight/raat")
    if (/\b(raat|night|tonight)\b/.test(normalized)) {
      hour = 20;
    } else if (/\b(shaam|sham|evening)\b/.test(normalized)) {
      hour = 18;
    } else if (/\b(dopahar|afternoon)\b/.test(normalized)) {
      hour = 14;
    } else {
      hour = 9;
    }
  }

  const targetLocal = new Date(localNow.getTime());
  targetLocal.setUTCDate(targetLocal.getUTCDate() + dayShift);
  targetLocal.setUTCHours(hour, minute, 0, 0);

  // Convert back to UTC epoch
  let targetUtcMs = targetLocal.getTime() - offsetShiftMs;
  if (!explicitDay && targetUtcMs <= nowUtc) {
    targetUtcMs += 86400_000;
  }

  return { date: new Date(targetUtcMs), matchedText: matchedTime || undefined };
}

function cleanTargetName(raw: string): string {
  return raw
    .replace(/\b(ko|ke|ki|ka|se|par|pe|mein|me|to|for|with|on|call|video|voice|group|chat|message|msg)\b/gi, " ")
    .replace(/[.,!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function polishMessageContent(rawMsg: string): string {
  const m = rawMsg.trim().replace(/^["']|["']$/g, "");
  if (!m) return "";
  if (/happy birthday/i.test(m) && m.length < 32) return "Happy Birthday! 🎂🎉";
  if (/good morning/i.test(m) && m.length < 22) return "Good Morning! ☀️";
  if (/good night/i.test(m) && m.length < 20) return "Good Night! 🌙";
  if (/happy anniversary/i.test(m) && m.length < 32) return "Happy Anniversary! 🎉💐";
  return m.charAt(0).toUpperCase() + m.slice(1);
}

async function tryLlmIntentParse(
  rawText: string,
  hasPending: boolean
): Promise<Partial<ParsedIntent> | null> {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GROQ_API_KEY?.trim();
  if (!apiKey) return null;

  const systemInstruction = `Extract JSON for a chat personal assistant. Return ONLY valid JSON:
{
  "intent": "CONFIRM_PENDING|CANCEL_PENDING|SEND_MESSAGE|SCHEDULE_MESSAGE|START_CALL|CREATE_GROUP|CREATE_POLL|SET_REMINDER|TASK_CREATE|TASK_LIST|TASK_COMPLETE|UNREAD_SUMMARY|LAST_CONVERSATION|SUMMARIZE_CHAT|SEARCH_CHATS|SCHEDULED_LIST|SCHEDULED_CANCEL|GENERAL_CHAT",
  "targetName": "string or null",
  "messageBody": "string or null",
  "isVideoCall": boolean,
  "groupTitle": "string or null",
  "pollQuestion": "string or null",
  "pollOptions": ["string"] or null,
  "reminderText": "string or null",
  "taskTitle": "string or null",
  "searchQuery": "string or null",
  "chatReply": "short friendly reply in user's language if GENERAL_CHAT"
}
User hasPendingAction=${hasPending}. Text: ${JSON.stringify(rawText)}`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3800);
    try {
      if (env.GEMINI_API_KEY?.trim()) {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY.trim()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: systemInstruction }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
            }),
            signal: controller.signal,
          }
        );
        if (!res.ok) return null;
        const data = (await res.json()) as any;
        const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return txt ? JSON.parse(txt) : null;
      }

      if (env.GROQ_API_KEY?.trim()) {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.GROQ_API_KEY.trim()}`,
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: systemInstruction }],
          }),
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = (await res.json()) as any;
        const txt = data?.choices?.[0]?.message?.content;
        return txt ? JSON.parse(txt) : null;
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
  return null;
}

export async function parseUserInstruction(
  rawText: string,
  options: { tzOffsetMinutes?: number; hasPending?: boolean } = {}
): Promise<ParsedIntent> {
  const tzOffset = options.tzOffsetMinutes ?? -330;
  const hasPending = Boolean(options.hasPending);
  const { style, iso } = detectLanguageStyle(rawText);

  // Normalize non-English/non-Hindi scripts (or Devanagari Hindi) into Romanized/English for deterministic rules
  let textForRules = rawText.trim();
  let detectedIso = iso;
  if (style === "hi" || style === "other") {
    const tr = await translateAny(textForRules, style === "hi" ? "hi" : "auto", "en");
    if (tr?.translatedText) {
      textForRules = tr.translatedText;
      if (tr.detectedLang && style === "other") detectedIso = tr.detectedLang;
    }
  }

  const clean = textForRules.trim();
  const lower = clean.toLowerCase();

  // 1. Voice / Text confirmation when an action card is waiting
  if (hasPending) {
    if (/^(haan|han|ha|yes|yeah|yep|ok|okay|theek hai|thik hai|confirm|kar do|kardo|bhej do|send|send it|chalo|ji|bilkul)\b[.!]*$/i.test(lower)) {
      return { intent: "CONFIRM_PENDING", replyStyle: style, replyIso: detectedIso };
    }
    if (/^(nahi|nhi|na|no|nope|cancel|mat karo|stop|rehne do|chhodo)\b[.!]*$/i.test(lower)) {
      return { intent: "CANCEL_PENDING", replyStyle: style, replyIso: detectedIso };
    }
  }

  // 2. Scheduled list / cancel
  if (
    /\b(cancel|delete|remove|hata|hatao|rok)\b.*\b(schedule|scheduled|reminder|message)\b/i.test(lower) ||
    /\bscheduled\b.*\b(cancel|hata|delete)\b/i.test(lower)
  ) {
    const targetM = clean.match(/\b(?:to|for|ko)\s+([a-z0-9_ ]{2,25})/i);
    return {
      intent: "SCHEDULED_CANCEL",
      replyStyle: style,
      replyIso: detectedIso,
      targetName: targetM ? cleanTargetName(targetM[1]) : undefined,
    };
  }

  if (
    /\b(show|list|view|dikhao|dikha|batao|btao|check|mere|my)\b.*\b(scheduled|schedule|upcoming reminder|reminders)\b/i.test(lower) ||
    /^(scheduled|reminders|upcoming reminders)$/i.test(lower)
  ) {
    return { intent: "SCHEDULED_LIST", replyStyle: style, replyIso: detectedIso };
  }

  // 3. Unread summary
  if (/\b(unread|nahi padha|bin padhe|new messages|missed messages)\b/i.test(lower)) {
    return { intent: "UNREAD_SUMMARY", replyStyle: style, replyIso: detectedIso };
  }

  // 4. Tasks create / complete / list
  if (/\b(complete|done|finish|mark|poora|pura)\b.*\btask\b/i.test(lower) || /\btask\b.*\b(complete|done|finish|khatam)\b/i.test(lower)) {
    const title = clean
      .replace(/\b(complete|done|finish|mark|as|the|my|wala|wali|task|karo|kar do|kardo)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { intent: "TASK_COMPLETE", replyStyle: style, replyIso: detectedIso, taskTitle: title || undefined };
  }

  if (/\b(show|list|view|dikhao|batao|my|mere|pending)\b.*\b(tasks|todo|to-do)\b/i.test(lower) || /^(tasks|my tasks|todo)$/i.test(lower)) {
    return { intent: "TASK_LIST", replyStyle: style, replyIso: detectedIso };
  }

  if (/\b(add|create|new|bana|banao|likh|set)\b.*\b(task|todo|to-do)\b/i.test(lower) || /^task\s*[:\-]/i.test(lower)) {
    const title = clean
      .replace(/^(please\s+)?(add|create|new|set|bana|banao|karo|ek)?\s*(a\s+)?(new\s+)?(task|todo|to-do)\s*[:\-]?\s*(karo|kar do|banao)?\s*[:\-]?\s*/i, "")
      .replace(/\b(karo|kar do|kardo|banao|dena)\b[.!]*$/i, "")
      .trim();
    return { intent: "TASK_CREATE", replyStyle: style, replyIso: detectedIso, taskTitle: title || "New Task" };
  }

  // 5. Polls: "Cricket group mein poll create karo", "Create a poll in Group..."
  if (/\bpoll\b/i.test(lower)) {
    let targetName: string | undefined;
    let pollQuestion = "";
    let pollOptions: string[] = [];

    const grpMatch = clean.match(/([a-z0-9_ ]{2,30}?)\s+(?:group|grp|chat)\s+(?:mein|me|in)\s+/i) ||
      clean.match(/\b(?:in|mein|me)\s+([a-z0-9_ ]{2,30}?)\s+(?:group|grp)/i);
    if (grpMatch) targetName = cleanTargetName(grpMatch[1]);

    const colonIdx = clean.indexOf(":");
    if (colonIdx !== -1) {
      const rest = clean.slice(colonIdx + 1).trim();
      const qSplit = rest.split("?");
      if (qSplit.length > 1) {
        pollQuestion = `${qSplit[0].trim()}?`;
        const optPart = qSplit.slice(1).join("?").trim();
        pollOptions = optPart.split(/,|\bor\b|\bya\b|\//i).map((o) => o.trim()).filter(Boolean);
      } else {
        pollQuestion = rest;
      }
    }

    const parsedDt = parseNaturalDateTime(clean, tzOffset);

    return {
      intent: "CREATE_POLL",
      replyStyle: style,
      replyIso: detectedIso,
      targetName,
      pollQuestion: pollQuestion || undefined,
      pollOptions: pollOptions.length >= 2 ? pollOptions : undefined,
      scheduledForIso: parsedDt ? parsedDt.date.toISOString() : undefined,
    };
  }

  // 6. Create Group: "Cricket ka group bana do", "Create a group named Project with Rahul and Amit"
  if (/\bgroup\b/i.test(lower) && /\b(bana|banao|create|make|start|new)\b/i.test(lower) && !/\bcall\b|\bpoll\b|\bmessage\b|\bsend\b/i.test(lower)) {
    let groupTitle = "";
    const hindiMatch = clean.match(/^(.+?)\s+(?:ka|ki|ke|naam ka|name ka)\s+group/i);
    const engMatch = clean.match(/group\s+(?:named|called|name)?\s*["']?([^"']+?)["']?(?:\s+with\s+(.+))?$/i);
    const memberNames: string[] = [];

    if (hindiMatch) {
      groupTitle = hindiMatch[1].replace(/\b(ek|naya|new)\b/gi, "").trim();
    } else if (engMatch) {
      groupTitle = engMatch[1].trim();
      if (engMatch[2]) {
        engMatch[2]
          .split(/,|\band\b|\baur\b/i)
          .map((n) => cleanTargetName(n))
          .filter(Boolean)
          .forEach((n) => memberNames.push(n));
      }
    }

    return {
      intent: "CREATE_GROUP",
      replyStyle: style,
      replyIso: detectedIso,
      groupTitle: groupTitle ? groupTitle.charAt(0).toUpperCase() + groupTitle.slice(1) : "New Group",
      memberNames: memberNames.length ? memberNames : undefined,
    };
  }

  // 7. Calls (Voice & Video): "Mummy ko call laga do", "Rahul ko video call karo", "Call Amit"
  if (/\b(call|calling|phone|ring)\b/i.test(lower) && !/\bremind|yaad\b/i.test(lower)) {
    const isVideoCall = /\b(video|vid|camera)\b/i.test(lower);
    let targetName = "";

    const hindiCall = clean.match(/^(.+?)\s+ko\s+(?:video\s+|voice\s+|audio\s+)?call/i);
    const engCall = clean.match(/\b(?:video\s+|voice\s+|audio\s+)?call\s+(?:to\s+)?([a-z0-9_ ]{2,35})$/i);

    if (hindiCall) {
      targetName = cleanTargetName(hindiCall[1]);
    } else if (engCall) {
      targetName = cleanTargetName(engCall[1]);
    }

    if (targetName) {
      return {
        intent: "START_CALL",
        replyStyle: style,
        replyIso: detectedIso,
        targetName,
        isVideoCall,
      };
    }
  }

  // 8. Summarize / Last conversation / Search chats
  if (/\b(summarize|summary|saransh|saar|short me|brief)\b/i.test(lower)) {
    const m =
      clean.match(/(.+?)\s+(?:ki|ke|ka)\s+chat/i) ||
      clean.match(/summarize\s+(?:chat\s+(?:with\s+)?|group\s+)?([a-z0-9_ ]{2,35})/i);
    return {
      intent: "SUMMARIZE_CHAT",
      replyStyle: style,
      replyIso: detectedIso,
      targetName: m ? cleanTargetName(m[1]) : undefined,
    };
  }

  if (/\b(last conversation|last chat|last message|pichli baat|pichla message|recent chat)\b/i.test(lower)) {
    const m =
      clean.match(/(.+?)\s+(?:ke saath|ke sath|ki|ka)\s+last/i) ||
      clean.match(/\bwith\s+([a-z0-9_ ]{2,35})/i);
    return {
      intent: "LAST_CONVERSATION",
      replyStyle: style,
      replyIso: detectedIso,
      targetName: m ? cleanTargetName(m[1]) : undefined,
    };
  }

  if (/\b(search|find|dhundo|khojo)\b.*\b(chat|chats|conversation|messages|message)\b/i.test(lower)) {
    const qMatch = clean.match(/\b(?:for|about|mein|me)\s+["']?(.+?)["']?$/i) || clean.match(/search\s+(.+)/i);
    return {
      intent: "SEARCH_CHATS",
      replyStyle: style,
      replyIso: detectedIso,
      searchQuery: qMatch ? qMatch[1].replace(/\b(chats?|messages?|conversations?)\b/gi, "").trim() : undefined,
    };
  }

  // 9. Reminders: "Mujhe kal subah 9 baje yaad dila dena", "Remind me tomorrow 5pm..."
  if (/\b(remind|reminder|yaad dila|yaad dilana|yaad krwa|yad dila)\b/i.test(lower)) {
    const parsedDt = parseNaturalDateTime(clean, tzOffset);
    let remText = clean
      .replace(/^(mujhe|mujhko|me|please|plz|ek)?\s*/gi, "")
      .replace(/\b(remind\s+me|reminder|yaad\s+dila\s+dena|yaad\s+dila\s+do|yaad\s+dilana|yaad\s+dila|set\s+a?\s*reminder|lagao|laga\s+do)\b/gi, " ")
      .replace(/\b(kal|aaj|parso|tomorrow|today|tonight|subah|morning|dopahar|afternoon|shaam|evening|raat|night|baje|am|pm)\b/gi, " ")
      .replace(/\b\d{1,2}(:\d{2})?\b/g, " ")
      .replace(/\b(\d+\s*(?:min|mins|minute|minutes|hour|hours|hr|ghante)\s*(?:baad|later|after|in)?)\b/gi, " ")
      .replace(/\b(ke liye|to|that|ki|for|ka)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!remText || remText.length < 2) {
      remText = style === "hinglish" || style === "hi" ? "Aapka scheduled reminder" : "Your scheduled reminder";
    }

    return {
      intent: "SET_REMINDER",
      replyStyle: style,
      replyIso: detectedIso,
      reminderText: remText.charAt(0).toUpperCase() + remText.slice(1),
      scheduledForIso: parsedDt ? parsedDt.date.toISOString() : undefined,
    };
  }

  // 10. Send OR Schedule Message:
  // Examples:
  // - "Rahul ko happy birthday wish kar do"
  // - "Kal 12 baje Amit ko message bhej dena"
  // - "Send good morning to Rahul"
  // - "Amit ko likho Kal milte hain"
  const parsedDt = parseNaturalDateTime(clean, tzOffset);
  const looksLikeSend =
    /\b(wish|send|message|msg|bhej|bhejo|bhejdo|bhejna|bol|bolo|likh|likho|text)\b/i.test(lower) ||
    /^[a-z0-9_ ]{2,25}\s+ko\s+.+\s+(?:kar do|kardo|bol do|boldo|de do|dedo)$/i.test(lower);

  if (looksLikeSend) {
    let targetName = "";
    let body = "";

    // Pattern A: "<Name> ko <message> (wish|bhej|bol|likh) ..."
    const hindiPat = clean.match(
      /(?:^|baje\s+|tomorrow\s+|kal\s+|today\s+|aaj\s+|pm\s+|am\s+|baad\s+)([a-z0-9_ ]{2,28}?)\s+ko\s+(.*)$/i
    ) || clean.match(/^([a-z0-9_ ]{2,28}?)\s+ko\s+(.*)$/i);

    if (hindiPat) {
      // Remove any leading time words from captured targetName (e.g. "Kal 12 baje Amit" -> "Amit")
      targetName = cleanTargetName(
        hindiPat[1]
          .replace(/\b(kal|aaj|parso|subah|shaam|raat|dopahar|today|tomorrow|baje|am|pm)\b/gi, " ")
          .replace(/\b\d{1,2}(:\d{2})?\b/g, " ")
      );
      body = hindiPat[2]
        .replace(/\b(message|msg|txt|text)?\s*(wish\s+kar\s+do|wish\s+kardo|wish\s+karo|wish|bhej\s+dena|bhej\s+do|bhejdo|bhejo|bhejna|bol\s+do|boldo|kar\s+do|kardo|send\s+kar\s+do|likh\s+do)\b[.!]*$/i, "")
        .replace(/^(ki|likho|bol|saying|that)\s+/i, "")
        .trim();
    } else {
      // Pattern B: English "Send <msg> to <Name>" or "Message <Name> saying <msg>"
      const engSend = clean.match(
        /\b(?:send|text|message|wish)\s+(?:a\s+message\s+)?(?:to\s+)?([a-z0-9_]{2,25})(?:\s+(?:saying|that|:)\s*|\s+)(.+)$/i
      );
      const engTo = clean.match(/\b(?:send|wish)\s+["']?(.+?)["']?\s+to\s+([a-z0-9_ ]{2,28})$/i);
      if (engTo) {
        body = engTo[1].trim();
        targetName = cleanTargetName(engTo[2]);
      } else if (engSend) {
        targetName = cleanTargetName(engSend[1]);
        body = engSend[2]
          .replace(/\b(in\s+\d+\s*(?:min|minute|minutes|hour|hours)|tomorrow|today|at\s+\d+(?::\d+)?\s*(?:am|pm)?)\b/gi, "")
          .trim();
      }
    }

    // Group messaging: "Cricket group mein likho hello"
    if (!targetName) {
      const grpSend = clean.match(/([a-z0-9_ ]{2,30}?)\s+group\s+(?:mein|me|in)\s+(?:likho|bhejo|send|say|message)\s*[:\-]?\s*(.*)$/i);
      if (grpSend) {
        targetName = grpSend[1].trim();
        body = grpSend[2].trim();
      }
    }

    // Clean leftover filler if user only said "message bhej dena" without content
    if (/^(ek\s+)?(message|msg|hello)?\s*$/i.test(body) && /^message|msg$/i.test(body)) {
      body = "";
    }

    if (targetName) {
      return {
        intent: parsedDt ? "SCHEDULE_MESSAGE" : "SEND_MESSAGE",
        replyStyle: style,
        replyIso: detectedIso,
        targetName,
        messageBody: body ? polishMessageContent(body) : undefined,
        scheduledForIso: parsedDt ? parsedDt.date.toISOString() : undefined,
      };
    }
  }

  // 11. Optional LLM enhancement for tricky/unmatched phrases
  const llm = await tryLlmIntentParse(rawText, hasPending);
  if (llm && llm.intent) {
    return {
      intent: llm.intent,
      replyStyle: style,
      replyIso: detectedIso,
      targetName: llm.targetName || undefined,
      messageBody: llm.messageBody ? polishMessageContent(llm.messageBody) : undefined,
      scheduledForIso: parsedDt ? parsedDt.date.toISOString() : undefined,
      isVideoCall: Boolean(llm.isVideoCall),
      groupTitle: llm.groupTitle || undefined,
      pollQuestion: llm.pollQuestion || undefined,
      pollOptions: Array.isArray(llm.pollOptions) ? llm.pollOptions : undefined,
      reminderText: llm.reminderText || undefined,
      taskTitle: llm.taskTitle || undefined,
      searchQuery: llm.searchQuery || undefined,
      chatReply: llm.chatReply || undefined,
    };
  }

  return {
    intent: "GENERAL_CHAT",
    replyStyle: style,
    replyIso: detectedIso,
  };
}
