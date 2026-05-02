import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "dusk-dev-secret-change-me";

export type JwtPayload = { sub: string; username: string };

export function signToken(userId: string, username: string): string {
  return jwt.sign({ sub: userId, username } satisfies JwtPayload, JWT_SECRET, {
    expiresIn: "14d",
  });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  if (typeof hash !== "string" || hash.length < 10) {
    return false;
  }
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export type AuthedRequest = Request & { user?: { id: string; username: string } };

export function authMiddleware(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "missing token" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload?.sub) {
    res.status(401).json({ error: "invalid token" });
    return;
  }
  req.user = { id: payload.sub, username: payload.username };
  next();
}

export async function getUserFromToken(token: string | undefined) {
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload?.sub) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarHue: user.avatarHue,
    accentHue: user.accentHue,
  };
}
