import type { Express, Response } from "express";
import type { Server as IOServer } from "socket.io";
import type { AuthedRequest } from "./auth.js";
import { authMiddleware } from "./auth.js";
import { prisma } from "./db.js";
import { areFriends, canCreateNewDm, friendUserIds, friendshipPair } from "./social.js";
import { toLiteUser } from "./serializers.js";

function emitToUser(io: IOServer, userId: string, event: string, payload: unknown): void {
  io.to(`user:${userId}`).emit(event, payload);
}

export function registerSocialRoutes(app: Express, io: IOServer): void {
  app.get("/api/users/search", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const q = String(req.query.q ?? "")
      .trim()
      .slice(0, 64);
    if (q.length < 2) {
      res.json([]);
      return;
    }
    const users = await prisma.user.findMany({
      where: {
        AND: [
          { id: { not: req.user!.id } },
          {
            OR: [
              { username: { contains: q } },
              { displayName: { contains: q } },
            ],
          },
        ],
      },
      take: 20,
      orderBy: { username: "asc" },
    });
    res.json(users.map((u) => toLiteUser(u)));
  });

  app.get("/api/presence/bulk", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const raw = String(req.query.ids ?? "");
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    const rows = await prisma.userPresence.findMany({ where: { userId: { in: ids } } });
    const map = new Map(rows.map((r) => [r.userId, r]));
    const out = ids.map((userId) => {
      const p = map.get(userId);
      return {
        userId,
        isOnline: p?.isOnline ?? false,
        lastSeenAt: (p?.lastSeenAt ?? new Date(0)).toISOString(),
      };
    });
    res.json(out);
  });

  app.get("/api/friends", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const me = req.user!.id;
    const [asA, asB] = await Promise.all([
      prisma.friendship.findMany({ where: { userAId: me }, include: { userB: true } }),
      prisma.friendship.findMany({ where: { userBId: me }, include: { userA: true } }),
    ]);
    const others = [...asA.map((f) => f.userB), ...asB.map((f) => f.userA)];
    const unique = new Map(others.map((u) => [u.id, u]));
    const ids = [...unique.keys()];
    const presRows = ids.length ? await prisma.userPresence.findMany({ where: { userId: { in: ids } } }) : [];
    const presMap = new Map(presRows.map((p) => [p.userId, p]));
    res.json(
      [...unique.values()].map((u) => ({
        user: toLiteUser(u),
        presence: {
          userId: u.id,
          isOnline: presMap.get(u.id)?.isOnline ?? false,
          lastSeenAt: (presMap.get(u.id)?.lastSeenAt ?? new Date(0)).toISOString(),
        },
      })),
    );
  });

  app.get("/api/friends/requests", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const box = String(req.query.box ?? "incoming");
    const me = req.user!.id;
    if (box === "outgoing") {
      const rows = await prisma.friendRequest.findMany({
        where: { fromUserId: me, status: "pending" },
        include: { toUser: true },
        orderBy: { createdAt: "desc" },
      });
      res.json(
        rows.map((r) => ({
          id: r.id,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          user: toLiteUser(r.toUser),
        })),
      );
      return;
    }
    const rows = await prisma.friendRequest.findMany({
      where: { toUserId: me, status: "pending" },
      include: { fromUser: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        user: toLiteUser(r.fromUser),
      })),
    );
  });

  app.post("/api/friends/requests", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const { toUserId } = req.body ?? {};
    const target = typeof toUserId === "string" ? toUserId : "";
    const me = req.user!.id;
    if (!target || target === me) {
      res.status(400).json({ error: "invalid target" });
      return;
    }
    const other = await prisma.user.findUnique({ where: { id: target } });
    if (!other) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    if (await areFriends(prisma, me, target)) {
      res.status(400).json({ error: "already friends" });
      return;
    }
    const reversePending = await prisma.friendRequest.findFirst({
      where: { fromUserId: target, toUserId: me, status: "pending" },
    });
    if (reversePending) {
      res.status(409).json({ error: "incoming_request_exists", requestId: reversePending.id });
      return;
    }
    const row = await prisma.friendRequest.upsert({
      where: { fromUserId_toUserId: { fromUserId: me, toUserId: target } },
      create: { fromUserId: me, toUserId: target, status: "pending" },
      update: { status: "pending", respondedAt: null },
      include: { toUser: true, fromUser: true },
    });
    emitToUser(io, target, "friend:request:new", {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      user: toLiteUser(row.fromUser),
    });
    res.json({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      user: toLiteUser(row.toUser),
    });
  });

  app.post("/api/friends/requests/:requestId/accept", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const raw = req.params.requestId;
    const requestId = typeof raw === "string" ? raw : raw?.[0];
    if (!requestId) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    const me = req.user!.id;
    const fr = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!fr || fr.toUserId !== me) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (fr.status !== "pending") {
      res.status(400).json({ error: "not pending" });
      return;
    }
    const [userAId, userBId] = friendshipPair(fr.fromUserId, fr.toUserId);
    await prisma.$transaction(async (tx) => {
      await tx.friendship.create({ data: { userAId, userBId } });
      await tx.friendRequest.update({
        where: { id: fr.id },
        data: { status: "accepted", respondedAt: new Date() },
      });
      await tx.friendRequest.updateMany({
        where: {
          OR: [
            { fromUserId: fr.fromUserId, toUserId: fr.toUserId },
            { fromUserId: fr.toUserId, toUserId: fr.fromUserId },
          ],
          NOT: { id: fr.id },
          status: "pending",
        },
        data: { status: "cancelled", respondedAt: new Date() },
      });
    });
    emitToUser(io, fr.fromUserId, "friend:updated", { type: "accepted", userId: me });
    emitToUser(io, me, "friend:updated", { type: "accepted", userId: fr.fromUserId });
    res.json({ ok: true });
  });

  app.post("/api/friends/requests/:requestId/decline", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const raw = req.params.requestId;
    const requestId = typeof raw === "string" ? raw : raw?.[0];
    if (!requestId) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    const me = req.user!.id;
    const fr = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!fr || fr.toUserId !== me) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    await prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: "declined", respondedAt: new Date() },
    });
    emitToUser(io, fr.fromUserId, "friend:updated", { type: "declined", userId: me });
    res.json({ ok: true });
  });

  app.post("/api/friends/requests/:requestId/cancel", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const raw = req.params.requestId;
    const requestId = typeof raw === "string" ? raw : raw?.[0];
    if (!requestId) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    const me = req.user!.id;
    const fr = await prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!fr || fr.fromUserId !== me) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    await prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: "cancelled", respondedAt: new Date() },
    });
    emitToUser(io, fr.toUserId, "friend:updated", { type: "cancelled", userId: me });
    res.json({ ok: true });
  });

  app.delete("/api/friends/:userId", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const raw = req.params.userId;
    const otherId = typeof raw === "string" ? raw : raw?.[0];
    if (!otherId || otherId === req.user!.id) {
      res.status(400).json({ error: "bad user" });
      return;
    }
    const [userAId, userBId] = friendshipPair(req.user!.id, otherId);
    const del = await prisma.friendship.deleteMany({ where: { userAId, userBId } });
    if (del.count === 0) {
      res.status(404).json({ error: "not friends" });
      return;
    }
    emitToUser(io, otherId, "friend:updated", { type: "removed", userId: req.user!.id });
    emitToUser(io, req.user!.id, "friend:updated", { type: "removed", userId: otherId });
    res.json({ ok: true });
  });

  app.get("/api/dm-requests", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const box = String(req.query.box ?? "incoming");
    const me = req.user!.id;
    if (box === "outgoing") {
      const rows = await prisma.dmRequest.findMany({
        where: { fromUserId: me, status: "pending" },
        include: { toUser: true },
        orderBy: { createdAt: "desc" },
      });
      res.json(
        rows.map((r) => ({
          id: r.id,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          user: toLiteUser(r.toUser),
        })),
      );
      return;
    }
    const rows = await prisma.dmRequest.findMany({
      where: { toUserId: me, status: "pending" },
      include: { fromUser: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        user: toLiteUser(r.fromUser),
      })),
    );
  });

  app.post("/api/dm-requests", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const { toUserId } = req.body ?? {};
    const target = typeof toUserId === "string" ? toUserId : "";
    const me = req.user!.id;
    if (!target || target === me) {
      res.status(400).json({ error: "invalid target" });
      return;
    }
    const other = await prisma.user.findUnique({ where: { id: target } });
    if (!other) {
      res.status(404).json({ error: "user not found" });
      return;
    }
    if (await areFriends(prisma, me, target)) {
      res.status(400).json({ error: "already_friends_use_open_dm" });
      return;
    }
    if (await canCreateNewDm(prisma, me, target)) {
      res.status(400).json({ error: "dm_already_allowed" });
      return;
    }
    const row = await prisma.dmRequest.upsert({
      where: { fromUserId_toUserId: { fromUserId: me, toUserId: target } },
      create: { fromUserId: me, toUserId: target, status: "pending" },
      update: { status: "pending", respondedAt: null, conversationId: null },
      include: { toUser: true, fromUser: true },
    });
    emitToUser(io, target, "dm:request:new", {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      user: toLiteUser(row.fromUser),
    });
    res.json({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      user: toLiteUser(row.toUser),
    });
  });

  app.post("/api/dm-requests/:requestId/accept", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const raw = req.params.requestId;
    const requestId = typeof raw === "string" ? raw : raw?.[0];
    if (!requestId) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    const me = req.user!.id;
    const dr = await prisma.dmRequest.findUnique({ where: { id: requestId } });
    if (!dr || dr.toUserId !== me) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (dr.status !== "pending") {
      res.status(400).json({ error: "not pending" });
      return;
    }
    const convId = await prisma.$transaction(async (tx) => {
      let cid = dr.conversationId;
      if (!cid) {
        const conv = await tx.conversation.create({
          data: {
            isGroup: false,
            participants: { create: [{ userId: dr.fromUserId }, { userId: dr.toUserId }] },
          },
        });
        cid = conv.id;
      }
      await tx.dmRequest.update({
        where: { id: dr.id },
        data: { status: "accepted", conversationId: cid, respondedAt: new Date() },
      });
      await tx.dmRequest.updateMany({
        where: {
          OR: [
            { fromUserId: dr.fromUserId, toUserId: dr.toUserId },
            { fromUserId: dr.toUserId, toUserId: dr.fromUserId },
          ],
          NOT: { id: dr.id },
          status: "pending",
        },
        data: { status: "cancelled", respondedAt: new Date() },
      });
      return cid!;
    });
    emitToUser(io, dr.fromUserId, "dm:request:updated", { id: dr.id, status: "accepted", conversationId: convId });
    emitToUser(io, me, "dm:request:updated", { id: dr.id, status: "accepted", conversationId: convId });
    res.json({ ok: true, conversationId: convId });
  });

  app.post("/api/dm-requests/:requestId/decline", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const raw = req.params.requestId;
    const requestId = typeof raw === "string" ? raw : raw?.[0];
    if (!requestId) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    const me = req.user!.id;
    const dr = await prisma.dmRequest.findUnique({ where: { id: requestId } });
    if (!dr || dr.toUserId !== me) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    await prisma.dmRequest.update({
      where: { id: requestId },
      data: { status: "declined", respondedAt: new Date() },
    });
    emitToUser(io, dr.fromUserId, "dm:request:updated", { id: dr.id, status: "declined" });
    res.json({ ok: true });
  });
}
