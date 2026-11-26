import { Request, Response } from "express";
import crypto from "node:crypto";
import { AssistantTaskStatus, ConversationType, MemberRole, ScheduledActionStatus, ScheduledActionType } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { HttpError } from "../../utils/http-error";
import { io, isUserOnline } from "../../sockets/socket";
import { translateAny } from "../../utils/translator";
import { createPollMessage, pollInclude } from "../polls/polls.controller";
import { ParsedIntent, parseUserInstruction, pickText } from "./ai.nlu";

interface CandidateTarget {
  kind: "USER" | "GROUP";
  userId?: string;
  conversationId?: string;
  label: string;
  sublabel?: string;
  avatarUrl?: string | null;
  isOnline?: boolean;
}

async function resolveCandidates(myUserId: string, query: string, filterKind?: "USER" | "GROUP"): Promise<CandidateTarget[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const convs = await prisma.conversation.findMany({
    where: { members: { some: { userId: myUserId } } },
    include: {
      members: {
        include: {
          user: {
            select: { id: true, username: true, displayName: true, avatarUrl: true, isActive: true },
          },
        },
      },
    },
  });

  const scored = new Map<string, { item: CandidateTarget; score: number }>();

  for (const c of convs) {
    if (c.type === "GROUP" && filterKind !== "USER") {
      const title = (c.title || "").trim();
      const lower = title.toLowerCase();
      let score = 0;
      if (lower === q) score = 100;
      else if (lower.startsWith(q)) score = 80;
      else if (lower.includes(q)) score = 60;
      if (score > 0) {
        scored.set(`group:${c.id}`, {
          score,
          item: {
            kind: "GROUP",
            conversationId: c.id,
            label: title || "Group Chat",
            sublabel: `${c.members.length} members`,
          },
        });
      }
    } else if (c.type === "DIRECT" && filterKind !== "GROUP") {
      const other = c.members.find((m) => m.userId !== myUserId)?.user;
      if (other && other.isActive) {
        const dn = (other.displayName || "").toLowerCase();
        const un = other.username.toLowerCase();
        let score = 0;
        if (dn === q || un === q) score = 100;
        else if (dn.startsWith(q) || un.startsWith(q)) score = 85;
        else if (dn.includes(q) || un.includes(q)) score = 65;
        if (score > 0) {
          scored.set(`user:${other.id}`, {
            score,
            item: {
              kind: "USER",
              userId: other.id,
              conversationId: c.id,
              label: other.displayName || other.username,
              sublabel: `@${other.username}`,
              avatarUrl: other.avatarUrl,
              isOnline: isUserOnline(other.id),
            },
          });
        }
      }
    }
  }

  // Also search registered directory users if not already matched
  if (filterKind !== "GROUP") {
    const dirUsers = await prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: myUserId },
        OR: [
          { displayName: { contains: query, mode: "insensitive" } },
          { username: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, username: true, displayName: true, avatarUrl: true },
      take: 8,
    });

    for (const u of dirUsers) {
      if (scored.has(`user:${u.id}`)) continue;
      const dn = u.displayName.toLowerCase();
      const un = u.username.toLowerCase();
      let score = 50;
      if (dn === q || un === q) score = 90;
      else if (dn.startsWith(q) || un.startsWith(q)) score = 75;
      scored.set(`user:${u.id}`, {
        score,
        item: {
          kind: "USER",
          userId: u.id,
          label: u.displayName || u.username,
          sublabel: `@${u.username}`,
          avatarUrl: u.avatarUrl,
          isOnline: isUserOnline(u.id),
        },
      });
    }
  }

  const list = Array.from(scored.values()).sort((a, b) => b.score - a.score);
  if (list.length === 0) return [];

  // Keep top exact match uniquely if strictly higher score than runner-up
  if (list.length > 1 && list[0].score === 100 && list[1].score < 100) {
    return [list[0].item];
  }
  return list.slice(0, 6).map((x) => x.item);
}

async function formatLocalized(parsed: ParsedIntent, variants: { en: string; hinglish: string; hi?: string }): Promise<string> {
  const base = pickText(parsed.replyStyle, variants);
  if (parsed.replyStyle === "other" && parsed.replyIso && parsed.replyIso !== "en" && parsed.replyIso !== "auto") {
    const tr = await translateAny(variants.en, "en", parsed.replyIso);
    if (tr?.translatedText) return tr.translatedText;
  }
  return base;
}

async function getUserGroups(userId: string) {
  const rows = await prisma.conversation.findMany({
    where: { type: "GROUP", members: { some: { userId } } },
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: { id: true, title: true, _count: { select: { members: true } } },
  });
  return rows.map((g) => ({
    kind: "GROUP" as const,
    conversationId: g.id,
    label: g.title || "Group Chat",
    sublabel: `${g._count.members} members`,
  }));
}

async function getUserContacts(userId: string) {
  const rows = await prisma.conversation.findMany({
    where: { type: "DIRECT", members: { some: { userId } } },
    orderBy: { updatedAt: "desc" },
    take: 15,
    include: {
      members: {
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isActive: true } },
        },
      },
    },
  });
  const contacts: CandidateTarget[] = [];
  for (const c of rows) {
    const other = c.members.find((m) => m.userId !== userId)?.user;
    if (other && other.isActive) {
      contacts.push({
        kind: "USER",
        userId: other.id,
        conversationId: c.id,
        label: other.displayName || other.username,
        sublabel: `@${other.username}`,
        avatarUrl: other.avatarUrl,
        isOnline: isUserOnline(other.id),
      });
    }
  }
  return contacts;
}

async function fetchAssistantState(userId: string) {
  const [messages, tasks, scheduledActions, recentConvs] = await Promise.all([
    prisma.assistantMessage.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      take: 60,
    }),
    prisma.assistantTask.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 30,
    }),
    prisma.scheduledAction.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { scheduledFor: "asc" }],
      take: 30,
    }),
    prisma.conversation.findMany({
      where: { members: { some: { userId } } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: {
        members: { include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
  ]);

  const recentConversations = recentConvs.map((c) => {
    const other = c.type === "DIRECT" ? c.members.find((m) => m.userId !== userId)?.user : undefined;
    return {
      id: c.id,
      type: c.type,
      title: c.type === "GROUP" ? c.title || "Group Chat" : other?.displayName || other?.username || "Chat",
      avatarUrl: other?.avatarUrl || null,
      lastMessageBody: c.messages[0]?.body || (c.messages[0] ? "Attachment" : "No messages yet"),
      updatedAt: c.updatedAt,
    };
  });

  return { messages, tasks, scheduledActions, recentConversations };
}

export async function getState(req: Request, res: Response) {
  const state = await fetchAssistantState(req.auth!.userId);
  res.json({ success: true, ...state });
}

export async function clearHistory(req: Request, res: Response) {
  await prisma.assistantMessage.deleteMany({ where: { userId: req.auth!.userId } });
  const state = await fetchAssistantState(req.auth!.userId);
  res.json({ success: true, ...state });
}

async function executePendingMetadata(params: {
  userId: string;
  action: Record<string, any>;
  overrides?: Record<string, any>;
}): Promise<{
  ok: boolean;
  summaryText: string;
  updatedAction: Record<string, any>;
  callTrigger?: { conversationId: string; otherUser: any; isVideo: boolean };
  createdConversationId?: string;
}> {
  const { userId, action, overrides = {} } = params;
  const type = String(action.type);
  const now = new Date();

  if (type === "SEND_MESSAGE") {
    const body = String(overrides.body ?? action.body ?? "").trim();
    if (!body) {
      return {
        ok: false,
        summaryText: "Message text cannot be empty. Type what you want to send.",
        updatedAction: { ...action, status: "PENDING" },
      };
    }

    let convId = overrides.targetConversationId ?? action.targetConversationId;
    const targetUserId = overrides.targetUserId ?? action.targetUserId;
    const targetLabel = overrides.targetLabel ?? action.targetLabel ?? "contact";

    if (targetUserId) {
      const blocked = await prisma.userBlock.findFirst({
        where: {
          OR: [
            { blockerId: userId, blockedId: targetUserId },
            { blockerId: targetUserId, blockedId: userId },
          ],
        },
      });
      if (blocked) {
        return {
          ok: false,
          summaryText: `Could not send message to ${targetLabel} because one account has blocked the other.`,
          updatedAction: { ...action, status: "FAILED" },
        };
      }
      if (!convId) {
        const existing = await prisma.conversation.findFirst({
          where: {
            type: ConversationType.DIRECT,
            AND: [{ members: { some: { userId } } }, { members: { some: { userId: targetUserId } } }],
          },
          select: { id: true },
        });
        if (existing) {
          convId = existing.id;
        } else {
          const created = await prisma.conversation.create({
            data: {
              type: ConversationType.DIRECT,
              members: { create: [{ userId, role: MemberRole.OWNER }, { userId: targetUserId }] },
            },
            select: { id: true },
          });
          convId = created.id;
        }
      }
    }

    if (!convId) {
      return {
        ok: false,
        summaryText: "Please select a recipient before sending.",
        updatedAction: { ...action, status: "PENDING" },
      };
    }

    const members = await prisma.conversationMember.findMany({
      where: { conversationId: convId },
      select: { userId: true },
    });
    if (!members.some((m) => m.userId === userId)) {
      return {
        ok: false,
        summaryText: "You are not a member of that conversation.",
        updatedAction: { ...action, status: "FAILED" },
      };
    }

    const msg = await prisma.message.create({
      data: {
        conversationId: convId,
        senderId: userId,
        body,
        type: "TEXT",
        receipts: { create: members.filter((m) => m.userId !== userId).map((m) => ({ userId: m.userId })) },
      },
      include: {
        sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        receipts: true,
        attachments: true,
        poll: { include: pollInclude },
      },
    });

    await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: now } });

    if (io) {
      for (const m of members) {
        io.to(`user:${m.userId}`).emit("message:new", msg);
        io.to(`user:${m.userId}`).emit("conversation:updated", { conversationId: convId, lastMessage: msg });
      }
    }

    return {
      ok: true,
      summaryText: `Message sent to ${targetLabel}: "${body}"`,
      updatedAction: {
        ...action,
        body,
        targetConversationId: convId,
        targetUserId,
        targetLabel,
        status: "CONFIRMED",
      },
    };
  }

  if (type === "SCHEDULE_MESSAGE" || type === "SET_REMINDER") {
    const iso = String(overrides.scheduledForIso ?? action.scheduledForIso ?? "");
    const scheduledDate = iso ? new Date(iso) : null;
    if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
      return {
        ok: false,
        summaryText: "Please pick a valid future date and time.",
        updatedAction: { ...action, status: "PENDING" },
      };
    }

    if (type === "SCHEDULE_MESSAGE") {
      const body = String(overrides.body ?? action.body ?? "").trim();
      const targetUserId = overrides.targetUserId ?? action.targetUserId;
      const targetConversationId = overrides.targetConversationId ?? action.targetConversationId;
      const targetLabel = overrides.targetLabel ?? action.targetLabel ?? "contact";
      if (!body) {
        return {
          ok: false,
          summaryText: "Please enter the message text you want to schedule.",
          updatedAction: { ...action, status: "PENDING" },
        };
      }
      if (!targetUserId && !targetConversationId) {
        return {
          ok: false,
          summaryText: "Please select a recipient first.",
          updatedAction: { ...action, status: "PENDING" },
        };
      }

      const job = await prisma.scheduledAction.create({
        data: {
          userId,
          type: ScheduledActionType.SEND_MESSAGE,
          scheduledFor: scheduledDate,
          targetUserId: targetUserId || null,
          targetConversationId: targetConversationId || null,
          targetLabel,
          payload: { body, language: action.language || "en" },
        },
      });

      return {
        ok: true,
        summaryText: `Scheduled message to ${targetLabel} for ${scheduledDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}: "${body}"`,
        updatedAction: { ...action, body, scheduledForIso: scheduledDate.toISOString(), scheduledActionId: job.id, status: "CONFIRMED" },
      };
    }

    const reminderText = String(overrides.reminderText ?? action.reminderText ?? "").trim() || "Reminder";
    const job = await prisma.scheduledAction.create({
      data: {
        userId,
        type: ScheduledActionType.REMINDER,
        scheduledFor: scheduledDate,
        targetLabel: reminderText,
        payload: { text: reminderText, language: action.language || "en" },
      },
    });

    return {
      ok: true,
      summaryText: `Reminder set for ${scheduledDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}: "${reminderText}"`,
      updatedAction: { ...action, reminderText, scheduledForIso: scheduledDate.toISOString(), scheduledActionId: job.id, status: "CONFIRMED" },
    };
  }

  if (type === "START_CALL") {
    const targetUserId = String(overrides.targetUserId ?? action.targetUserId ?? "");
    const targetLabel = String(overrides.targetLabel ?? action.targetLabel ?? "contact");
    const isVideo = Boolean(overrides.isVideo ?? action.isVideo);

    if (!targetUserId) {
      return {
        ok: false,
        summaryText: "Please choose the contact to call.",
        updatedAction: { ...action, status: "PENDING" },
      };
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, username: true, displayName: true, avatarUrl: true, isActive: true },
    });
    if (!target || !target.isActive) {
      return {
        ok: false,
        summaryText: `${targetLabel} could not be reached (account inactive or not found).`,
        updatedAction: { ...action, status: "FAILED" },
      };
    }

    const blocked = await prisma.userBlock.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: targetUserId },
          { blockerId: targetUserId, blockedId: userId },
        ],
      },
    });
    if (blocked) {
      return {
        ok: false,
        summaryText: `Cannot place a call to ${targetLabel} due to block settings.`,
        updatedAction: { ...action, status: "FAILED" },
      };
    }

    const targetOnline = isUserOnline(targetUserId);
    if (!targetOnline && !overrides.allowOfflineCall) {
      return {
        ok: false,
        summaryText: `${target.displayName || target.username} is currently offline / unavailable to answer right now.`,
        updatedAction: { ...action, targetUserId, targetLabel: target.displayName || target.username, isTargetOnline: false, status: "PENDING" },
      };
    }

    let convId = overrides.targetConversationId ?? action.targetConversationId;
    if (!convId) {
      const existing = await prisma.conversation.findFirst({
        where: {
          type: ConversationType.DIRECT,
          AND: [{ members: { some: { userId } } }, { members: { some: { userId: targetUserId } } }],
        },
        select: { id: true },
      });
      if (existing) convId = existing.id;
      else {
        const created = await prisma.conversation.create({
          data: { type: ConversationType.DIRECT, members: { create: [{ userId, role: MemberRole.OWNER }, { userId: targetUserId }] } },
          select: { id: true },
        });
        convId = created.id;
      }
    }

    return {
      ok: true,
      summaryText: `Starting ${isVideo ? "video" : "voice"} call with ${target.displayName || target.username}...`,
      updatedAction: { ...action, targetUserId, targetConversationId: convId, isVideo, status: "CONFIRMED" },
      callTrigger: {
        conversationId: convId,
        otherUser: { id: target.id, username: target.username, displayName: target.displayName, avatarUrl: target.avatarUrl },
        isVideo,
      },
    };
  }

  if (type === "CREATE_GROUP") {
    const title = String(overrides.groupTitle ?? action.groupTitle ?? "").trim();
    const rawMembers = Array.isArray(overrides.memberIds ?? action.memberIds) ? (overrides.memberIds ?? action.memberIds) : [];
    const memberIds = [...new Set([userId, ...rawMembers.map(String)])];
    if (!title) {
      return { ok: false, summaryText: "Group title is required.", updatedAction: { ...action, status: "PENDING" } };
    }
    if (memberIds.length < 2) {
      return {
        ok: false,
        summaryText: "Select at least 1 member to create the group.",
        updatedAction: { ...action, status: "PENDING" },
      };
    }

    const conv = await prisma.conversation.create({
      data: {
        type: ConversationType.GROUP,
        title,
        members: { create: memberIds.map((id) => ({ userId: id, role: id === userId ? MemberRole.OWNER : MemberRole.MEMBER })) },
      },
    });

    if (io) {
      for (const mId of memberIds) {
        io.to(`user:${mId}`).emit("conversation:updated", { conversationId: conv.id });
      }
    }

    return {
      ok: true,
      summaryText: `Group "${title}" created with ${memberIds.length} members!`,
      updatedAction: { ...action, groupTitle: title, createdConversationId: conv.id, status: "CONFIRMED" },
      createdConversationId: conv.id,
    };
  }

  if (type === "CREATE_POLL") {
    const convId = String(overrides.targetConversationId ?? action.targetConversationId ?? "");
    const question = String(overrides.question ?? action.question ?? "").trim();
    const rawOptions = Array.isArray(overrides.options ?? action.options) ? (overrides.options ?? action.options) : [];
    const cleanOptions = rawOptions.map((o: any) => String(o).trim()).filter(Boolean);

    if (!convId) {
      return { ok: false, summaryText: "Please select which group/chat to post this poll in.", updatedAction: { ...action, status: "PENDING" } };
    }
    if (!question || cleanOptions.length < 2) {
      return { ok: false, summaryText: "Please provide a poll question and at least 2 options.", updatedAction: { ...action, status: "PENDING" } };
    }

    const msg = await createPollMessage({
      conversationId: convId,
      creatorId: userId,
      question,
      options: cleanOptions,
      allowMultiple: Boolean(overrides.allowMultiple ?? action.allowMultiple),
    });

    return {
      ok: true,
      summaryText: `Poll created in ${action.targetLabel || "chat"}: "${question}"`,
      updatedAction: { ...action, targetConversationId: convId, question, options: cleanOptions, createdMessageId: msg.id, status: "CONFIRMED" },
    };
  }

  if (type === "CANCEL_SCHEDULED") {
    const id = String(overrides.scheduledActionId ?? action.scheduledActionId ?? "");
    if (!id) {
      return { ok: false, summaryText: "Select which scheduled action to cancel.", updatedAction: { ...action, status: "PENDING" } };
    }
    const existing = await prisma.scheduledAction.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) {
      return { ok: false, summaryText: "Scheduled action not found.", updatedAction: { ...action, status: "FAILED" } };
    }
    if (existing.status !== ScheduledActionStatus.PENDING) {
      return {
        ok: false,
        summaryText: `Cannot cancel because this item is already ${existing.status}.`,
        updatedAction: { ...action, status: "FAILED" },
      };
    }
    await prisma.scheduledAction.update({
      where: { id },
      data: { status: ScheduledActionStatus.CANCELLED, resultMessage: "Cancelled by user" },
    });
    return {
      ok: true,
      summaryText: `Cancelled scheduled ${existing.type === "REMINDER" ? "reminder" : "message"} (${existing.targetLabel || ""}).`,
      updatedAction: { ...action, status: "CONFIRMED" },
    };
  }

  return { ok: false, summaryText: "Unsupported action.", updatedAction: { ...action, status: "FAILED" } };
}

export async function handleCommand(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const text = String(req.body.text || "").trim();
  const tzOffsetMinutes = typeof req.body.tzOffsetMinutes === "number" ? req.body.tzOffsetMinutes : -330;

  if (!text) throw new HttpError(400, "Instruction text is required");

  // Check if there is an active unconfirmed pendingAction from last turn
  const recentMsgs = await prisma.assistantMessage.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const latestPendingMsg = recentMsgs.find((m) => {
    const meta = m.metadata as any;
    return m.role === "assistant" && meta?.pendingAction?.status === "PENDING";
  });

  const userMsg = await prisma.assistantMessage.create({
    data: { userId, role: "user", content: text },
  });

  const parsed = await parseUserInstruction(text, {
    tzOffsetMinutes,
    hasPending: Boolean(latestPendingMsg),
  });

  let replyContent = "";
  let metadata: Record<string, any> = {};
  let callTrigger: any = undefined;
  let createdConversationId: string | undefined = undefined;

  // Handle voice/text Confirm or Cancel for pending action
  if (parsed.intent === "CONFIRM_PENDING" && latestPendingMsg) {
    const prevMeta = (latestPendingMsg.metadata || {}) as Record<string, any>;
    const outcome = await executePendingMetadata({ userId, action: prevMeta.pendingAction });
    await prisma.assistantMessage.update({
      where: { id: latestPendingMsg.id },
      data: { metadata: { ...prevMeta, pendingAction: outcome.updatedAction } },
    });
    replyContent = outcome.summaryText;
    callTrigger = outcome.callTrigger;
    createdConversationId = outcome.createdConversationId;
    metadata = { executedResult: { ok: outcome.ok, text: outcome.summaryText } };
  } else if (parsed.intent === "CANCEL_PENDING" && latestPendingMsg) {
    const prevMeta = (latestPendingMsg.metadata || {}) as Record<string, any>;
    await prisma.assistantMessage.update({
      where: { id: latestPendingMsg.id },
      data: { metadata: { ...prevMeta, pendingAction: { ...prevMeta.pendingAction, status: "CANCELLED" } } },
    });
    replyContent = await formatLocalized(parsed, {
      en: "Okay, I cancelled that action.",
      hinglish: "Theek hai, maine wo action cancel kar diya.",
      hi: "ठीक है, मैंने वह काम रद्द कर दिया है।",
    });
  } else if (parsed.intent === "UNREAD_SUMMARY") {
    const unreadReceipts = await prisma.messageReceipt.findMany({
      where: {
        userId,
        readAt: null,
        message: { deletedAt: null, senderId: { not: userId }, type: { not: "SYSTEM" } },
      },
      include: {
        message: {
          include: {
            sender: { select: { id: true, displayName: true, username: true } },
            conversation: { select: { id: true, type: true, title: true } },
          },
        },
      },
      orderBy: { message: { createdAt: "desc" } },
      take: 50,
    });

    if (unreadReceipts.length === 0) {
      replyContent = await formatLocalized(parsed, {
        en: "You're all caught up! You have 0 unread messages right now.",
        hinglish: "Aapke paas abhi koi unread message nahi hai — sab read ho chuka hai!",
        hi: "आपके पास अभी कोई अनपढ़ा संदेश नहीं है — सब कुछ पढ़ लिया गया है!",
      });
    } else {
      const grouped = new Map<string, { conversationId: string; title: string; count: number; latest: string }>();
      for (const r of unreadReceipts) {
        const cId = r.message.conversationId;
        const convTitle =
          r.message.conversation.type === "GROUP"
            ? r.message.conversation.title || "Group"
            : r.message.sender.displayName || r.message.sender.username;
        const cur = grouped.get(cId);
        const snippet = r.message.body || "Shared a file/photo";
        if (!cur) grouped.set(cId, { conversationId: cId, title: convTitle, count: 1, latest: snippet });
        else cur.count += 1;
      }
      const items = Array.from(grouped.values());
      const lines = items.map((i) => `• ${i.title} (${i.count}): "${i.latest.slice(0, 60)}"`).join("\n");
      replyContent = await formatLocalized(parsed, {
        en: `You have ${unreadReceipts.length} unread messages across ${items.length} chats:\n${lines}`,
        hinglish: `Aapke ${items.length} chats mein total ${unreadReceipts.length} unread messages hain:\n${lines}`,
        hi: `आपकी ${items.length} चैट में कुल ${unreadReceipts.length} अनपढ़े संदेश हैं:\n${lines}`,
      });
      metadata = { unreadItems: items };
    }
  } else if (parsed.intent === "TASK_CREATE") {
    const title = (parsed.taskTitle || "New Task").trim();
    const task = await prisma.assistantTask.create({ data: { userId, title } });
    replyContent = await formatLocalized(parsed, {
      en: `Task added: "${task.title}"`,
      hinglish: `Task add kar diya: "${task.title}"`,
      hi: `टास्क जोड़ दिया गया: "${task.title}"`,
    });
    metadata = { task };
  } else if (parsed.intent === "TASK_LIST") {
    const tasks = await prisma.assistantTask.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 15,
    });
    if (tasks.length === 0) {
      replyContent = await formatLocalized(parsed, {
        en: "Your task list is empty. Tell me e.g. 'Add task buy groceries'.",
        hinglish: "Abhi aapki task list khali hai. Boliye jaise 'Task add karo: assignment submit'.",
        hi: "आपकी कार्य सूची अभी खाली है।",
      });
    } else {
      const pendingCount = tasks.filter((t) => t.status === "PENDING").length;
      const lines = tasks.map((t) => `${t.status === "COMPLETED" ? "✅" : "⬜"} ${t.title}`).join("\n");
      replyContent = await formatLocalized(parsed, {
        en: `Your tasks (${pendingCount} pending):\n${lines}`,
        hinglish: `Aapke tasks (${pendingCount} pending):\n${lines}`,
        hi: `आपके कार्य (${pendingCount} बाकी):\n${lines}`,
      });
    }
  } else if (parsed.intent === "TASK_COMPLETE") {
    const q = (parsed.taskTitle || "").toLowerCase();
    const pending = await prisma.assistantTask.findMany({
      where: { userId, status: AssistantTaskStatus.PENDING },
      orderBy: { createdAt: "desc" },
    });
    const match = q ? pending.find((t) => t.title.toLowerCase().includes(q)) : pending[0];
    if (!match) {
      replyContent = await formatLocalized(parsed, {
        en: "No matching pending task found.",
        hinglish: "Koi matching pending task nahi mila.",
        hi: "कोई मिलता-जुलता बाकी टास्क नहीं मिला।",
      });
    } else {
      await prisma.assistantTask.update({ where: { id: match.id }, data: { status: AssistantTaskStatus.COMPLETED } });
      replyContent = await formatLocalized(parsed, {
        en: `Marked "${match.title}" as completed!`,
        hinglish: `"${match.title}" complete mark kar diya!`,
        hi: `"${match.title}" पूरा हो गया है!`,
      });
    }
  } else if (parsed.intent === "SCHEDULED_LIST") {
    const upcoming = await prisma.scheduledAction.findMany({
      where: { userId },
      orderBy: [{ status: "asc" }, { scheduledFor: "asc" }],
      take: 10,
    });
    if (upcoming.length === 0) {
      replyContent = await formatLocalized(parsed, {
        en: "You don't have any upcoming scheduled messages or reminders.",
        hinglish: "Aapka koi upcoming scheduled message ya reminder nahi hai.",
        hi: "आपका कोई आगामी शेड्यूल संदेश या रिमाइंडर नहीं है।",
      });
    } else {
      const lines = upcoming
        .map((s) => `• [${s.status}] ${s.type === "REMINDER" ? "⏰" : "✉️"} ${s.targetLabel || ""} (${new Date(s.scheduledFor).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })})`)
        .join("\n");
      replyContent = await formatLocalized(parsed, {
        en: `Your scheduled actions:\n${lines}`,
        hinglish: `Aapke scheduled actions:\n${lines}`,
        hi: `आपके शेड्यूल किए गए कार्य:\n${lines}`,
      });
    }
  } else if (parsed.intent === "SCHEDULED_CANCEL") {
    const pending = await prisma.scheduledAction.findMany({
      where: { userId, status: ScheduledActionStatus.PENDING },
      orderBy: { scheduledFor: "asc" },
    });
    const targetQ = (parsed.targetName || "").toLowerCase();
    const matched = targetQ ? pending.find((p) => (p.targetLabel || "").toLowerCase().includes(targetQ)) : pending[0];
    if (!matched) {
      replyContent = await formatLocalized(parsed, {
        en: "I couldn't find any pending scheduled action to cancel.",
        hinglish: "Cancel karne ke liye koi pending scheduled action nahi mila.",
        hi: "रद्द करने के लिए कोई लंबित शेड्यूल कार्य नहीं मिला।",
      });
    } else {
      const actionId = crypto.randomUUID();
      replyContent = await formatLocalized(parsed, {
        en: `Confirm cancelling scheduled ${matched.type === "REMINDER" ? "reminder" : "message"} (${matched.targetLabel || ""})?`,
        hinglish: `Kya "${matched.targetLabel || ""}" wala scheduled ${matched.type === "REMINDER" ? "reminder" : "message"} cancel kar doon?`,
        hi: `क्या "${matched.targetLabel || ""}" वाला शेड्यूल रद्द कर दूँ?`,
      });
      metadata = {
        pendingAction: {
          id: actionId,
          type: "CANCEL_SCHEDULED",
          status: "PENDING",
          scheduledActionId: matched.id,
          targetLabel: matched.targetLabel || matched.type,
          scheduledForIso: matched.scheduledFor.toISOString(),
        },
      };
    }
  } else if (parsed.intent === "SEARCH_CHATS" || parsed.intent === "LAST_CONVERSATION" || parsed.intent === "SUMMARIZE_CHAT") {
    if (parsed.intent === "SEARCH_CHATS") {
      const q = (parsed.searchQuery || text).trim();
      const hits = await prisma.message.findMany({
        where: {
          deletedAt: null,
          body: { contains: q, mode: "insensitive" },
          conversation: { members: { some: { userId } } },
        },
        include: {
          sender: { select: { displayName: true, username: true } },
          conversation: { select: { id: true, type: true, title: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 6,
      });
      if (hits.length === 0) {
        replyContent = await formatLocalized(parsed, {
          en: `No messages matched "${q}".`,
          hinglish: `"${q}" se juda koi message nahi mila.`,
          hi: `"${q}" से जुड़ा कोई संदेश नहीं मिला।`,
        });
      } else {
        const lines = hits.map((h) => `• ${h.sender.displayName || h.sender.username}: "${(h.body || "").slice(0, 70)}"`).join("\n");
        replyContent = await formatLocalized(parsed, {
          en: `Found ${hits.length} matching messages:\n${lines}`,
          hinglish: `"${q}" ke liye ${hits.length} messages mile:\n${lines}`,
          hi: `"${q}" के लिए ${hits.length} संदेश मिले:\n${lines}`,
        });
        metadata = { searchResults: hits.map((h) => ({ id: h.id, conversationId: h.conversationId, body: h.body, sender: h.sender.displayName || h.sender.username })) };
      }
    } else {
      const targetQ = parsed.targetName || "";
      const candidates = targetQ ? await resolveCandidates(userId, targetQ) : [];
      const convCandidate = candidates.find((c) => c.conversationId);
      let convId = convCandidate?.conversationId;
      let label = convCandidate?.label || targetQ || "recent chat";

      if (!convId && !targetQ) {
        const latestConv = await prisma.conversation.findFirst({
          where: { members: { some: { userId } } },
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true },
        });
        convId = latestConv?.id;
        label = latestConv?.title || "latest conversation";
      }

      if (!convId) {
        replyContent = await formatLocalized(parsed, {
          en: `I couldn't find any past conversation with "${targetQ}".`,
          hinglish: `"${targetQ}" ke saath abhi koi conversation nahi mili.`,
          hi: `"${targetQ}" के साथ कोई पिछली बातचीत नहीं मिली।`,
        });
      } else {
        const msgs = await prisma.message.findMany({
          where: { conversationId: convId, deletedAt: null, type: { not: "SYSTEM" } },
          include: { sender: { select: { id: true, displayName: true, username: true } } },
          orderBy: { createdAt: "desc" },
          take: 10,
        });
        const chrono = [...msgs].reverse();
        if (chrono.length === 0) {
          replyContent = await formatLocalized(parsed, {
            en: `No messages in ${label} yet.`,
            hinglish: `${label} mein abhi koi message nahi hai.`,
            hi: `${label} में अभी कोई संदेश नहीं है।`,
          });
        } else {
          const lines = chrono.slice(-5).map((m) => `• ${m.sender.id === userId ? "You" : m.sender.displayName || m.sender.username}: ${m.body || "[Attachment]"}`).join("\n");
          replyContent = await formatLocalized(parsed, {
            en: `Summary of ${label} (last ${chrono.length} messages):\n${lines}`,
            hinglish: `${label} ki recent baat-cheet (last ${chrono.length} messages):\n${lines}`,
            hi: `${label} की हाल की बातचीत (${chrono.length} संदेश):\n${lines}`,
          });
          metadata = { conversationLink: { conversationId: convId, label } };
        }
      }
    }
  } else if (parsed.intent === "SEND_MESSAGE" || parsed.intent === "SCHEDULE_MESSAGE") {
    const isSchedule = parsed.intent === "SCHEDULE_MESSAGE";
    const candidates = parsed.targetName ? await resolveCandidates(userId, parsed.targetName) : [];
    const uniqueTarget = candidates.length === 1 ? candidates[0] : undefined;
    const contactFallback = candidates.length === 0 ? await getUserContacts(userId) : candidates;
    const actionId = crypto.randomUUID();
    const msgBody = parsed.messageBody || "";
    const scheduledIso = parsed.scheduledForIso || (isSchedule ? new Date(Date.now() + 3600_000).toISOString() : undefined);

    if (candidates.length > 1) {
      replyContent = await formatLocalized(parsed, {
        en: `I found multiple contacts matching "${parsed.targetName}". Please pick the right one:`,
        hinglish: `"${parsed.targetName}" naam ke ek se zyada contacts mile. Kisko bhejna hai?`,
        hi: `"${parsed.targetName}" नाम के एक से अधिक संपर्क मिले। सही संपर्क चुनें:`,
      });
    } else if (!uniqueTarget) {
      replyContent = await formatLocalized(parsed, {
        en: `I couldn't find "${parsed.targetName || "that contact"}". Select a contact below:`,
        hinglish: `"${parsed.targetName || "ye contact"}" nahi mila. Neeche se contact chunein:`,
        hi: `"${parsed.targetName || "यह संपर्क"}" नहीं मिला। नीचे से चुनें:`,
      });
    } else if (isSchedule && !msgBody) {
      replyContent = await formatLocalized(parsed, {
        en: `Please enter the message you want to send to ${uniqueTarget.label} and confirm the time:`,
        hinglish: `${uniqueTarget.label} ko bhejne ke liye message likhein aur time confirm karein:`,
        hi: `${uniqueTarget.label} को भेजने के लिए संदेश लिखें और समय कन्फर्म करें:`,
      });
    } else {
      replyContent = isSchedule
        ? await formatLocalized(parsed, {
            en: `Confirm scheduling message to ${uniqueTarget.label}: "${msgBody}"?`,
            hinglish: `${uniqueTarget.label} ko scheduled message "${msgBody}" bhejne ki confirmation karein:`,
            hi: `${uniqueTarget.label} को यह शेड्यूल संदेश "${msgBody}" भेजने की पुष्टि करें:`,
          })
        : await formatLocalized(parsed, {
            en: `Ready to send to ${uniqueTarget.label}: "${msgBody}" — Confirm?`,
            hinglish: `${uniqueTarget.label} ko "${msgBody}" bhej doon? Confirm karein:`,
            hi: `क्या मैं ${uniqueTarget.label} को "${msgBody}" भेज दूँ?`,
          });
    }

    metadata = {
      pendingAction: {
        id: actionId,
        type: isSchedule ? "SCHEDULE_MESSAGE" : "SEND_MESSAGE",
        status: "PENDING",
        language: parsed.replyStyle,
        targetUserId: uniqueTarget?.userId,
        targetConversationId: uniqueTarget?.conversationId,
        targetLabel: uniqueTarget?.label || parsed.targetName,
        body: msgBody,
        scheduledForIso: scheduledIso,
        candidates: !uniqueTarget ? contactFallback : undefined,
      },
    };
  } else if (parsed.intent === "START_CALL") {
    const candidates = parsed.targetName ? await resolveCandidates(userId, parsed.targetName, "USER") : [];
    const unique = candidates.length === 1 ? candidates[0] : undefined;
    const contacts = candidates.length === 0 ? await getUserContacts(userId) : candidates;
    const isVideo = Boolean(parsed.isVideoCall);

    if (!unique) {
      replyContent = await formatLocalized(parsed, {
        en: candidates.length > 1 ? `Multiple contacts match "${parsed.targetName}". Choose who to call:` : `Contact "${parsed.targetName}" not found. Pick from your contacts:`,
        hinglish: candidates.length > 1 ? `"${parsed.targetName}" naam ke kai contacts hain. Kisko call lagana hai?` : `"${parsed.targetName}" nahi mila. Apne contacts me se chunein:`,
        hi: `सही संपर्क चुनें जिसे कॉल करना है:`,
      });
    } else if (!unique.isOnline) {
      replyContent = await formatLocalized(parsed, {
        en: `${unique.label} looks offline right now so they may not pick up. Do you still want to try calling?`,
        hinglish: `${unique.label} abhi offline lag rahe hain, call lagne me dikkat ho sakti hai. Phir bhi try karein?`,
        hi: `${unique.label} अभी ऑफ़लाइन दिख रहे हैं। क्या आप फिर भी कॉल करने की कोशिश करना चाहते हैं?`,
      });
    } else {
      replyContent = await formatLocalized(parsed, {
        en: `Confirm ${isVideo ? "video" : "voice"} call to ${unique.label}?`,
        hinglish: `${unique.label} ko ${isVideo ? "video" : "voice"} call laga doon?`,
        hi: `क्या ${unique.label} को ${isVideo ? "वीडियो" : "वॉइस"} कॉल लगाऊँ?`,
      });
    }

    metadata = {
      pendingAction: {
        id: crypto.randomUUID(),
        type: "START_CALL",
        status: "PENDING",
        language: parsed.replyStyle,
        targetUserId: unique?.userId,
        targetConversationId: unique?.conversationId,
        targetLabel: unique?.label || parsed.targetName,
        isTargetOnline: unique?.isOnline,
        isVideo,
        candidates: !unique ? contacts : undefined,
      },
    };
  } else if (parsed.intent === "CREATE_GROUP") {
    const contacts = await getUserContacts(userId);
    const title = parsed.groupTitle || "New Group";
    const matchedIds: string[] = [];
    for (const name of parsed.memberNames || []) {
      const m = await resolveCandidates(userId, name, "USER");
      if (m[0]?.userId) matchedIds.push(m[0].userId);
    }

    replyContent = await formatLocalized(parsed, {
      en: `Confirm creating group "${title}" — select members below and click Confirm:`,
      hinglish: `"${title}" group banane ke liye members select karke Confirm karein:`,
      hi: `"${title}" ग्रुप बनाने के लिए सदस्य चुनें और कन्फर्म करें:`,
    });

    metadata = {
      pendingAction: {
        id: crypto.randomUUID(),
        type: "CREATE_GROUP",
        status: "PENDING",
        language: parsed.replyStyle,
        groupTitle: title,
        memberIds: matchedIds,
        candidates: contacts,
      },
    };
  } else if (parsed.intent === "CREATE_POLL") {
    const groups = await getUserGroups(userId);
    const matched = parsed.targetName ? await resolveCandidates(userId, parsed.targetName, "GROUP") : [];
    const targetGrp = matched.length === 1 ? matched[0] : groups.length === 1 ? groups[0] : undefined;

    replyContent = await formatLocalized(parsed, {
      en: `Review and confirm your poll${targetGrp ? ` in "${targetGrp.label}"` : ""}:`,
      hinglish: `${targetGrp ? `"${targetGrp.label}" mein ` : ""}poll details check karke Confirm karein:`,
      hi: `पोल विवरण जांचें और कन्फर्म करें:`,
    });

    metadata = {
      pendingAction: {
        id: crypto.randomUUID(),
        type: "CREATE_POLL",
        status: "PENDING",
        language: parsed.replyStyle,
        targetConversationId: targetGrp?.conversationId,
        targetLabel: targetGrp?.label,
        question: parsed.pollQuestion || "",
        options: parsed.pollOptions || ["Yes", "No"],
        candidates: groups,
      },
    };
  } else if (parsed.intent === "SET_REMINDER") {
    const scheduledIso = parsed.scheduledForIso || new Date(Date.now() + 3600_000).toISOString();
    const remText = parsed.reminderText || "Reminder";
    replyContent = await formatLocalized(parsed, {
      en: `Confirm reminder for ${new Date(scheduledIso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}: "${remText}"?`,
      hinglish: `${new Date(scheduledIso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} ka reminder set kar doon: "${remText}"?`,
      hi: `क्या ${new Date(scheduledIso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} का रिमाइंडर सेट कर दूँ: "${remText}"?`,
    });
    metadata = {
      pendingAction: {
        id: crypto.randomUUID(),
        type: "SET_REMINDER",
        status: "PENDING",
        language: parsed.replyStyle,
        reminderText: remText,
        scheduledForIso: scheduledIso,
      },
    };
  } else {
    // Natural friendly general response in user's own language
    if (parsed.chatReply) {
      replyContent = parsed.chatReply;
    } else if (/\b(hi|hello|hey|namaste|hii)\b/i.test(text)) {
      replyContent = await formatLocalized(parsed, {
        en: "Hey! I'm your Zust Talk Assistant. Ask me to message or call someone, schedule texts, create a group or poll, set reminders, manage tasks, or summarize unread chats!",
        hinglish: "Namaste! Main aapka Zust Talk AI Assistant hoon. Aap mujhse message bhejne, call lagane, reminder set karne, group/poll banane ya unread chat summary batane ko bol sakte hain!",
        hi: "नमस्ते! मैं आपका ज़स्ट टॉक AI असिस्टेंट हूँ। आप मुझसे मैसेज भेजने, कॉल करने, रिमाइंडर सेट करने, ग्रुप या पोल बनाने और अनपढ़े मैसेज का सारांश बताने को कह सकते हैं!",
      });
    } else {
      replyContent = await formatLocalized(parsed, {
        en: "I can help you send/schedule messages, place voice or video calls, create groups or polls, set reminders, manage tasks, search chats, and summarize unread messages. Try saying: \"Rahul ko hello bhej do\" or \"Show unread summary\"!",
        hinglish: "Main messages bhej/schedule kar sakta hoon, call laga sakta hoon, group/poll bana sakta hoon, reminders & tasks set kar sakta hoon, aur unread chats summarize kar sakta hoon. Jaise bolein: \"Rahul ko happy birthday wish kar do\"!",
        hi: "मैं संदेश भेजने/शेड्यूल करने, कॉल लगाने, ग्रुप या पोल बनाने, रिमाइंडर सेट करने और चैट सारांश बताने में आपकी मदद कर सकता हूँ।",
      });
    }
  }

  const assistantMsg = await prisma.assistantMessage.create({
    data: {
      userId,
      role: "assistant",
      content: replyContent,
      language: parsed.replyStyle === "other" ? parsed.replyIso : parsed.replyStyle,
      metadata,
    },
  });

  const state = await fetchAssistantState(userId);
  res.json({
    success: true,
    userMessage: userMsg,
    assistantMessage: assistantMsg,
    callTrigger,
    createdConversationId,
    state,
  });
}

export async function confirmAction(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const { messageId, overrides } = req.body as { messageId: string; overrides?: Record<string, any> };

  const msg = await prisma.assistantMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.userId !== userId) throw new HttpError(404, "Assistant action not found");

  const meta = (msg.metadata || {}) as Record<string, any>;
  const pending = meta.pendingAction;
  if (!pending) throw new HttpError(400, "No action attached to this message");
  if (pending.status !== "PENDING") {
    // Idempotent protection: never re-send duplicate messages!
    const state = await fetchAssistantState(userId);
    return res.json({ success: true, alreadyHandled: true, message: "This action was already processed.", state });
  }

  const outcome = await executePendingMetadata({ userId, action: pending, overrides });

  await prisma.assistantMessage.update({
    where: { id: msg.id },
    data: { metadata: { ...meta, pendingAction: outcome.updatedAction } },
  });

  if (outcome.updatedAction.status !== "PENDING") {
    await prisma.assistantMessage.create({
      data: {
        userId,
        role: "assistant",
        language: msg.language,
        content: outcome.ok ? `✅ ${outcome.summaryText}` : `⚠️ ${outcome.summaryText}`,
        metadata: { executedResult: { ok: outcome.ok, text: outcome.summaryText } },
      },
    });
  }

  const state = await fetchAssistantState(userId);
  res.json({
    success: outcome.ok,
    message: outcome.summaryText,
    callTrigger: outcome.callTrigger,
    createdConversationId: outcome.createdConversationId,
    state,
  });
}

export async function cancelAction(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const { messageId } = req.body as { messageId: string };
  const msg = await prisma.assistantMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.userId !== userId) throw new HttpError(404, "Assistant message not found");

  const meta = (msg.metadata || {}) as Record<string, any>;
  if (meta.pendingAction) {
    await prisma.assistantMessage.update({
      where: { id: msg.id },
      data: { metadata: { ...meta, pendingAction: { ...meta.pendingAction, status: "CANCELLED" } } },
    });
  }
  const state = await fetchAssistantState(userId);
  res.json({ success: true, state });
}

export async function updateScheduled(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const id = String(req.params.id);
  const existing = await prisma.scheduledAction.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) throw new HttpError(404, "Scheduled action not found");
  if (existing.status !== ScheduledActionStatus.PENDING) {
    throw new HttpError(400, `Cannot modify a ${existing.status.toLowerCase()} action`);
  }

  const nextScheduled = req.body.scheduledFor ? new Date(req.body.scheduledFor) : existing.scheduledFor;
  if (Number.isNaN(nextScheduled.getTime())) throw new HttpError(400, "Invalid date");

  const currentPayload = (existing.payload || {}) as Record<string, any>;
  const nextPayload = { ...currentPayload };
  let nextLabel = existing.targetLabel;

  if (typeof req.body.text === "string" && req.body.text.trim()) {
    if (existing.type === "REMINDER") {
      nextPayload.text = req.body.text.trim();
      nextLabel = req.body.text.trim();
    } else {
      nextPayload.body = req.body.text.trim();
    }
  }

  const updated = await prisma.scheduledAction.update({
    where: { id },
    data: { scheduledFor: nextScheduled, payload: nextPayload, targetLabel: nextLabel },
  });

  res.json({ success: true, scheduledAction: updated });
}

export async function deleteScheduled(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const id = String(req.params.id);
  const existing = await prisma.scheduledAction.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) throw new HttpError(404, "Scheduled action not found");

  if (existing.status === ScheduledActionStatus.PENDING) {
    const updated = await prisma.scheduledAction.update({
      where: { id },
      data: { status: ScheduledActionStatus.CANCELLED, resultMessage: "Cancelled by user" },
    });
    return res.json({ success: true, scheduledAction: updated });
  }

  await prisma.scheduledAction.delete({ where: { id } });
  res.json({ success: true });
}

export async function createTask(req: Request, res: Response) {
  const task = await prisma.assistantTask.create({
    data: {
      userId: req.auth!.userId,
      title: String(req.body.title).trim(),
      dueAt: req.body.dueAt ? new Date(req.body.dueAt) : null,
    },
  });
  res.status(201).json({ success: true, task });
}

export async function updateTask(req: Request, res: Response) {
  const id = String(req.params.id);
  const existing = await prisma.assistantTask.findUnique({ where: { id } });
  if (!existing || existing.userId !== req.auth!.userId) throw new HttpError(404, "Task not found");

  const task = await prisma.assistantTask.update({
    where: { id },
    data: {
      ...(typeof req.body.title === "string" ? { title: req.body.title.trim() } : {}),
      ...(req.body.status ? { status: req.body.status } : {}),
    },
  });
  res.json({ success: true, task });
}

export async function deleteTask(req: Request, res: Response) {
  const id = String(req.params.id);
  const existing = await prisma.assistantTask.findUnique({ where: { id } });
  if (!existing || existing.userId !== req.auth!.userId) throw new HttpError(404, "Task not found");
  await prisma.assistantTask.delete({ where: { id } });
  res.json({ success: true });
}
