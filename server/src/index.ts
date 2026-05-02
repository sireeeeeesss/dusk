import dotenv from "dotenv";
import express from "express";
import "express-async-errors";
import cors from "cors";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server as IOServer } from "socket.io";
import { registerRoutes } from "./routes.js";
import { getUserFromToken } from "./auth.js";
import { prisma } from "./db.js";
import { serializeChannelMessage, serializeDmMessage } from "./serializers.js";
import { resolveChannelMentions, resolveDmMentions, serializeMentionIds } from "./mentions.js";
import { isTextChannel } from "./channelPolicy.js";
import { notifyChannelMessage, notifyDmMessage } from "./notify.js";
import { friendUserIds } from "./social.js";
import { renderInviteOgHtml, shouldServeInviteOg } from "./inviteOg.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

if (!process.env.DATABASE_URL?.trim()) {
  console.error("[dusk] Missing DATABASE_URL — add it in Replit Secrets.");
  process.exit(1);
}

const clientDist = path.resolve(__dirname, "../../client/dist");

const app = express();
const httpServer = createServer(app);
const io = new IOServer(httpServer, {
  cors: { origin: true, credentials: true },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.get("/health", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});
registerRoutes(app, io);

/** Rich link previews (Discord, Slack, iMessage, etc.) — bots get OG HTML; humans fall through to the SPA. */
app.get("/invite/:code", async (req, res, next) => {
  if (!shouldServeInviteOg(req)) {
    next();
    return;
  }
  try {
    const html = await renderInviteOgHtml(req, req.params.code);
    res.type("html").send(html);
  } catch (e) {
    console.error("[dusk invite og]", e);
    next();
  }
});

const ui = process.env.CLIENT_URL ?? "http://127.0.0.1:5173";

if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else {
  app.get("/", (_req, res) => {
    res.redirect(302, ui);
  });
}

const isProd = process.env.NODE_ENV === "production";

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) return;
  console.error("[dusk api]", err);
  const code =
    err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "LIMIT_FILE_SIZE"
      ? 413
      : 500;
  const msg =
    code === 413
      ? "file too large"
      : !isProd && err instanceof Error
        ? err.message
        : "internal server error";
  res.status(code).json({ error: msg });
});

type SocketUser = { id: string; username: string; displayName: string; avatarHue: number };

const socketOnlineCounts = new Map<string, number>();

function bumpSocketOnline(userId: string): number {
  const n = (socketOnlineCounts.get(userId) ?? 0) + 1;
  socketOnlineCounts.set(userId, n);
  return n;
}

function bumpSocketOffline(userId: string): number {
  const n = Math.max(0, (socketOnlineCounts.get(userId) ?? 0) - 1);
  socketOnlineCounts.set(userId, n);
  return n;
}

async function broadcastPresence(userId: string, isOnline: boolean): Promise<void> {
  const now = new Date();
  await prisma.userPresence.upsert({
    where: { userId },
    create: { userId, isOnline, lastSeenAt: now },
    update: { isOnline, lastSeenAt: now },
  });
  const friends = await friendUserIds(prisma, userId);
  const payload = { userId, isOnline, lastSeenAt: now.toISOString() };
  for (const fid of friends) {
    io.to(`user:${fid}`).emit("presence:update", payload);
  }
}

function voiceRoom(channelId: string): string {
  return `voice-ch:${channelId}`;
}

async function broadcastVoiceRoster(io: IOServer, channelId: string): Promise<void> {
  const room = voiceRoom(channelId);
  const sockets = await io.in(room).fetchSockets();
  const roster = sockets.map((s) => {
    const u = s.data.user as SocketUser;
    return { id: u.id, username: u.username, displayName: u.displayName, avatarHue: u.avatarHue };
  });
  io.to(room).emit("voice:roster", { channelId, roster });
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  const user = await getUserFromToken(token);
  if (!user) {
    next(new Error("unauthorized"));
    return;
  }
  socket.data.user = user as SocketUser;
  next();
});

io.on("connection", (socket) => {
  const me = socket.data.user as SocketUser;
  socket.join(`user:${me.id}`);

  if (bumpSocketOnline(me.id) === 1) {
    void broadcastPresence(me.id, true);
  }

  socket.on("disconnect", () => {
    if (bumpSocketOffline(me.id) === 0) {
      void broadcastPresence(me.id, false);
    }
  });

  socket.on("channel:join", async (channelId: string, cb?: (err?: string) => void) => {
    try {
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: { server: { include: { memberships: true } } },
      });
      if (!channel) {
        cb?.("not found");
        return;
      }
      const ok = channel.server.memberships.some((m) => m.userId === me.id);
      if (!ok) {
        cb?.("forbidden");
        return;
      }
      const rooms = Array.from(socket.rooms).filter((r) => r.startsWith("ch:") || r.startsWith("dm:"));
      for (const r of rooms) socket.leave(r);
      socket.join(`ch:${channelId}`);
      cb?.();
    } catch {
      cb?.("error");
    }
  });

  socket.on(
    "message:send",
    async (payload: { channelId: string; content: string }, cb?: (err?: string, msg?: unknown) => void) => {
      try {
        const { channelId, content } = payload ?? {};
        if (!channelId || !content?.trim()) {
          cb?.("bad request");
          return;
        }
        const channel = await prisma.channel.findUnique({
          where: { id: channelId },
          include: { server: { include: { memberships: { include: { user: true } } } } },
        });
        if (!channel) {
          cb?.("not found");
          return;
        }
        const member = channel.server.memberships.some((m) => m.userId === me.id);
        if (!member) {
          cb?.("forbidden");
          return;
        }
        if (!isTextChannel(channel)) {
          cb?.("voice channel");
          return;
        }
        const members = channel.server.memberships.map((m) => ({ userId: m.userId, username: m.user.username }));
        const mentionIds = serializeMentionIds(resolveChannelMentions(String(content), members, me.id));
        const msg = await prisma.message.create({
          data: {
            channelId,
            authorId: me.id,
            content: String(content).slice(0, 4000),
            mentionIds,
          },
          include: { author: true, reactions: true },
        });
        const out = serializeChannelMessage(msg);
        io.to(`ch:${channelId}`).emit("message:new", out);
        notifyChannelMessage(io, {
          memberUserIds: channel.server.memberships.map((m) => m.userId),
          authorId: me.id,
          serverId: channel.serverId,
          channelId,
        });
        cb?.(undefined, out);
      } catch {
        cb?.("error");
      }
    },
  );

  socket.on("server:join", async (serverId: string, cb?: (err?: string) => void) => {
    try {
      if (!serverId) {
        cb?.("bad request");
        return;
      }
      const srv = await prisma.server.findUnique({
        where: { id: serverId },
        include: { memberships: true },
      });
      if (!srv?.memberships.some((m) => m.userId === me.id)) {
        cb?.("forbidden");
        return;
      }
      socket.join(`srv:${serverId}`);
      cb?.();
    } catch {
      cb?.("error");
    }
  });

  socket.on("server:leave", (serverId: string) => {
    if (serverId) socket.leave(`srv:${serverId}`);
  });

  socket.on("voice:join", async (channelId: string, cb?: (err?: string) => void) => {
    try {
      if (!channelId) {
        cb?.("bad request");
        return;
      }
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: { server: { include: { memberships: true } } },
      });
      if (!channel || channel.kind !== "voice") {
        cb?.("not found");
        return;
      }
      if (!channel.server.memberships.some((m) => m.userId === me.id)) {
        cb?.("forbidden");
        return;
      }
      for (const r of socket.rooms) {
        if (r.startsWith("voice-ch:")) socket.leave(r);
      }
      socket.join(voiceRoom(channelId));
      await broadcastVoiceRoster(io, channelId);
      cb?.();
    } catch {
      cb?.("error");
    }
  });

  socket.on("voice:leave", async (channelId: string, cb?: (err?: string) => void) => {
    try {
      if (channelId) {
        socket.leave(voiceRoom(channelId));
        await broadcastVoiceRoster(io, channelId);
      }
      cb?.();
    } catch {
      cb?.("error");
    }
  });

  socket.on(
    "voice:signal",
    async (
      payload: { channelId: string; to: string; data: unknown },
      cb?: (err?: string) => void,
    ) => {
      try {
        const { channelId, to, data } = payload ?? ({} as { channelId?: string; to?: string; data?: unknown });
        if (!channelId || !to) {
          cb?.("bad request");
          return;
        }
        const room = voiceRoom(channelId);
        if (!socket.rooms.has(room)) {
          cb?.("forbidden");
          return;
        }
        const inRoom = await io.in(room).fetchSockets();
        if (!inRoom.some((s) => s.id === socket.id)) {
          cb?.("forbidden");
          return;
        }
        if (!inRoom.some((s) => s.data.user.id === to)) {
          cb?.("gone");
          return;
        }
        for (const s of inRoom) {
          if (s.data.user.id === to) {
            s.emit("voice:signal", { from: me.id, data });
          }
        }
        cb?.();
      } catch {
        cb?.("error");
      }
    },
  );

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms];
    for (const r of rooms) {
      if (r.startsWith("voice-ch:")) {
        const channelId = r.slice("voice-ch:".length);
        void broadcastVoiceRoster(io, channelId);
      }
    }
  });

  socket.on("typing:channel", async (payload: { channelId?: string; active?: boolean }) => {
    try {
      const { channelId, active } = payload ?? {};
      if (!channelId) return;
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: { server: { include: { memberships: true } } },
      });
      if (!channel?.server.memberships.some((m) => m.userId === me.id)) return;
      socket.to(`ch:${channelId}`).emit("typing:channel", {
        channelId,
        user: { id: me.id, displayName: me.displayName },
        active: !!active,
      });
    } catch {
      /* ignore */
    }
  });

  socket.on("typing:dm", async (payload: { conversationId?: string; active?: boolean }) => {
    try {
      const { conversationId, active } = payload ?? {};
      if (!conversationId) return;
      const part = await prisma.conversationParticipant.findFirst({
        where: { conversationId, userId: me.id },
      });
      if (!part) return;
      socket.to(`dm:${conversationId}`).emit("typing:dm", {
        conversationId,
        user: { id: me.id, displayName: me.displayName },
        active: !!active,
      });
    } catch {
      /* ignore */
    }
  });

  socket.on("dm:join", async (conversationId: string, cb?: (err?: string) => void) => {
    try {
      const part = await prisma.conversationParticipant.findFirst({
        where: { conversationId, userId: me.id },
      });
      if (!part) {
        cb?.("forbidden");
        return;
      }
      const rooms = Array.from(socket.rooms).filter((r) => r.startsWith("ch:") || r.startsWith("dm:"));
      for (const r of rooms) socket.leave(r);
      socket.join(`dm:${conversationId}`);
      cb?.();
    } catch {
      cb?.("error");
    }
  });

  socket.on(
    "dm:message:send",
    async (payload: { conversationId: string; content: string }, cb?: (err?: string, msg?: unknown) => void) => {
      try {
        const { conversationId, content } = payload ?? {};
        if (!conversationId || !content?.trim()) {
          cb?.("bad request");
          return;
        }
        const part = await prisma.conversationParticipant.findFirst({
          where: { conversationId, userId: me.id },
        });
        if (!part) {
          cb?.("forbidden");
          return;
        }
        const conv = await prisma.conversation.findUnique({
          where: { id: conversationId },
          include: { participants: { include: { user: true } } },
        });
        if (!conv) {
          cb?.("not found");
          return;
        }
        const participants = conv.participants.map((p) => ({ userId: p.userId, username: p.user.username }));
        const mentionIds = serializeMentionIds(resolveDmMentions(String(content), participants, me.id));
        const msg = await prisma.dmMessage.create({
          data: {
            conversationId,
            authorId: me.id,
            content: String(content).slice(0, 4000),
            mentionIds,
          },
          include: { author: true },
        });
        const out = serializeDmMessage(msg);
        io.to(`dm:${conversationId}`).emit("dm:message:new", out);
        notifyDmMessage(io, {
          participantUserIds: conv.participants.map((p) => p.userId),
          authorId: me.id,
          conversationId,
        });
        cb?.(undefined, out);
      } catch {
        cb?.("error");
      }
    },
  );
});

/** Replit sets `PORT`; local default was 3333 to avoid clashing with random `3000` apps. */
const onReplit = Boolean(process.env.REPL_ID ?? process.env.REPLIT_DEPLOYMENT);
const PORT = Number(process.env.PORT) || (onReplit ? 3000 : 3333);

try {
  await prisma.$connect();
} catch (e) {
  console.error(
    "[dusk] database unreachable — set DATABASE_URL, run `docker compose up -d` (repo root), then `npm run db:push`",
    e instanceof Error ? e.message : e,
  );
  process.exit(1);
}

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`dusk api + ws on http://0.0.0.0:${PORT}`);
});
