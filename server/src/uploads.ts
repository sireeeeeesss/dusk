import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deleteServerIconMedia, deleteUserAvatarMedia, deleteUserBannerMedia } from "./mediaStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const voiceDir = path.resolve(__dirname, "../uploads/voice");
export const imageDir = path.resolve(__dirname, "../uploads/images");
export const videoDir = path.resolve(__dirname, "../uploads/videos");
export const audioDir = path.resolve(__dirname, "../uploads/audio-files");
export const profileDir = path.resolve(__dirname, "../uploads/profile");
export const serverIconDir = path.resolve(__dirname, "../uploads/server-icons");

export function ensureVoiceDir(): void {
  fs.mkdirSync(voiceDir, { recursive: true });
}

export function ensureImageDir(): void {
  fs.mkdirSync(imageDir, { recursive: true });
}

export function ensureVideoDir(): void {
  fs.mkdirSync(videoDir, { recursive: true });
}

export function ensureAudioDir(): void {
  fs.mkdirSync(audioDir, { recursive: true });
}

export function ensureProfileDir(): void {
  fs.mkdirSync(profileDir, { recursive: true });
}

export function ensureServerIconDir(): void {
  fs.mkdirSync(serverIconDir, { recursive: true });
}

export function extFromMime(mime: string): string {
  const m = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/gif") return "gif";
  if (m === "image/webp") return "webp";
  if (m === "video/mp4") return "mp4";
  if (m === "video/webm") return "webm";
  if (m === "video/quicktime") return "mov";
  if (m === "video/x-matroska") return "mkv";
  if (m === "video/x-msvideo") return "avi";
  if (m === "video/mpeg") return "mpeg";
  if (m === "video/ogg" || m === "video/ogv") return "ogv";
  if (m.startsWith("video/")) return "bin";
  if (m === "audio/mpeg" || m === "audio/mp3") return "mp3";
  if (m === "audio/wav" || m === "audio/wave" || m === "audio/x-wav") return "wav";
  if (m === "audio/mp4" || m === "audio/x-m4a") return "m4a";
  if (m === "audio/aac") return "aac";
  if (m === "audio/flac") return "flac";
  if (m === "audio/opus") return "opus";
  if (m === "audio/ogg") return "ogg";
  if (m === "audio/webm") return "webm";
  if (m.startsWith("audio/")) return "bin";
  return "bin";
}

/** Extension on disk; works when browser sends empty type or octet-stream. */
export function videoStorageExt(file: { mimetype: string; originalname: string }): string {
  const name = (file.originalname || "").toLowerCase();
  if (name.endsWith(".m4v") || name.endsWith(".mp4")) return "mp4";
  if (name.endsWith(".webm")) return "webm";
  if (name.endsWith(".mov")) return "mov";
  if (name.endsWith(".mkv")) return "mkv";
  if (name.endsWith(".avi")) return "avi";
  if (name.endsWith(".ogv")) return "ogv";
  if (name.endsWith(".mpeg") || name.endsWith(".mpg")) return "mpeg";
  const m = (file.mimetype || "").toLowerCase().split(";")[0]?.trim() ?? "";
  return extFromMime(m);
}

/** MIME we persist + send to clients (helps <video> decode). */
export function canonicalVideoMime(file: { mimetype: string; originalname: string }): string {
  const raw = (file.mimetype || "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (raw.startsWith("video/") && raw !== "video/octet-stream") return raw;
  const name = (file.originalname || "").toLowerCase();
  if (name.endsWith(".webm")) return "video/webm";
  if (name.endsWith(".mov")) return "video/quicktime";
  if (name.endsWith(".mp4") || name.endsWith(".m4v")) return "video/mp4";
  if (name.endsWith(".mkv")) return "video/x-matroska";
  if (name.endsWith(".avi")) return "video/x-msvideo";
  if (name.endsWith(".ogv")) return "video/ogg";
  if (name.endsWith(".mpeg") || name.endsWith(".mpg")) return "video/mpeg";
  return raw.startsWith("video/") ? raw : "video/mp4";
}

export function audioStorageExt(file: { mimetype: string; originalname: string }): string {
  const name = (file.originalname || "").toLowerCase();
  if (name.endsWith(".mp3")) return "mp3";
  if (name.endsWith(".wav")) return "wav";
  if (name.endsWith(".m4a")) return "m4a";
  if (name.endsWith(".aac")) return "aac";
  if (name.endsWith(".flac")) return "flac";
  if (name.endsWith(".ogg") || name.endsWith(".oga")) return "ogg";
  if (name.endsWith(".opus")) return "opus";
  if (name.endsWith(".webm")) return "webm";
  const m = (file.mimetype || "").toLowerCase().split(";")[0]?.trim() ?? "";
  return extFromMime(m);
}

export function canonicalAudioMime(file: { mimetype: string; originalname: string }): string {
  const raw = (file.mimetype || "").toLowerCase().split(";")[0]?.trim() ?? "";
  if (raw.startsWith("audio/") && raw !== "audio/octet-stream") return raw;
  const name = (file.originalname || "").toLowerCase();
  if (name.endsWith(".mp3")) return "audio/mpeg";
  if (name.endsWith(".wav")) return "audio/wav";
  if (name.endsWith(".m4a")) return "audio/mp4";
  if (name.endsWith(".aac")) return "audio/aac";
  if (name.endsWith(".flac")) return "audio/flac";
  if (name.endsWith(".ogg") || name.endsWith(".oga")) return "audio/ogg";
  if (name.endsWith(".opus")) return "audio/opus";
  if (name.endsWith(".webm")) return "audio/webm";
  return raw.startsWith("audio/") ? raw : "audio/mpeg";
}

export function channelVoiceFile(messageId: string): string {
  return path.join(voiceDir, `ch-${messageId}.webm`);
}

export function dmVoiceFile(messageId: string): string {
  return path.join(voiceDir, `dm-${messageId}.webm`);
}

export function channelImageFile(messageId: string, ext: string): string {
  return path.join(imageDir, `ch-${messageId}.${ext}`);
}

export function dmImageFile(messageId: string, ext: string): string {
  return path.join(imageDir, `dm-${messageId}.${ext}`);
}

export function channelVideoFile(messageId: string, ext: string): string {
  return path.join(videoDir, `ch-${messageId}.${ext}`);
}

export function dmVideoFile(messageId: string, ext: string): string {
  return path.join(videoDir, `dm-${messageId}.${ext}`);
}

export function channelAudioFile(messageId: string, ext: string): string {
  return path.join(audioDir, `ch-${messageId}.${ext}`);
}

export function dmAudioFile(messageId: string, ext: string): string {
  return path.join(audioDir, `dm-${messageId}.${ext}`);
}

export function userAvatarFile(userId: string, ext: string): string {
  return path.join(profileDir, `avatar-${userId}.${ext}`);
}

export function userBannerFile(userId: string, ext: string): string {
  return path.join(profileDir, `banner-${userId}.${ext}`);
}

export function serverIconFile(serverId: string, ext: string): string {
  return path.join(serverIconDir, `srv-${serverId}.${ext}`);
}

export async function deleteUserAvatarVariants(userId: string): Promise<void> {
  await deleteUserAvatarMedia(userId);
}

export async function deleteUserBannerVariants(userId: string): Promise<void> {
  await deleteUserBannerMedia(userId);
}

export async function deleteServerIconVariants(serverId: string): Promise<void> {
  await deleteServerIconMedia(serverId);
}
