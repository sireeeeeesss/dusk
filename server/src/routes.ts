import type { Express, Response } from "express";
import type { Server as IOServer } from "socket.io";
import multer from "multer";
import type { AuthedRequest } from "./auth.js";
import { authMiddleware, comparePassword, hashPassword, signToken } from "./auth.js";
import { generateOtp6, hashOtp, OTP_EXPIRY_MS, RESEND_COOLDOWN_MS, verifyOtp } from "./authCodes.js";
import { sendMail } from "./mail.js";
import { resetPasswordContent, verifyEmailContent } from "./emailTemplates.js";
import { notifyChannelMessage, notifyDmMessage } from "./notify.js";
import { registerSocialRoutes } from "./socialRoutes.js";
import { normalizeInviteCodeParam } from "./inviteShared.js";
import { canCreateNewDm } from "./social.js";
import { prisma } from "./db.js";
import { randomBytes } from "node:crypto";
import {
  deleteServerIconVariants,
  deleteUserAvatarVariants,
  deleteUserBannerVariants,
  extFromMime,
  audioStorageExt,
  canonicalAudioMime,
  canonicalVideoMime,
  videoStorageExt,
} from "./uploads.js";
import { ensureUploadDirs, mediaKey, readMedia, writeMedia } from "./mediaStore.js";
import {
  serializeChannelMessage,
  serializeDmMessage,
  serializeServer,
  toPublicUser,
  toSessionUser,
  toLiteUser,
} from "./serializers.js";
import { resolveChannelMentions, resolveDmMentions, serializeMentionIds } from "./mentions.js";
import { canManageChannels, isTextChannel } from "./channelPolicy.js";
import { removeChannelMessageFiles, removeDmMessageFiles } from "./messageCleanup.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(null, false);
  },
});

const uploadVideo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 48 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mt = (file.mimetype || "").toLowerCase();
    if (mt.startsWith("video/")) {
      cb(null, true);
      return;
    }
    if (mt === "application/octet-stream" || mt === "") {
      const n = (file.originalname || "").toLowerCase();
      if (/\.(mp4|m4v|webm|mov|mkv|avi|ogv|mpeg|mpg)$/i.test(n)) {
        cb(null, true);
        return;
      }
    }
    cb(null, false);
  },
});

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mt = (file.mimetype || "").toLowerCase();
    if (mt.startsWith("audio/")) {
      cb(null, true);
      return;
    }
    if (mt === "application/octet-stream" || mt === "") {
      const n = (file.originalname || "").toLowerCase();
      if (/\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|webm)$/i.test(n)) {
        cb(null, true);
        return;
      }
    }
    cb(null, false);
  },
});

function inviteCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

async function findOrCreateDm(userId: string, otherUserId: string): Promise<string> {
  if (userId === otherUserId) throw new Error("cannot dm yourself");
  const other = await prisma.user.findUnique({ where: { id: otherUserId } });
  if (!other) throw new Error("user not found");

  const mine = await prisma.conversationParticipant.findMany({
    where: { userId },
    include: {
      conversation: {
        include: { participants: true },
      },
    },
  });
  for (const row of mine) {
    const { conversation } = row;
    if (conversation.isGroup) continue;
    const ids = conversation.participants.map((p) => p.userId);
    if (ids.length === 2 && ids.includes(otherUserId)) {
      return conversation.id;
    }
  }

  const allowed = await canCreateNewDm(prisma, userId, otherUserId);
  if (!allowed) {
    throw new Error("dm_request_required");
  }

  const conv = await prisma.conversation.create({
    data: {
      isGroup: false,
      participants: {
        create: [{ userId }, { userId: otherUserId }],
      },
    },
  });
  return conv.id;
}

export function registerRoutes(app: Express, io: IOServer): void {
  ensureUploadDirs();

  app.get("/api/invites/:code/icon", async (req, res) => {
    const code = normalizeInviteCodeParam(req.params.code);
    if (!code) {
      res.status(400).end();
      return;
    }
    const srv = await prisma.server.findUnique({ where: { inviteCode: code } });
    if (!srv?.iconMime) {
      res.status(404).end();
      return;
    }
    const ext = extFromMime(srv.iconMime);
    const buf = await readMedia(mediaKey.serverIcon(srv.id, ext));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", srv.iconMime);
    res.setHeader("Cache-Control", "public, max-age=600");
    res.send(buf);
  });

  app.get("/api/invites/:code", async (req, res) => {
    const code = normalizeInviteCodeParam(req.params.code);
    if (!code) {
      res.status(400).json({ error: "bad invite code" });
      return;
    }
    const server = await prisma.server.findUnique({
      where: { inviteCode: code },
      include: { _count: { select: { memberships: true, channels: true } } },
    });
    if (!server) {
      res.status(404).json({ error: "invalid invite" });
      return;
    }
    res.json({
      name: server.name,
      memberCount: server._count.memberships,
      channelCount: server._count.channels,
      iconUrl: server.iconMime ? `/api/invites/${encodeURIComponent(code)}/icon` : null,
    });
  });

  app.post("/api/auth/register", async (req, res) => {
    const { email, username, password, displayName } = req.body ?? {};
    if (!email || !username || !password) {
      res.status(400).json({ error: "email, username, password required" });
      return;
    }
    const exists = await prisma.user.findFirst({
      where: { OR: [{ email: String(email) }, { username: String(username) }] },
    });
    if (exists) {
      res.status(409).json({ error: "email or username taken" });
      return;
    }
    const passwordHash = await hashPassword(String(password));
    const hue = Math.floor(Math.random() * 360);
    const user = await prisma.user.create({
      data: {
        email: String(email).toLowerCase(),
        username: String(username),
        passwordHash,
        emailVerified: false,
        displayName: displayName ? String(displayName) : String(username),
        avatarHue: hue,
      },
    });
    const code = generateOtp6();
    const emailVerificationCodeHash = await hashOtp(code);
    const emailVerificationCodeExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCodeHash,
        emailVerificationCodeExpiresAt,
        emailVerificationSentAt: new Date(),
      },
    });
    const mailBody = verifyEmailContent(code);
    try {
      await sendMail({ to: user.email, ...mailBody });
    } catch (e) {
      console.error("[dusk] verification email failed", e);
    }
    res.json({ needsVerification: true, email: user.email });
  });

  app.post("/api/auth/verify-email/request", async (req, res) => {
    const { email } = req.body ?? {};
    if (!email) {
      res.status(400).json({ error: "email required" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    res.json({ ok: true });
    if (!user || user.emailVerified) return;
    if (
      user.emailVerificationSentAt &&
      Date.now() - user.emailVerificationSentAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      return;
    }
    const code = generateOtp6();
    const emailVerificationCodeHash = await hashOtp(code);
    const emailVerificationCodeExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCodeHash,
        emailVerificationCodeExpiresAt,
        emailVerificationSentAt: new Date(),
      },
    });
    const mailBody = verifyEmailContent(code);
    try {
      await sendMail({ to: user.email, ...mailBody });
    } catch (e) {
      console.error("[dusk] verification resend failed", e);
    }
  });

  app.post("/api/auth/verify-email/confirm", async (req, res) => {
    const { email, code } = req.body ?? {};
    if (!email || !code) {
      res.status(400).json({ error: "email and code required" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (
      !user ||
      user.emailVerified ||
      !user.emailVerificationCodeHash ||
      !user.emailVerificationCodeExpiresAt ||
      user.emailVerificationCodeExpiresAt < new Date()
    ) {
      res.status(400).json({ error: "invalid or expired code" });
      return;
    }
    const ok = await verifyOtp(String(code).trim(), user.emailVerificationCodeHash);
    if (!ok) {
      res.status(400).json({ error: "invalid or expired code" });
      return;
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationCodeHash: null,
        emailVerificationCodeExpiresAt: null,
      },
    });
    const token = signToken(updated.id, updated.username);
    res.json({ token, user: toSessionUser(updated) });
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body ?? {};
    res.json({ ok: true });
    if (!email) return;
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!user) return;
    if (
      user.passwordResetSentAt &&
      Date.now() - user.passwordResetSentAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      return;
    }
    const code = generateOtp6();
    const passwordResetCodeHash = await hashOtp(code);
    const passwordResetCodeExpiresAt = new Date(Date.now() + OTP_EXPIRY_MS);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetCodeHash,
        passwordResetCodeExpiresAt,
        passwordResetSentAt: new Date(),
      },
    });
    const mailBody = resetPasswordContent(code);
    try {
      await sendMail({ to: user.email, ...mailBody });
    } catch (e) {
      console.error("[dusk] reset email failed", e);
    }
  });

  app.post("/api/auth/reset-password/confirm", async (req, res) => {
    const { email, code, newPassword } = req.body ?? {};
    if (!email || !code || !newPassword) {
      res.status(400).json({ error: "email, code, and newPassword required" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (
      !user ||
      !user.passwordResetCodeHash ||
      !user.passwordResetCodeExpiresAt ||
      user.passwordResetCodeExpiresAt < new Date()
    ) {
      res.status(400).json({ error: "invalid or expired code" });
      return;
    }
    const ok = await verifyOtp(String(code).trim(), user.passwordResetCodeHash);
    if (!ok) {
      res.status(400).json({ error: "invalid or expired code" });
      return;
    }
    const passwordHash = await hashPassword(String(newPassword));
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordResetCodeHash: null,
        passwordResetCodeExpiresAt: null,
      },
    });
    const token = signToken(updated.id, updated.username);
    res.json({ token, user: toSessionUser(updated) });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      res.status(400).json({ error: "email and password required" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (!user || !(await comparePassword(String(password), user.passwordHash))) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }
    if (!user.emailVerified) {
      res.status(403).json({ error: "email_not_verified" });
      return;
    }
    const token = signToken(user.id, user.username);
    res.json({ token, user: toSessionUser(user) });
  });

  app.get("/api/me", authMiddleware, async (req: AuthedRequest, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(toSessionUser(user));
  });

  app.patch("/api/me", authMiddleware, async (req: AuthedRequest, res) => {
    const { displayName, avatarHue, accentHue, bio, customStatus, username } = req.body ?? {};
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) {
      res.status(404).json({ error: "not found" });
      return;
    }
    let newUsername = user.username;
    if (username !== undefined && String(username) !== user.username) {
      const taken = await prisma.user.findUnique({ where: { username: String(username) } });
      if (taken) {
        res.status(409).json({ error: "username taken" });
        return;
      }
      newUsername = String(username);
    }
    const data: {
      displayName?: string;
      avatarHue?: number;
      accentHue?: number;
      bio?: string;
      customStatus?: string;
      username?: string;
    } = {};
    if (displayName !== undefined) data.displayName = String(displayName).slice(0, 64);
    if (typeof avatarHue === "number") data.avatarHue = Math.min(359, Math.max(0, avatarHue));
    if (typeof accentHue === "number") data.accentHue = Math.min(359, Math.max(0, accentHue));
    if (bio !== undefined) data.bio = String(bio).slice(0, 190);
    if (customStatus !== undefined) data.customStatus = String(customStatus).slice(0, 100);
    if (username !== undefined) data.username = newUsername;
    if (Object.keys(data).length === 0) {
      res.json({ token: signToken(user.id, user.username), user: toSessionUser(user) });
      return;
    }
    const updated = await prisma.user.update({ where: { id: user.id }, data });
    const token = signToken(updated.id, updated.username);
    res.json({ token, user: toSessionUser(updated) });
  });

  app.post("/api/me/avatar", authMiddleware, uploadImage.single("image"), async (req: AuthedRequest, res) => {
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: "image required" });
      return;
    }
    const mime = req.file.mimetype || "image/png";
    const ext = extFromMime(mime);
    await deleteUserAvatarVariants(req.user!.id);
    await writeMedia(mediaKey.userAvatar(req.user!.id, ext), req.file.buffer, mime);
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatarImageMime: mime },
    });
    const token = signToken(updated.id, updated.username);
    res.json({ token, user: toSessionUser(updated) });
  });

  app.delete("/api/me/avatar", authMiddleware, async (req: AuthedRequest, res) => {
    await deleteUserAvatarVariants(req.user!.id);
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatarImageMime: null },
    });
    const token = signToken(updated.id, updated.username);
    res.json({ token, user: toSessionUser(updated) });
  });

  app.post("/api/me/banner", authMiddleware, uploadImage.single("image"), async (req: AuthedRequest, res) => {
    if (!req.file?.buffer?.length) {
      res.status(400).json({ error: "image required" });
      return;
    }
    const mime = req.file.mimetype || "image/png";
    const ext = extFromMime(mime);
    await deleteUserBannerVariants(req.user!.id);
    await writeMedia(mediaKey.userBanner(req.user!.id, ext), req.file.buffer, mime);
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { bannerImageMime: mime },
    });
    const token = signToken(updated.id, updated.username);
    res.json({ token, user: toSessionUser(updated) });
  });

  app.delete("/api/me/banner", authMiddleware, async (req: AuthedRequest, res) => {
    await deleteUserBannerVariants(req.user!.id);
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { bannerImageMime: null },
    });
    const token = signToken(updated.id, updated.username);
    res.json({ token, user: toSessionUser(updated) });
  });

  app.get("/api/media/user/:userId/avatar", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.userId;
    const userId = typeof raw === "string" ? raw : raw?.[0];
    if (!userId) {
      res.status(400).end();
      return;
    }
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (!u?.avatarImageMime) {
      res.status(404).end();
      return;
    }
    const ext = extFromMime(u.avatarImageMime);
    const buf = await readMedia(mediaKey.userAvatar(userId, ext));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", u.avatarImageMime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(buf);
  });

  app.get("/api/media/user/:userId/banner", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.userId;
    const userId = typeof raw === "string" ? raw : raw?.[0];
    if (!userId) {
      res.status(400).end();
      return;
    }
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (!u?.bannerImageMime) {
      res.status(404).end();
      return;
    }
    const ext = extFromMime(u.bannerImageMime);
    const buf = await readMedia(mediaKey.userBanner(userId, ext));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", u.bannerImageMime);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(buf);
  });

  app.post("/api/me/password", authMiddleware, async (req: AuthedRequest, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: "currentPassword and newPassword required" });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await comparePassword(String(currentPassword), user.passwordHash))) {
      res.status(401).json({ error: "wrong password" });
      return;
    }
    const passwordHash = await hashPassword(String(newPassword));
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ ok: true });
  });

  app.get("/api/dms", authMiddleware, async (req: AuthedRequest, res) => {
    const rows = await prisma.conversationParticipant.findMany({
      where: { userId: req.user!.id },
      include: {
        conversation: {
          include: {
            participants: { include: { user: true } },
            messages: { orderBy: { createdAt: "desc" }, take: 1, include: { author: true } },
          },
        },
      },
      orderBy: { id: "desc" },
    });
    const out = rows
      .filter((r) => !r.conversation.isGroup)
      .map((r) => {
        const other = r.conversation.participants.map((p) => p.user).find((u) => u.id !== req.user!.id);
        const last = r.conversation.messages[0];
        return {
          id: r.conversation.id,
          other: other ? toLiteUser(other) : null,
          lastMessage: last
            ? {
                ...serializeDmMessage(last),
              }
            : null,
        };
      });
    res.json(out);
  });

  app.post("/api/dms/open", authMiddleware, async (req: AuthedRequest, res) => {
    const { userId } = req.body ?? {};
    if (!userId) {
      res.status(400).json({ error: "userId required" });
      return;
    }
    try {
      const id = await findOrCreateDm(req.user!.id, String(userId));
      res.json({ conversationId: id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "error";
      if (msg === "cannot dm yourself") {
        res.status(400).json({ error: msg });
        return;
      }
      if (msg === "user not found") {
        res.status(404).json({ error: msg });
        return;
      }
      if (msg === "dm_request_required") {
        res.status(403).json({ error: "dm_request_required" });
        return;
      }
      res.status(500).json({ error: "server oops" });
    }
  });

  app.get("/api/dms/:conversationId/peer", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.conversationId;
    const conversationId = typeof raw === "string" ? raw : raw?.[0];
    if (!conversationId) {
      res.status(400).json({ error: "bad conversation" });
      return;
    }
    const mine = await prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: req.user!.id },
    });
    if (!mine) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const other = await prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: { not: req.user!.id } },
      include: { user: true },
    });
    res.json({ other: other?.user ? toLiteUser(other.user) : null });
  });

  app.get("/api/dms/:conversationId/messages", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.conversationId;
    const conversationId = typeof raw === "string" ? raw : raw?.[0];
    if (!conversationId) {
      res.status(400).json({ error: "bad conversation" });
      return;
    }
    const part = await prisma.conversationParticipant.findFirst({
      where: { conversationId, userId: req.user!.id },
    });
    if (!part) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const msgs = await prisma.dmMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { author: true },
    });
    res.json(msgs.map((m) => serializeDmMessage(m)));
  });

  app.patch("/api/dm-messages/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    const { content } = req.body ?? {};
    const text = typeof content === "string" ? String(content).trim().slice(0, 4000) : "";
    if (!messageId || !text) {
      res.status(400).json({ error: "content required" });
      return;
    }
    const msg = await prisma.dmMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { participants: { include: { user: true } } } } },
    });
    if (!msg) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const part = msg.conversation.participants.some((p) => p.userId === req.user!.id);
    if (!part) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (msg.authorId !== req.user!.id) {
      res.status(403).json({ error: "only author can edit" });
      return;
    }
    if (msg.hasVoice || msg.hasImage || msg.hasVideo || msg.hasAudio) {
      res.status(400).json({ error: "cannot edit media messages" });
      return;
    }
    const participants = msg.conversation.participants.map((p) => ({ userId: p.userId, username: p.user.username }));
    const mentionIds = serializeMentionIds(resolveDmMentions(text, participants, req.user!.id));
    const updated = await prisma.dmMessage.update({
      where: { id: messageId },
      data: { content: text, mentionIds, editedAt: new Date() },
      include: { author: true },
    });
    const out = serializeDmMessage(updated);
    io.to(`dm:${msg.conversationId}`).emit("dm:message:patch", out);
    res.json(out);
  });

  app.delete("/api/dm-messages/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    if (!messageId) {
      res.status(400).json({ error: "bad message" });
      return;
    }
    const msg = await prisma.dmMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { participants: true } } },
    });
    if (!msg) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const part = msg.conversation.participants.some((p) => p.userId === req.user!.id);
    if (!part) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (msg.authorId !== req.user!.id) {
      res.status(403).json({ error: "only author can delete" });
      return;
    }
    const convId = msg.conversationId;
    await removeDmMessageFiles(msg);
    await prisma.dmMessage.delete({ where: { id: messageId } });
    io.to(`dm:${convId}`).emit("dm:message:delete", { conversationId: convId, messageId });
    res.json({ ok: true });
  });

  app.post(
    "/api/dms/:conversationId/messages/voice",
    authMiddleware,
    upload.single("audio"),
    async (req: AuthedRequest, res) => {
      const raw = req.params.conversationId;
      const conversationId = typeof raw === "string" ? raw : raw?.[0];
      if (!conversationId || !req.file?.buffer?.length) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const part = await prisma.conversationParticipant.findFirst({
        where: { conversationId, userId: req.user!.id },
      });
      if (!part) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: { include: { user: true } } },
      });
      if (!conv) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const mime = req.file.mimetype || "audio/webm";
      const caption = typeof req.body?.caption === "string" ? String(req.body.caption).slice(0, 4000) : "";
      const text = caption.trim() || "🎤 voice message";
      const participants = conv.participants.map((p) => ({ userId: p.userId, username: p.user.username }));
      const mentionIds = serializeMentionIds(resolveDmMentions(text, participants, req.user!.id));
      const msg = await prisma.dmMessage.create({
        data: {
          conversationId,
          authorId: req.user!.id,
          content: text,
          hasVoice: true,
          voiceMime: mime,
          mentionIds,
        },
        include: { author: true },
      });
      await writeMedia(mediaKey.dmVoice(msg.id), req.file.buffer, mime);
      const out = serializeDmMessage(msg);
      io.to(`dm:${conversationId}`).emit("dm:message:new", out);
      notifyDmMessage(io, {
        participantUserIds: conv.participants.map((p) => p.userId),
        authorId: req.user!.id,
        conversationId,
      });
      res.json(out);
    },
  );

  app.post(
    "/api/dms/:conversationId/messages/image",
    authMiddleware,
    uploadImage.single("image"),
    async (req: AuthedRequest, res) => {
      const raw = req.params.conversationId;
      const conversationId = typeof raw === "string" ? raw : raw?.[0];
      if (!conversationId || !req.file?.buffer?.length) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const part = await prisma.conversationParticipant.findFirst({
        where: { conversationId, userId: req.user!.id },
      });
      if (!part) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: { include: { user: true } } },
      });
      if (!conv) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const mime = req.file.mimetype || "image/png";
      const caption = typeof req.body?.caption === "string" ? String(req.body.caption).slice(0, 4000) : "";
      const text = caption.trim() || "📷 image";
      const participants = conv.participants.map((p) => ({ userId: p.userId, username: p.user.username }));
      const mentionIds = serializeMentionIds(resolveDmMentions(text, participants, req.user!.id));
      const ext = extFromMime(mime);
      const msg = await prisma.dmMessage.create({
        data: {
          conversationId,
          authorId: req.user!.id,
          content: text,
          hasImage: true,
          imageMime: mime,
          mentionIds,
        },
        include: { author: true },
      });
      await writeMedia(mediaKey.dmImage(msg.id, ext), req.file.buffer, mime);
      const out = serializeDmMessage(msg);
      io.to(`dm:${conversationId}`).emit("dm:message:new", out);
      notifyDmMessage(io, {
        participantUserIds: conv.participants.map((p) => p.userId),
        authorId: req.user!.id,
        conversationId,
      });
      res.json(out);
    },
  );

  app.post(
    "/api/dms/:conversationId/messages/video",
    authMiddleware,
    uploadVideo.single("video"),
    async (req: AuthedRequest, res) => {
      const raw = req.params.conversationId;
      const conversationId = typeof raw === "string" ? raw : raw?.[0];
      if (!conversationId || !req.file?.buffer?.length) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const part = await prisma.conversationParticipant.findFirst({
        where: { conversationId, userId: req.user!.id },
      });
      if (!part) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: { include: { user: true } } },
      });
      if (!conv) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const vf = req.file;
      const mime = canonicalVideoMime(vf);
      const ext = videoStorageExt(vf);
      const caption = typeof req.body?.caption === "string" ? String(req.body.caption).slice(0, 4000) : "";
      const text = caption.trim() || "🎬 video";
      const participants = conv.participants.map((p) => ({ userId: p.userId, username: p.user.username }));
      const mentionIds = serializeMentionIds(resolveDmMentions(text, participants, req.user!.id));
      const msg = await prisma.dmMessage.create({
        data: {
          conversationId,
          authorId: req.user!.id,
          content: text,
          hasVideo: true,
          videoMime: mime,
          mentionIds,
        },
        include: { author: true },
      });
      await writeMedia(mediaKey.dmVideo(msg.id, ext), vf.buffer, mime);
      const out = serializeDmMessage(msg);
      io.to(`dm:${conversationId}`).emit("dm:message:new", out);
      notifyDmMessage(io, {
        participantUserIds: conv.participants.map((p) => p.userId),
        authorId: req.user!.id,
        conversationId,
      });
      res.json(out);
    },
  );

  app.post(
    "/api/dms/:conversationId/messages/audio",
    authMiddleware,
    uploadAudio.single("audio"),
    async (req: AuthedRequest, res) => {
      const raw = req.params.conversationId;
      const conversationId = typeof raw === "string" ? raw : raw?.[0];
      if (!conversationId || !req.file?.buffer?.length) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const part = await prisma.conversationParticipant.findFirst({
        where: { conversationId, userId: req.user!.id },
      });
      if (!part) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: { include: { user: true } } },
      });
      if (!conv) {
        res.status(404).json({ error: "not found" });
        return;
      }
      const af = req.file;
      const mime = canonicalAudioMime(af);
      const ext = audioStorageExt(af);
      const caption = typeof req.body?.caption === "string" ? String(req.body.caption).slice(0, 4000) : "";
      const text = caption.trim() || "🎵 audio";
      const participants = conv.participants.map((p) => ({ userId: p.userId, username: p.user.username }));
      const mentionIds = serializeMentionIds(resolveDmMentions(text, participants, req.user!.id));
      const msg = await prisma.dmMessage.create({
        data: {
          conversationId,
          authorId: req.user!.id,
          content: text,
          hasAudio: true,
          audioMime: mime,
          mentionIds,
        },
        include: { author: true },
      });
      await writeMedia(mediaKey.dmAudio(msg.id, ext), af.buffer, mime);
      const out = serializeDmMessage(msg);
      io.to(`dm:${conversationId}`).emit("dm:message:new", out);
      notifyDmMessage(io, {
        participantUserIds: conv.participants.map((p) => p.userId),
        authorId: req.user!.id,
        conversationId,
      });
      res.json(out);
    },
  );

  app.get("/api/servers", authMiddleware, async (req: AuthedRequest, res) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: req.user!.id },
      include: {
        server: {
          include: {
            channels: { orderBy: { position: "asc" } },
            memberships: { include: { user: true } },
          },
        },
      },
    });
    res.json(memberships.map((m) => serializeServer(m.server)));
  });

  app.post("/api/servers", authMiddleware, async (req: AuthedRequest, res) => {
    const { name } = req.body ?? {};
    if (!name) {
      res.status(400).json({ error: "name required" });
      return;
    }
    let code = inviteCode();
    for (let i = 0; i < 5; i++) {
      const clash = await prisma.server.findUnique({ where: { inviteCode: code } });
      if (!clash) break;
      code = inviteCode();
    }
    const server = await prisma.server.create({
      data: {
        name: String(name),
        inviteCode: code,
        ownerId: req.user!.id,
        memberships: { create: { userId: req.user!.id, role: "owner" } },
        channels: {
          create: [
            { name: "general", position: 0, kind: "text" },
            { name: "off-topic", position: 1, kind: "text" },
            { name: "voice lobby", position: 2, kind: "voice" },
          ],
        },
      },
      include: { channels: true, memberships: { include: { user: true } } },
    });
    res.json(serializeServer(server));
  });

  app.post("/api/servers/join", authMiddleware, async (req: AuthedRequest, res) => {
    const { inviteCode: code } = req.body ?? {};
    if (!code) {
      res.status(400).json({ error: "inviteCode required" });
      return;
    }
    const server = await prisma.server.findUnique({
      where: { inviteCode: String(code).toUpperCase() },
      include: { memberships: true },
    });
    if (!server) {
      res.status(404).json({ error: "invalid invite" });
      return;
    }
    const already = server.memberships.some((m) => m.userId === req.user!.id);
    if (!already) {
      await prisma.membership.create({
        data: { userId: req.user!.id, serverId: server.id, role: "member" },
      });
    }
    const full = await prisma.server.findUnique({
      where: { id: server.id },
      include: {
        channels: { orderBy: { position: "asc" } },
        memberships: { include: { user: true } },
      },
    });
    res.json(serializeServer(full!));
  });

  app.patch("/api/servers/:serverId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.serverId;
    const serverId = typeof raw === "string" ? raw : raw?.[0];
    const { name } = req.body ?? {};
    const label = typeof name === "string" ? name.trim().slice(0, 80) : "";
    if (!serverId || !label) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const srv = await prisma.server.findUnique({
      where: { id: serverId },
      include: { memberships: true },
    });
    if (!srv) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (srv.ownerId !== req.user!.id) {
      res.status(403).json({ error: "owner only" });
      return;
    }
    const updated = await prisma.server.update({
      where: { id: serverId },
      data: { name: label },
      include: { channels: { orderBy: { position: "asc" } }, memberships: { include: { user: true } } },
    });
    io.to(`srv:${serverId}`).emit("server:updated");
    res.json(serializeServer(updated));
  });

  app.post("/api/servers/:serverId/leave", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.serverId;
    const serverId = typeof raw === "string" ? raw : raw?.[0];
    if (!serverId) {
      res.status(400).json({ error: "bad server" });
      return;
    }
    const srv = await prisma.server.findUnique({
      where: { id: serverId },
      include: { memberships: true },
    });
    if (!srv) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (srv.ownerId === req.user!.id) {
      res.status(400).json({ error: "owner cannot leave — delete server or transfer (not implemented)" });
      return;
    }
    const m = srv.memberships.find((x) => x.userId === req.user!.id);
    if (!m) {
      res.status(400).json({ error: "not a member" });
      return;
    }
    await prisma.membership.delete({ where: { id: m.id } });
    io.to(`srv:${serverId}`).emit("server:updated");
    res.json({ ok: true });
  });

  app.delete("/api/servers/:serverId/members/:userId", authMiddleware, async (req: AuthedRequest, res) => {
    const rawS = req.params.serverId;
    const serverId = typeof rawS === "string" ? rawS : rawS?.[0];
    const rawU = req.params.userId;
    const targetUserId = typeof rawU === "string" ? rawU : rawU?.[0];
    if (!serverId || !targetUserId) {
      res.status(400).json({ error: "bad request" });
      return;
    }
    const srv = await prisma.server.findUnique({
      where: { id: serverId },
      include: { memberships: true },
    });
    if (!srv) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (srv.ownerId !== req.user!.id) {
      res.status(403).json({ error: "owner only" });
      return;
    }
    if (targetUserId === srv.ownerId) {
      res.status(400).json({ error: "cannot kick server owner" });
      return;
    }
    const target = srv.memberships.find((x) => x.userId === targetUserId);
    if (!target) {
      res.status(404).json({ error: "member not found" });
      return;
    }
    await prisma.membership.delete({ where: { id: target.id } });
    io.to(`srv:${serverId}`).emit("server:updated");
    res.json({ ok: true });
  });

  app.patch("/api/servers/:serverId/members/:userId", authMiddleware, async (req: AuthedRequest, res) => {
    const rawS = req.params.serverId;
    const serverId = typeof rawS === "string" ? rawS : rawS?.[0];
    const rawU = req.params.userId;
    const targetUserId = typeof rawU === "string" ? rawU : rawU?.[0];
    const { role } = req.body ?? {};
    const r = typeof role === "string" ? role.trim().toLowerCase() : "";
    if (!serverId || !targetUserId || (r !== "member" && r !== "admin")) {
      res.status(400).json({ error: "role must be member or admin" });
      return;
    }
    const srv = await prisma.server.findUnique({
      where: { id: serverId },
      include: { memberships: true },
    });
    if (!srv) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (srv.ownerId !== req.user!.id) {
      res.status(403).json({ error: "owner only" });
      return;
    }
    if (targetUserId === srv.ownerId) {
      res.status(400).json({ error: "cannot change owner row this way" });
      return;
    }
    const target = srv.memberships.find((x) => x.userId === targetUserId);
    if (!target) {
      res.status(404).json({ error: "member not found" });
      return;
    }
    await prisma.membership.update({ where: { id: target.id }, data: { role: r } });
    const updated = await prisma.server.findUnique({
      where: { id: serverId },
      include: { channels: { orderBy: { position: "asc" } }, memberships: { include: { user: true } } },
    });
    io.to(`srv:${serverId}`).emit("server:updated");
    res.json(serializeServer(updated!));
  });

  app.post("/api/servers/:serverId/channels", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.serverId;
    const serverId = typeof raw === "string" ? raw : raw?.[0];
    if (!serverId) {
      res.status(400).json({ error: "bad server" });
      return;
    }
    const { name, kind } = req.body ?? {};
    const label = typeof name === "string" ? name.trim().slice(0, 80) : "";
    if (!label) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const chKind = kind === "voice" ? "voice" : "text";
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: { channels: true, memberships: true },
    });
    if (!server) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (!canManageChannels(req.user!.id, server)) {
      res.status(403).json({ error: "need manage channels permission" });
      return;
    }
    const maxPos = server.channels.reduce((m, c) => Math.max(m, c.position), -1);
    await prisma.channel.create({
      data: {
        serverId,
        name: label,
        kind: chKind,
        position: maxPos + 1,
      },
    });
    const updated = await prisma.server.findUnique({
      where: { id: serverId },
      include: { channels: { orderBy: { position: "asc" } }, memberships: { include: { user: true } } },
    });
    io.to(`srv:${serverId}`).emit("server:updated");
    res.json(serializeServer(updated!));
  });

  app.delete("/api/channels/:channelId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.channelId;
    const channelId = typeof raw === "string" ? raw : raw?.[0];
    if (!channelId) {
      res.status(400).json({ error: "bad channel" });
      return;
    }
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { server: { include: { memberships: true, channels: true } } },
    });
    if (!channel) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (!canManageChannels(req.user!.id, channel.server)) {
      res.status(403).json({ error: "need manage channels permission" });
      return;
    }
    if (channel.server.channels.length <= 1) {
      res.status(400).json({ error: "cannot delete the last channel" });
      return;
    }
    const serverId = channel.serverId;
    await prisma.channel.delete({ where: { id: channelId } });
    const updated = await prisma.server.findUnique({
      where: { id: serverId },
      include: { channels: { orderBy: { position: "asc" } }, memberships: { include: { user: true } } },
    });
    io.to(`srv:${serverId}`).emit("server:updated");
    res.json(serializeServer(updated!));
  });

  app.patch("/api/channels/:channelId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.channelId;
    const channelId = typeof raw === "string" ? raw : raw?.[0];
    const { name } = req.body ?? {};
    const label = typeof name === "string" ? name.trim().slice(0, 80) : "";
    if (!channelId || !label) {
      res.status(400).json({ error: "name required" });
      return;
    }
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { server: { include: { memberships: true } } },
    });
    if (!channel) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (!canManageChannels(req.user!.id, channel.server)) {
      res.status(403).json({ error: "need manage channels permission" });
      return;
    }
    await prisma.channel.update({ where: { id: channelId }, data: { name: label } });
    const updated = await prisma.server.findUnique({
      where: { id: channel.serverId },
      include: { channels: { orderBy: { position: "asc" } }, memberships: { include: { user: true } } },
    });
    io.to(`srv:${channel.serverId}`).emit("server:updated");
    res.json(serializeServer(updated!));
  });

  app.post(
    "/api/servers/:serverId/icon",
    authMiddleware,
    uploadImage.single("image"),
    async (req: AuthedRequest, res) => {
      const raw = req.params.serverId;
      const serverId = typeof raw === "string" ? raw : raw?.[0];
      if (!serverId || !req.file?.buffer?.length) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const srv = await prisma.server.findUnique({
        where: { id: serverId },
        include: { memberships: true },
      });
      if (!srv) {
        res.status(404).json({ error: "not found" });
        return;
      }
      if (srv.ownerId !== req.user!.id) {
        res.status(403).json({ error: "owner only" });
        return;
      }
      const member = srv.memberships.some((m) => m.userId === req.user!.id);
      if (!member) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const mime = req.file.mimetype || "image/png";
      const ext = extFromMime(mime);
      await deleteServerIconVariants(serverId);
      await writeMedia(mediaKey.serverIcon(serverId, ext), req.file.buffer, mime);
      const updated = await prisma.server.update({
        where: { id: serverId },
        data: { iconMime: mime },
        include: { channels: { orderBy: { position: "asc" } }, memberships: { include: { user: true } } },
      });
      res.json(serializeServer(updated));
    },
  );

  app.get("/api/servers/:serverId/icon", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.serverId;
    const serverId = typeof raw === "string" ? raw : raw?.[0];
    if (!serverId) {
      res.status(400).end();
      return;
    }
    const srv = await prisma.server.findUnique({
      where: { id: serverId },
      include: { memberships: true },
    });
    if (!srv?.iconMime) {
      res.status(404).end();
      return;
    }
    const ok = srv.memberships.some((m) => m.userId === req.user!.id);
    if (!ok) {
      res.status(403).end();
      return;
    }
    const ext = extFromMime(srv.iconMime);
    const buf = await readMedia(mediaKey.serverIcon(serverId, ext));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", srv.iconMime);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buf);
  });

  app.get("/api/channels/:channelId/messages", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.channelId;
    const channelId = typeof raw === "string" ? raw : raw?.[0];
    if (!channelId) {
      res.status(400).json({ error: "bad channel" });
      return;
    }
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { server: { include: { memberships: true } } },
    });
    if (!channel) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    const member = channel.server.memberships.some((m) => m.userId === req.user!.id);
    if (!member) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!isTextChannel(channel)) {
      res.json([]);
      return;
    }
    const messages = await prisma.message.findMany({
      where: { channelId },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { author: true, reactions: true },
    });
    res.json(messages.map((m) => serializeChannelMessage(m)));
  });

  app.post("/api/channels/:channelId/messages", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.channelId;
    const channelId = typeof raw === "string" ? raw : raw?.[0];
    if (!channelId) {
      res.status(400).json({ error: "bad channel" });
      return;
    }
    const { content } = req.body ?? {};
    if (!content || !String(content).trim()) {
      res.status(400).json({ error: "content required" });
      return;
    }
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { server: { include: { memberships: { include: { user: true } } } } },
    });
    if (!channel) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    const member = channel.server.memberships.some((m) => m.userId === req.user!.id);
    if (!member) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (!isTextChannel(channel)) {
      res.status(400).json({ error: "voice channel — use live connect, not text uploads" });
      return;
    }
    const members = channel.server.memberships.map((m) => ({ userId: m.userId, username: m.user.username }));
    const mentionIds = serializeMentionIds(resolveChannelMentions(String(content), members, req.user!.id));
    const msg = await prisma.message.create({
      data: {
        channelId,
        authorId: req.user!.id,
        content: String(content).slice(0, 4000),
        mentionIds,
      },
      include: { author: true, reactions: true },
    });
    const out = serializeChannelMessage(msg);
    io.to(`ch:${channelId}`).emit("message:new", out);
    notifyChannelMessage(io, {
      memberUserIds: channel.server.memberships.map((m) => m.userId),
      authorId: req.user!.id,
      serverId: channel.serverId,
      channelId,
    });
    res.json(out);
  });

  app.post(
    "/api/channels/:channelId/messages/voice",
    authMiddleware,
    upload.single("audio"),
    async (req: AuthedRequest, res) => {
      const raw = req.params.channelId;
      const channelId = typeof raw === "string" ? raw : raw?.[0];
      if (!channelId || !req.file?.buffer?.length) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: { server: { include: { memberships: { include: { user: true } } } } },
      });
      if (!channel) {
        res.status(404).json({ error: "channel not found" });
        return;
      }
      const member = channel.server.memberships.some((m) => m.userId === req.user!.id);
      if (!member) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      if (!isTextChannel(channel)) {
        res.status(400).json({ error: "voice channel — no message attachments" });
        return;
      }
      const mime = req.file.mimetype || "audio/webm";
      const caption = typeof req.body?.caption === "string" ? String(req.body.caption).slice(0, 4000) : "";
      const text = caption.trim() || "🎤 voice message";
      const members = channel.server.memberships.map((m) => ({ userId: m.userId, username: m.user.username }));
      const mentionIds = serializeMentionIds(resolveChannelMentions(text, members, req.user!.id));
      const msg = await prisma.message.create({
        data: {
          channelId,
          authorId: req.user!.id,
          content: text,
          hasVoice: true,
          voiceMime: mime,
          mentionIds,
        },
        include: { author: true, reactions: true },
      });
      await writeMedia(mediaKey.channelVoice(msg.id), req.file.buffer, mime);
      const out = serializeChannelMessage(msg);
      io.to(`ch:${channelId}`).emit("message:new", out);
      notifyChannelMessage(io, {
        memberUserIds: channel.server.memberships.map((m) => m.userId),
        authorId: req.user!.id,
        serverId: channel.serverId,
        channelId,
      });
      res.json(out);
    },
  );

  app.post(
    "/api/channels/:channelId/messages/image",
    authMiddleware,
    uploadImage.single("image"),
    async (req: AuthedRequest, res) => {
      const raw = req.params.channelId;
      const channelId = typeof raw === "string" ? raw : raw?.[0];
      if (!channelId || !req.file?.buffer?.length) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: { server: { include: { memberships: { include: { user: true } } } } },
      });
      if (!channel) {
        res.status(404).json({ error: "channel not found" });
        return;
      }
      const member = channel.server.memberships.some((m) => m.userId === req.user!.id);
      if (!member) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      if (!isTextChannel(channel)) {
        res.status(400).json({ error: "voice channel — no message attachments" });
        return;
      }
      const mime = req.file.mimetype || "image/png";
      const caption = typeof req.body?.caption === "string" ? String(req.body.caption).slice(0, 4000) : "";
      const text = caption.trim() || "📷 image";
      const members = channel.server.memberships.map((m) => ({ userId: m.userId, username: m.user.username }));
      const mentionIds = serializeMentionIds(resolveChannelMentions(text, members, req.user!.id));
      const ext = extFromMime(mime);
      const msg = await prisma.message.create({
        data: {
          channelId,
          authorId: req.user!.id,
          content: text,
          hasImage: true,
          imageMime: mime,
          mentionIds,
        },
        include: { author: true, reactions: true },
      });
      await writeMedia(mediaKey.channelImage(msg.id, ext), req.file.buffer, mime);
      const out = serializeChannelMessage(msg);
      io.to(`ch:${channelId}`).emit("message:new", out);
      notifyChannelMessage(io, {
        memberUserIds: channel.server.memberships.map((m) => m.userId),
        authorId: req.user!.id,
        serverId: channel.serverId,
        channelId,
      });
      res.json(out);
    },
  );

  app.post(
    "/api/channels/:channelId/messages/video",
    authMiddleware,
    uploadVideo.single("video"),
    async (req: AuthedRequest, res) => {
      const raw = req.params.channelId;
      const channelId = typeof raw === "string" ? raw : raw?.[0];
      if (!channelId || !req.file?.buffer?.length) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: { server: { include: { memberships: { include: { user: true } } } } },
      });
      if (!channel) {
        res.status(404).json({ error: "channel not found" });
        return;
      }
      const member = channel.server.memberships.some((m) => m.userId === req.user!.id);
      if (!member) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      if (!isTextChannel(channel)) {
        res.status(400).json({ error: "voice channel — no message attachments" });
        return;
      }
      const vf = req.file;
      const mime = canonicalVideoMime(vf);
      const ext = videoStorageExt(vf);
      const caption = typeof req.body?.caption === "string" ? String(req.body.caption).slice(0, 4000) : "";
      const text = caption.trim() || "🎬 video";
      const members = channel.server.memberships.map((m) => ({ userId: m.userId, username: m.user.username }));
      const mentionIds = serializeMentionIds(resolveChannelMentions(text, members, req.user!.id));
      const msg = await prisma.message.create({
        data: {
          channelId,
          authorId: req.user!.id,
          content: text,
          hasVideo: true,
          videoMime: mime,
          mentionIds,
        },
        include: { author: true, reactions: true },
      });
      await writeMedia(mediaKey.channelVideo(msg.id, ext), vf.buffer, mime);
      const out = serializeChannelMessage(msg);
      io.to(`ch:${channelId}`).emit("message:new", out);
      notifyChannelMessage(io, {
        memberUserIds: channel.server.memberships.map((m) => m.userId),
        authorId: req.user!.id,
        serverId: channel.serverId,
        channelId,
      });
      res.json(out);
    },
  );

  app.post(
    "/api/channels/:channelId/messages/audio",
    authMiddleware,
    uploadAudio.single("audio"),
    async (req: AuthedRequest, res) => {
      const raw = req.params.channelId;
      const channelId = typeof raw === "string" ? raw : raw?.[0];
      if (!channelId || !req.file?.buffer?.length) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: { server: { include: { memberships: { include: { user: true } } } } },
      });
      if (!channel) {
        res.status(404).json({ error: "channel not found" });
        return;
      }
      const member = channel.server.memberships.some((m) => m.userId === req.user!.id);
      if (!member) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      if (!isTextChannel(channel)) {
        res.status(400).json({ error: "voice channel — no message attachments" });
        return;
      }
      const af = req.file;
      const mime = canonicalAudioMime(af);
      const ext = audioStorageExt(af);
      const caption = typeof req.body?.caption === "string" ? String(req.body.caption).slice(0, 4000) : "";
      const text = caption.trim() || "🎵 audio";
      const members = channel.server.memberships.map((m) => ({ userId: m.userId, username: m.user.username }));
      const mentionIds = serializeMentionIds(resolveChannelMentions(text, members, req.user!.id));
      const msg = await prisma.message.create({
        data: {
          channelId,
          authorId: req.user!.id,
          content: text,
          hasAudio: true,
          audioMime: mime,
          mentionIds,
        },
        include: { author: true, reactions: true },
      });
      await writeMedia(mediaKey.channelAudio(msg.id, ext), af.buffer, mime);
      const out = serializeChannelMessage(msg);
      io.to(`ch:${channelId}`).emit("message:new", out);
      notifyChannelMessage(io, {
        memberUserIds: channel.server.memberships.map((m) => m.userId),
        authorId: req.user!.id,
        serverId: channel.serverId,
        channelId,
      });
      res.json(out);
    },
  );

  app.post("/api/messages/:messageId/reactions", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    const { emoji } = req.body ?? {};
    if (!messageId || !emoji) {
      res.status(400).json({ error: "emoji required" });
      return;
    }
    const e = String(emoji).slice(0, 8);
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { channel: { include: { server: { include: { memberships: true } } } } },
    });
    if (!msg) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const ok = msg.channel.server.memberships.some((m) => m.userId === req.user!.id);
    if (!ok) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const existing = await prisma.messageReaction.findFirst({
      where: { messageId, userId: req.user!.id, emoji: e },
    });
    if (existing) {
      await prisma.messageReaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.messageReaction.create({
        data: { messageId, userId: req.user!.id, emoji: e },
      });
    }
    const fresh = await prisma.message.findUnique({
      where: { id: messageId },
      include: { author: true, reactions: true },
    });
    const out = serializeChannelMessage(fresh!);
    io.to(`ch:${msg.channelId}`).emit("message:patch", out);
    res.json(out);
  });

  app.patch("/api/messages/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    const { content } = req.body ?? {};
    const text = typeof content === "string" ? String(content).trim().slice(0, 4000) : "";
    if (!messageId || !text) {
      res.status(400).json({ error: "content required" });
      return;
    }
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { channel: { include: { server: { include: { memberships: { include: { user: true } } } } } } },
    });
    if (!msg) {
      res.status(404).json({ error: "not found" });
      return;
    }
    if (!isTextChannel(msg.channel)) {
      res.status(400).json({ error: "voice channel" });
      return;
    }
    const member = msg.channel.server.memberships.some((m) => m.userId === req.user!.id);
    if (!member) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    if (msg.authorId !== req.user!.id) {
      res.status(403).json({ error: "only author can edit" });
      return;
    }
    if (msg.hasVoice || msg.hasImage || msg.hasVideo || msg.hasAudio) {
      res.status(400).json({ error: "cannot edit media messages" });
      return;
    }
    const members = msg.channel.server.memberships.map((m) => ({ userId: m.userId, username: m.user.username }));
    const mentionIds = serializeMentionIds(resolveChannelMentions(text, members, req.user!.id));
    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content: text, mentionIds, editedAt: new Date() },
      include: { author: true, reactions: true },
    });
    const out = serializeChannelMessage(updated);
    io.to(`ch:${msg.channelId}`).emit("message:patch", out);
    res.json(out);
  });

  app.delete("/api/messages/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    if (!messageId) {
      res.status(400).json({ error: "bad message" });
      return;
    }
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { channel: { include: { server: { include: { memberships: true } } } } },
    });
    if (!msg) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const member = msg.channel.server.memberships.some((m) => m.userId === req.user!.id);
    if (!member) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const isAuthor = msg.authorId === req.user!.id;
    const mod = canManageChannels(req.user!.id, msg.channel.server);
    if (!isAuthor && !mod) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const chId = msg.channelId;
    await removeChannelMessageFiles(msg);
    await prisma.message.delete({ where: { id: messageId } });
    io.to(`ch:${chId}`).emit("message:delete", { channelId: chId, messageId });
    res.json({ ok: true });
  });

  app.get("/api/voice/channel/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    if (!messageId) {
      res.status(400).end();
      return;
    }
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { channel: { include: { server: { include: { memberships: true } } } } },
    });
    if (!msg?.hasVoice) {
      res.status(404).end();
      return;
    }
    const ok = msg.channel.server.memberships.some((m) => m.userId === req.user!.id);
    if (!ok) {
      res.status(403).end();
      return;
    }
    const buf = await readMedia(mediaKey.channelVoice(messageId));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", msg.voiceMime || "audio/webm");
    res.send(buf);
  });

  app.get("/api/voice/dm/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    if (!messageId) {
      res.status(400).end();
      return;
    }
    const msg = await prisma.dmMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { participants: true } } },
    });
    if (!msg?.hasVoice) {
      res.status(404).end();
      return;
    }
    const ok = msg.conversation.participants.some((p) => p.userId === req.user!.id);
    if (!ok) {
      res.status(403).end();
      return;
    }
    const buf = await readMedia(mediaKey.dmVoice(messageId));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", msg.voiceMime || "audio/webm");
    res.send(buf);
  });

  app.get("/api/image/channel/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    if (!messageId) {
      res.status(400).end();
      return;
    }
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { channel: { include: { server: { include: { memberships: true } } } } },
    });
    if (!msg?.hasImage) {
      res.status(404).end();
      return;
    }
    const ok = msg.channel.server.memberships.some((m) => m.userId === req.user!.id);
    if (!ok) {
      res.status(403).end();
      return;
    }
    const ext = extFromMime(msg.imageMime || "image/png");
    const buf = await readMedia(mediaKey.channelImage(messageId, ext));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", msg.imageMime || "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buf);
  });

  app.get("/api/image/dm/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    if (!messageId) {
      res.status(400).end();
      return;
    }
    const msg = await prisma.dmMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { participants: true } } },
    });
    if (!msg?.hasImage) {
      res.status(404).end();
      return;
    }
    const ok = msg.conversation.participants.some((p) => p.userId === req.user!.id);
    if (!ok) {
      res.status(403).end();
      return;
    }
    const ext = extFromMime(msg.imageMime || "image/png");
    const buf = await readMedia(mediaKey.dmImage(messageId, ext));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", msg.imageMime || "image/png");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buf);
  });

  app.get("/api/video/channel/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    if (!messageId) {
      res.status(400).end();
      return;
    }
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { channel: { include: { server: { include: { memberships: true } } } } },
    });
    if (!msg?.hasVideo) {
      res.status(404).end();
      return;
    }
    const ok = msg.channel.server.memberships.some((m) => m.userId === req.user!.id);
    if (!ok) {
      res.status(403).end();
      return;
    }
    const ext = extFromMime(msg.videoMime || "video/mp4");
    const buf = await readMedia(mediaKey.channelVideo(messageId, ext));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", msg.videoMime || "video/mp4");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buf);
  });

  app.get("/api/video/dm/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    if (!messageId) {
      res.status(400).end();
      return;
    }
    const msg = await prisma.dmMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { participants: true } } },
    });
    if (!msg?.hasVideo) {
      res.status(404).end();
      return;
    }
    const ok = msg.conversation.participants.some((p) => p.userId === req.user!.id);
    if (!ok) {
      res.status(403).end();
      return;
    }
    const ext = extFromMime(msg.videoMime || "video/mp4");
    const buf = await readMedia(mediaKey.dmVideo(messageId, ext));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", msg.videoMime || "video/mp4");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buf);
  });

  app.get("/api/audio-file/channel/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    if (!messageId) {
      res.status(400).end();
      return;
    }
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      include: { channel: { include: { server: { include: { memberships: true } } } } },
    });
    if (!msg?.hasAudio) {
      res.status(404).end();
      return;
    }
    const ok = msg.channel.server.memberships.some((m) => m.userId === req.user!.id);
    if (!ok) {
      res.status(403).end();
      return;
    }
    const ext = extFromMime(msg.audioMime || "audio/mpeg");
    const buf = await readMedia(mediaKey.channelAudio(messageId, ext));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", msg.audioMime || "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buf);
  });

  app.get("/api/audio-file/dm/:messageId", authMiddleware, async (req: AuthedRequest, res) => {
    const raw = req.params.messageId;
    const messageId = typeof raw === "string" ? raw : raw?.[0];
    if (!messageId) {
      res.status(400).end();
      return;
    }
    const msg = await prisma.dmMessage.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { participants: true } } },
    });
    if (!msg?.hasAudio) {
      res.status(404).end();
      return;
    }
    const ok = msg.conversation.participants.some((p) => p.userId === req.user!.id);
    if (!ok) {
      res.status(403).end();
      return;
    }
    const ext = extFromMime(msg.audioMime || "audio/mpeg");
    const buf = await readMedia(mediaKey.dmAudio(messageId, ext));
    if (!buf?.length) {
      res.status(404).end();
      return;
    }
    res.setHeader("Content-Type", msg.audioMime || "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(buf);
  });

  registerSocialRoutes(app, io);
}
