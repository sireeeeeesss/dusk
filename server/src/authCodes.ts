import { randomInt } from "node:crypto";
import { comparePassword, hashPassword } from "./auth.js";

export const OTP_EXPIRY_MS = 15 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

export function generateOtp6(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function hashOtp(code: string): Promise<string> {
  return hashPassword(code);
}

export async function verifyOtp(code: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  return comparePassword(code, hash);
}
