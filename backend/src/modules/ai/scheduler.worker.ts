import { ScheduledActionStatus, ScheduledActionType } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { io, isUserOnline } from "../../sockets/socket";
import { createPollMessage } from "../polls/polls.controller";
import { sendReminderEmail } from "../../utils/mailer";

const inFlightJobs = new Set<string>();
let workerTimer: NodeJS.Timeout | null = null;

async function resolveDirectConversationId(senderId: string, recipientId: string): Promise<string | null> {
  const existing = await prisma.conversation.findFirst({
    where: {
      type: "DIRECT",
      AND: [
        { members: { some: { userId: senderId } } },
        { members: { some: { userId: recipientId } } },
      ],
    },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.conversation.create({
    data: {
      type: "DIRECT",
      members: {
        create: [
          { userId: senderId, role: "OWNER" },
          { userId: recipientId, role: "MEMBER" },
        ],
      },
    },
    select: { id: true },
  });
  return created.id;
}

export async function executeScheduledJob(actionId: string) {
  if (inFlightJobs.has(actionId)) return null;
  inFlightJobs.add(actionId);

  try {
    const job = await prisma.scheduledAction.findUnique({ where: { id: actionId } });
    if (!job || job.status !== ScheduledActionStatus.PENDING) return null;

    // Atomically claim so no concurrent tick can run this twice
    const claimed = await prisma.scheduledAction.updateMany({
      where: { id: job.id, status: ScheduledActionStatus.PENDING },
      data: { executedAt: new Date() },
    });
    if (claimed.count === 0) return null;

    const payload = (job.payload || {}) as Record<string, any>;
    const now = new Date();

    if (job.type === ScheduledActionType.SEND_MESSAGE) {
      const body = String(payload.body || "").trim();
      if (!body) {
        return prisma.scheduledAction.update({
          where: { id: job.id },
          data: {
            status: ScheduledActionStatus.FAILED,
            executedAt: now,
            resultMessage: "Failed: Message text was empty.",
          },
        });
      }

      let convId = job.targetConversationId;
      if (!convId && job.targetUserId) {
        const blocked = await prisma.userBlock.findFirst({
          where: {
            OR: [
              { blockerId: job.userId, blockedId: job.targetUserId },
              { blockerId: job.targetUserId, blockedId: job.userId },
            ],
          },
        });
        if (blocked) {
          return prisma.scheduledAction.update({
            where: { id: job.id },
            data: {
              status: ScheduledActionStatus.FAILED,
              executedAt: now,
              resultMessage: "Failed: Cannot message this user because one account blocked the other.",
            },
          });
        }
        convId = await resolveDirectConversationId(job.userId, job.targetUserId);
      }

      if (!convId) {
        return prisma.scheduledAction.update({
          where: { id: job.id },
          data: {
            status: ScheduledActionStatus.FAILED,
            executedAt: now,
            resultMessage: "Failed: No target recipient or conversation found.",
          },
        });
      }

      const member = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: convId, userId: job.userId } },
      });
      if (!member) {
        return prisma.scheduledAction.update({
          where: { id: job.id },
          data: {
            status: ScheduledActionStatus.FAILED,
            executedAt: now,
            resultMessage: "Failed: You are no longer a member of that conversation.",
          },
        });
      }

      const members = await prisma.conversationMember.findMany({
        where: { conversationId: convId },
        select: { userId: true },
      });

      const msg = await prisma.message.create({
        data: {
          conversationId: convId,
          senderId: job.userId,
          body,
          type: "TEXT",
          receipts: {
            create: members
              .filter((m) => m.userId !== job.userId)
              .map((m) => ({ userId: m.userId })),
          },
        },
        include: {
          sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          receipts: true,
          attachments: true,
        },
      });

      await prisma.conversation.update({
        where: { id: convId },
        data: { updatedAt: now },
      });

      if (io) {
        for (const m of members) {
          io.to(`user:${m.userId}`).emit("message:new", msg);
          if (m.userId !== job.userId) {
            io.to(`user:${m.userId}`).emit("conversation:updated", {
              conversationId: convId,
              lastMessage: msg,
            });
          }
        }
      }

      const resultMsg = `Sent to ${job.targetLabel || "recipient"}: "${body.slice(0, 60)}"`;
      const updated = await prisma.scheduledAction.update({
        where: { id: job.id },
        data: {
          status: ScheduledActionStatus.EXECUTED,
          executedAt: now,
          targetConversationId: convId,
          resultMessage: resultMsg,
        },
      });

      await prisma.assistantMessage.create({
        data: {
          userId: job.userId,
          role: "assistant",
          language: String(payload.language || "en"),
          content: `✅ Scheduled message delivered to ${job.targetLabel || "contact"}: "${body}"`,
          metadata: { scheduledActionId: job.id, status: "EXECUTED" },
        },
      });

      if (io) {
        io.to(`user:${job.userId}`).emit("ai:scheduled-executed", updated);
      }
      return updated;
    }

    if (job.type === ScheduledActionType.CREATE_POLL) {
      const convId = job.targetConversationId;
      const question = String(payload.question || "").trim();
      const options = Array.isArray(payload.options) ? payload.options.map(String) : [];

      if (!convId || !question || options.length < 2) {
        return prisma.scheduledAction.update({
          where: { id: job.id },
          data: {
            status: ScheduledActionStatus.FAILED,
            executedAt: now,
            resultMessage: "Failed: Missing group or poll options.",
          },
        });
      }

      await createPollMessage({
        conversationId: convId,
        creatorId: job.userId,
        question,
        options,
        allowMultiple: Boolean(payload.allowMultiple),
      });

      const updated = await prisma.scheduledAction.update({
        where: { id: job.id },
        data: {
          status: ScheduledActionStatus.EXECUTED,
          executedAt: now,
          resultMessage: `Poll posted in ${job.targetLabel || "chat"}: "${question}"`,
        },
      });
      if (io) io.to(`user:${job.userId}`).emit("ai:scheduled-executed", updated);
      return updated;
    }

    if (job.type === ScheduledActionType.REMINDER) {
      const text = String(payload.text || "Scheduled Reminder").trim();
      const owner = await prisma.user.findUnique({
        where: { id: job.userId },
        select: { email: true, isVerified: true },
      });

      if (owner?.email && owner.isVerified) {
        await sendReminderEmail({
          to: owner.email,
          reminderText: text,
          scheduledAtLabel: now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        }).catch(() => {});
      }

      const updated = await prisma.scheduledAction.update({
        where: { id: job.id },
        data: {
          status: ScheduledActionStatus.EXECUTED,
          executedAt: now,
          resultMessage: `Reminder: ${text}`,
        },
      });

      await prisma.assistantMessage.create({
        data: {
          userId: job.userId,
          role: "assistant",
          language: String(payload.language || "en"),
          content: `⏰ Reminder: ${text}`,
          metadata: { scheduledActionId: job.id, kind: "reminder_due" },
        },
      });

      if (io) {
        io.to(`user:${job.userId}`).emit("ai:reminder-due", {
          id: job.id,
          text,
          scheduledFor: job.scheduledFor,
        });
        io.to(`user:${job.userId}`).emit("ai:scheduled-executed", updated);
      }

      return updated;
    }

    if (job.type === ScheduledActionType.CALL) {
      const online = isUserOnline(job.userId);
      const updated = await prisma.scheduledAction.update({
        where: { id: job.id },
        data: {
          status: online ? ScheduledActionStatus.EXECUTED : ScheduledActionStatus.FAILED,
          executedAt: now,
          resultMessage: online
            ? `Scheduled ${payload.isVideo ? "video" : "voice"} call prompt opened for ${job.targetLabel || "contact"}.`
            : "Scheduled call could not be placed automatically because your browser was offline.",
        },
      });
      if (io && online) {
        io.to(`user:${job.userId}`).emit("ai:scheduled-call-due", {
          targetUserId: job.targetUserId,
          conversationId: job.targetConversationId,
          targetLabel: job.targetLabel,
          isVideo: Boolean(payload.isVideo),
        });
      }
      if (io) io.to(`user:${job.userId}`).emit("ai:scheduled-executed", updated);
      return updated;
    }

    return null;
  } catch (err: any) {
    console.error(`[Scheduler] Failed job ${actionId}:`, err?.message || err);
    await prisma.scheduledAction
      .update({
        where: { id: actionId },
        data: {
          status: ScheduledActionStatus.FAILED,
          executedAt: new Date(),
          resultMessage: `Failed: ${err?.message || "Unexpected error"}`,
        },
      })
      .catch(() => {});
    return null;
  } finally {
    inFlightJobs.delete(actionId);
  }
}

export async function runSchedulerPass() {
  try {
    const due = await prisma.scheduledAction.findMany({
      where: {
        status: ScheduledActionStatus.PENDING,
        scheduledFor: { lte: new Date() },
      },
      orderBy: { scheduledFor: "asc" },
      take: 25,
      select: { id: true },
    });

    for (const item of due) {
      await executeScheduledJob(item.id);
    }
  } catch (err: any) {
    console.error("[Scheduler] Pass error:", err?.message || err);
  }
}

export function startSchedulerWorker() {
  if (workerTimer) return;
  // Immediate pass + periodic 15-second tick
  setTimeout(() => {
    runSchedulerPass().catch(() => {});
  }, 2000);
  workerTimer = setInterval(() => {
    runSchedulerPass().catch(() => {});
  }, 15_000);
}

export function stopSchedulerWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
