import { Request, Response } from "express";
import { prisma } from "../../config/prisma";
import { HttpError } from "../../utils/http-error";
import { io } from "../../sockets/socket";

async function ensureMember(conversationId: string, userId: string) {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!member) throw new HttpError(403, "You are not a member of this conversation");
  return member;
}

export const pollInclude = {
  options: {
    orderBy: { position: "asc" as const },
    include: {
      votes: { select: { id: true, userId: true, optionId: true } },
    },
  },
};

export async function createPollMessage(params: {
  conversationId: string;
  creatorId: string;
  question: string;
  options: string[];
  allowMultiple?: boolean;
}) {
  const { conversationId, creatorId, question, options, allowMultiple = false } = params;
  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);
  if (cleanOptions.length < 2) {
    throw new HttpError(400, "Poll must have at least 2 options");
  }

  await ensureMember(conversationId, creatorId);

  const members = await prisma.conversationMember.findMany({
    where: { conversationId },
    select: { userId: true },
  });

  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: creatorId,
      body: `📊 Poll: ${question.trim()}`,
      type: "POLL",
      receipts: {
        create: members
          .filter((m) => m.userId !== creatorId)
          .map((m) => ({ userId: m.userId })),
      },
      poll: {
        create: {
          conversationId,
          creatorId,
          question: question.trim(),
          allowMultiple: Boolean(allowMultiple),
          options: {
            create: cleanOptions.map((text, idx) => ({
              text,
              position: idx,
            })),
          },
        },
      },
    },
    include: {
      sender: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      receipts: true,
      attachments: true,
      poll: { include: pollInclude },
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  if (io) {
    for (const m of members) {
      io.to(`user:${m.userId}`).emit("message:new", message);
      if (m.userId !== creatorId) {
        io.to(`user:${m.userId}`).emit("conversation:updated", {
          conversationId,
          lastMessage: message,
        });
      }
    }
    io.to(`conversation:${conversationId}`).emit("message:new", message);
  }

  return message;
}

export async function create(req: Request, res: Response) {
  const { conversationId, question, options, allowMultiple } = req.body as {
    conversationId: string;
    question: string;
    options: string[];
    allowMultiple?: boolean;
  };

  const message = await createPollMessage({
    conversationId,
    creatorId: req.auth!.userId,
    question,
    options,
    allowMultiple,
  });

  res.status(201).json({ success: true, message, poll: message.poll });
}

export async function vote(req: Request, res: Response) {
  const pollId = String(req.params.pollId);
  const optionId = String(req.body.optionId);
  const userId = req.auth!.userId;

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { options: true },
  });
  if (!poll) throw new HttpError(404, "Poll not found");
  await ensureMember(poll.conversationId, userId);

  const optionValid = poll.options.some((o) => o.id === optionId);
  if (!optionValid) throw new HttpError(400, "Invalid poll option");

  const pollOptionIds = poll.options.map((o) => o.id);

  if (poll.allowMultiple) {
    const existing = await prisma.pollVote.findUnique({
      where: { optionId_userId: { optionId, userId } },
    });
    if (existing) {
      await prisma.pollVote.delete({ where: { id: existing.id } });
    } else {
      await prisma.pollVote.create({ data: { optionId, userId } });
    }
  } else {
    const existingSame = await prisma.pollVote.findUnique({
      where: { optionId_userId: { optionId, userId } },
    });
    await prisma.pollVote.deleteMany({
      where: { optionId: { in: pollOptionIds }, userId },
    });
    if (!existingSame) {
      await prisma.pollVote.create({ data: { optionId, userId } });
    }
  }

  const updatedPoll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: pollInclude,
  });

  if (io && updatedPoll) {
    const payload = {
      conversationId: poll.conversationId,
      messageId: poll.messageId,
      poll: updatedPoll,
    };
    io.to(`conversation:${poll.conversationId}`).emit("poll:updated", payload);
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: poll.conversationId },
      select: { userId: true },
    });
    for (const m of members) {
      io.to(`user:${m.userId}`).emit("poll:updated", payload);
    }
  }

  res.json({ success: true, poll: updatedPoll });
}
