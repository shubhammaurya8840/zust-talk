import { Request, Response } from "express";
import { ConnectionRequestStatus, ConversationType, MemberRole } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { HttpError } from "../../utils/http-error";
import { io, isUserOnline } from "../../sockets/socket";

const PRESENCE_TTL_MS = 5 * 60 * 1000; // 5 minutes automatic expiry (keeps discovery active even when tab/app is minimized)
const MAX_RADIUS_METERS = 100;

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toApproxDistanceMeters(rawMeters: number): number {
  return Math.min(MAX_RADIUS_METERS, Math.max(5, Math.round(rawMeters / 5) * 5));
}

export async function purgeExpiredPresences(): Promise<string[]> {
  const now = new Date();
  const expired = await prisma.nearbyPresence.findMany({
    where: { expiresAt: { lte: now } },
    select: { userId: true },
  });
  if (expired.length === 0) return [];
  const ids = expired.map((e) => e.userId);
  await prisma.nearbyPresence.deleteMany({
    where: { userId: { in: ids } },
  });
  return ids;
}

// Background cleanup every 30s (unref so it never blocks process/test shutdown)
const cleanupTimer = setInterval(async () => {
  try {
    const removedIds = await purgeExpiredPresences();
    if (removedIds.length > 0 && io) {
      io.to("nearby:watchers").emit("nearby:users-removed", { userIds: removedIds });
    }
  } catch {
    // Ignore transient errors in background sweep
  }
}, 30_000);
cleanupTimer.unref();

export async function getSettings(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: {
      nearbyDiscoveryEnabled: true,
      nearbyInvisibleMode: true,
      nearbyPresence: { select: { expiresAt: true } },
    },
  });
  if (!user) throw new HttpError(404, "User not found");

  const isPresenceActive = Boolean(
    user.nearbyPresence && user.nearbyPresence.expiresAt > new Date()
  );

  res.json({
    success: true,
    settings: {
      discoveryEnabled: user.nearbyDiscoveryEnabled,
      invisibleMode: user.nearbyInvisibleMode,
      isPresenceActive,
    },
  });
}

export async function updateSettings(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const { discoveryEnabled, invisibleMode } = req.body as {
    discoveryEnabled?: boolean;
    invisibleMode?: boolean;
  };

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(typeof discoveryEnabled === "boolean" ? { nearbyDiscoveryEnabled: discoveryEnabled } : {}),
      ...(typeof invisibleMode === "boolean" ? { nearbyInvisibleMode: invisibleMode } : {}),
    },
    select: {
      nearbyDiscoveryEnabled: true,
      nearbyInvisibleMode: true,
    },
  });

  // Immediately delete ephemeral location data if discovery disabled OR invisible mode turned on
  if (!updated.nearbyDiscoveryEnabled || updated.nearbyInvisibleMode) {
    await prisma.nearbyPresence.deleteMany({ where: { userId } });
    if (io) {
      io.to("nearby:watchers").emit("nearby:users-removed", { userIds: [userId] });
    }
  }

  res.json({
    success: true,
    settings: {
      discoveryEnabled: updated.nearbyDiscoveryEnabled,
      invisibleMode: updated.nearbyInvisibleMode,
    },
  });
}

export async function scan(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const { latitude, longitude, accuracy } = req.body as {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };

  // Enforce explicit opt-in consent
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { nearbyDiscoveryEnabled: true, nearbyInvisibleMode: true },
  });
  if (!me) throw new HttpError(404, "User not found");
  if (!me.nearbyDiscoveryEnabled) {
    throw new HttpError(403, "Enable Nearby Discovery first to scan nearby people");
  }

  // Purge any expired presences first
  await purgeExpiredPresences();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + PRESENCE_TTL_MS);

  // Store ephemeral presence ONLY if NOT in Invisible Mode; otherwise remove own presence
  if (me.nearbyInvisibleMode) {
    await prisma.nearbyPresence.deleteMany({ where: { userId } });
  } else {
    await prisma.nearbyPresence.upsert({
      where: { userId },
      create: { userId, latitude, longitude, accuracy: accuracy ?? null, expiresAt },
      update: { latitude, longitude, accuracy: accuracy ?? null, expiresAt },
    });
    if (io) {
      io.to("nearby:watchers").emit("nearby:pulse", { userId });
    }
  }

  // Fetch blocked user IDs in both directions
  const blocks = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const blockedSet = new Set<string>();
  for (const b of blocks) {
    if (b.blockerId !== userId) blockedSet.add(b.blockerId);
    if (b.blockedId !== userId) blockedSet.add(b.blockedId);
  }

  // Query active eligible nearby users
  const activePresences = await prisma.nearbyPresence.findMany({
    where: {
      userId: { not: userId },
      expiresAt: { gt: now },
      user: {
        isActive: true,
        nearbyDiscoveryEnabled: true,
        nearbyInvisibleMode: false,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
          lastSeenAt: true,
        },
      },
    },
  });

  // Filter strictly within 100m & non-blocked
  const withinRadius: Array<{
    presence: (typeof activePresences)[number];
    approxDistance: number;
    rawMeters: number;
  }> = [];

  for (const p of activePresences) {
    if (blockedSet.has(p.userId)) continue;
    const rawMeters = haversineMeters(latitude, longitude, p.latitude, p.longitude);
    if (rawMeters <= MAX_RADIUS_METERS) {
      withinRadius.push({
        presence: p,
        rawMeters,
        approxDistance: toApproxDistanceMeters(rawMeters),
      });
    }
  }

  withinRadius.sort((a, b) => a.rawMeters - b.rawMeters);

  const nearbyIds = withinRadius.map((w) => w.presence.userId);

  // Fetch common groups & existing connection/conversation state
  const [myGroups, myDirects, requests] =
    nearbyIds.length > 0
      ? await Promise.all([
          prisma.conversation.findMany({
            where: {
              type: ConversationType.GROUP,
              members: { some: { userId } },
            },
            select: {
              id: true,
              title: true,
              members: { select: { userId: true } },
            },
          }),
          prisma.conversation.findMany({
            where: {
              type: ConversationType.DIRECT,
              AND: [
                { members: { some: { userId } } },
                { members: { some: { userId: { in: nearbyIds } } } },
              ],
            },
            select: {
              id: true,
              members: { select: { userId: true } },
            },
          }),
          prisma.connectionRequest.findMany({
            where: {
              OR: [
                { senderId: userId, receiverId: { in: nearbyIds } },
                { senderId: { in: nearbyIds }, receiverId: userId },
              ],
            },
          }),
        ])
      : [[], [], []];

  const nearbyUsers = withinRadius.map(({ presence, approxDistance }) => {
    const targetId = presence.userId;
    const commonGroups = myGroups
      .filter((g) => g.members.some((m) => m.userId === targetId))
      .map((g) => ({ id: g.id, title: g.title || "Group" }));

    const existingDirect = myDirects.find((d) =>
      d.members.some((m) => m.userId === targetId)
    );

    const sentReq = requests.find((r) => r.senderId === userId && r.receiverId === targetId);
    const recvReq = requests.find((r) => r.senderId === targetId && r.receiverId === userId);

    let connectionStatus: "NONE" | "PENDING_SENT" | "PENDING_RECEIVED" | "CONNECTED" | "REJECTED" = "NONE";
    let requestId: string | undefined;

    if (existingDirect || sentReq?.status === "ACCEPTED" || recvReq?.status === "ACCEPTED") {
      connectionStatus = "CONNECTED";
      requestId = sentReq?.id || recvReq?.id;
    } else if (recvReq?.status === "PENDING") {
      connectionStatus = "PENDING_RECEIVED";
      requestId = recvReq.id;
    } else if (sentReq?.status === "PENDING") {
      connectionStatus = "PENDING_SENT";
      requestId = sentReq.id;
    } else if (sentReq?.status === "REJECTED") {
      connectionStatus = "REJECTED";
      requestId = sentReq.id;
    }

    // Privacy check: NEVER return latitude, longitude, phone, or email!
    return {
      id: presence.user.id,
      username: presence.user.username,
      displayName: presence.user.displayName,
      avatarUrl: presence.user.avatarUrl,
      bio: presence.user.bio,
      isOnline: isUserOnline(presence.user.id),
      lastSeenAt: presence.user.lastSeenAt,
      distanceMeters: approxDistance,
      commonGroups,
      connectionStatus,
      requestId,
      conversationId: existingDirect?.id,
      lastActiveAt: presence.updatedAt,
    };
  });

  res.json({
    success: true,
    nearbyUsers,
    scannedAt: now.toISOString(),
    expiresInSeconds: Math.round(PRESENCE_TTL_MS / 1000),
  });
}

export async function stopScanning(req: Request, res: Response) {
  const userId = req.auth!.userId;
  await prisma.nearbyPresence.deleteMany({ where: { userId } });
  if (io) {
    io.to("nearby:watchers").emit("nearby:users-removed", { userIds: [userId] });
  }
  res.json({ success: true });
}

export async function listRequests(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const [incoming, outgoing] = await Promise.all([
    prisma.connectionRequest.findMany({
      where: { receiverId: userId, status: ConnectionRequestStatus.PENDING },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            bio: true,
            lastSeenAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.connectionRequest.findMany({
      where: { senderId: userId, status: ConnectionRequestStatus.PENDING },
      include: {
        receiver: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            bio: true,
            lastSeenAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  res.json({
    success: true,
    incoming: incoming.map((r) => ({
      ...r,
      sender: { ...r.sender, isOnline: isUserOnline(r.sender.id) },
    })),
    outgoing: outgoing.map((r) => ({
      ...r,
      receiver: { ...r.receiver, isOnline: isUserOnline(r.receiver.id) },
    })),
  });
}

async function getOrCreateDirectConversation(userA: string, userB: string) {
  const existing = await prisma.conversation.findFirst({
    where: {
      type: ConversationType.DIRECT,
      AND: [{ members: { some: { userId: userA } } }, { members: { some: { userId: userB } } }],
    },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: {
      type: ConversationType.DIRECT,
      members: { create: [{ userId: userA, role: MemberRole.OWNER }, { userId: userB }] },
    },
  });
}

export async function sendRequest(req: Request, res: Response) {
  const senderId = req.auth!.userId;
  const { toUserId, message } = req.body as { toUserId: string; message?: string };

  if (senderId === toUserId) {
    throw new HttpError(400, "Cannot send a connection request to yourself");
  }

  const target = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { id: true, isActive: true, nearbyDiscoveryEnabled: true, nearbyInvisibleMode: true },
  });
  if (!target || !target.isActive) {
    throw new HttpError(404, "User not found");
  }
  if (!target.nearbyDiscoveryEnabled || target.nearbyInvisibleMode) {
    throw new HttpError(403, "This user is no longer discoverable nearby");
  }

  const blocked = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: senderId, blockedId: toUserId },
        { blockerId: toUserId, blockedId: senderId },
      ],
    },
  });
  if (blocked) {
    throw new HttpError(403, "Cannot connect with this user");
  }

  const existing = await prisma.connectionRequest.findUnique({
    where: { senderId_receiverId: { senderId, receiverId: toUserId } },
  });
  if (existing) {
    if (existing.status === ConnectionRequestStatus.PENDING) {
      throw new HttpError(409, "Connection request already sent");
    }
    if (existing.status === ConnectionRequestStatus.ACCEPTED) {
      const conv = await getOrCreateDirectConversation(senderId, toUserId);
      return res.json({ success: true, request: existing, conversationId: conv.id, alreadyConnected: true });
    }
    if (existing.status === ConnectionRequestStatus.REJECTED) {
      throw new HttpError(409, "Previous connection request was declined");
    }
  }

  // If the target user already sent a PENDING request to us, auto-accept & open conversation!
  const reverse = await prisma.connectionRequest.findUnique({
    where: { senderId_receiverId: { senderId: toUserId, receiverId: senderId } },
  });
  if (reverse && reverse.status === ConnectionRequestStatus.PENDING) {
    const accepted = await prisma.connectionRequest.update({
      where: { id: reverse.id },
      data: { status: ConnectionRequestStatus.ACCEPTED },
    });
    const conv = await getOrCreateDirectConversation(senderId, toUserId);
    if (io) {
      io.to(`user:${toUserId}`).emit("nearby:request-accepted", {
        requestId: accepted.id,
        byUserId: senderId,
        conversationId: conv.id,
      });
      io.to(`user:${toUserId}`).emit("conversation:updated", { conversationId: conv.id });
      io.to(`user:${senderId}`).emit("conversation:updated", { conversationId: conv.id });
    }
    return res.status(200).json({
      success: true,
      request: accepted,
      conversationId: conv.id,
      autoAccepted: true,
    });
  }

  const created = await prisma.connectionRequest.create({
    data: {
      senderId,
      receiverId: toUserId,
      message: message?.trim() || null,
      status: ConnectionRequestStatus.PENDING,
    },
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          bio: true,
        },
      },
    },
  });

  if (io) {
    io.to(`user:${toUserId}`).emit("nearby:request-received", created);
  }

  res.status(201).json({ success: true, request: created });
}

export async function respondToRequest(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const requestId = req.params.requestId as string;
  const { action } = req.body as { action: "ACCEPT" | "REJECT" };

  const existing = await prisma.connectionRequest.findUnique({
    where: { id: requestId },
  });
  if (!existing) throw new HttpError(404, "Connection request not found");
  if (existing.receiverId !== userId) {
    throw new HttpError(403, "You can only respond to requests sent to you");
  }
  if (existing.status !== ConnectionRequestStatus.PENDING) {
    throw new HttpError(400, "Connection request has already been processed");
  }

  const nextStatus =
    action === "ACCEPT" ? ConnectionRequestStatus.ACCEPTED : ConnectionRequestStatus.REJECTED;

  const updated = await prisma.connectionRequest.update({
    where: { id: requestId },
    data: { status: nextStatus },
  });

  let conversationId: string | undefined;
  if (action === "ACCEPT") {
    const conv = await getOrCreateDirectConversation(existing.senderId, existing.receiverId);
    conversationId = conv.id;

    if (io) {
      io.to(`user:${existing.senderId}`).emit("nearby:request-accepted", {
        requestId: updated.id,
        byUserId: userId,
        conversationId,
      });
      io.to(`user:${existing.senderId}`).emit("conversation:updated", { conversationId });
      io.to(`user:${userId}`).emit("conversation:updated", { conversationId });
    }
  } else if (io) {
    io.to(`user:${existing.senderId}`).emit("nearby:request-rejected", {
      requestId: updated.id,
      byUserId: userId,
    });
  }

  res.json({ success: true, request: updated, conversationId });
}

export async function cancelRequest(req: Request, res: Response) {
  const userId = req.auth!.userId;
  const requestId = req.params.requestId as string;

  const existing = await prisma.connectionRequest.findUnique({ where: { id: requestId } });
  if (!existing) throw new HttpError(404, "Connection request not found");
  if (existing.senderId !== userId) {
    throw new HttpError(403, "You can only cancel your own outgoing request");
  }
  if (existing.status !== ConnectionRequestStatus.PENDING) {
    throw new HttpError(400, "Only pending requests can be cancelled");
  }

  await prisma.connectionRequest.delete({ where: { id: requestId } });
  if (io) {
    io.to(`user:${existing.receiverId}`).emit("nearby:request-cancelled", { requestId });
  }
  res.json({ success: true });
}
