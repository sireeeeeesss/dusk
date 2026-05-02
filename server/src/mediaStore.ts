import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadRoot = path.resolve(__dirname, "../uploads");

const bucket = (process.env.S3_BUCKET ?? "").trim();
const accessKeyId = (process.env.S3_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? "").trim();
const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "").trim();
const endpoint = (process.env.S3_ENDPOINT ?? "").trim() || undefined;
const rawRegion = (process.env.S3_REGION ?? "").trim();
const region =
  rawRegion ||
  (endpoint?.includes("r2.cloudflarestorage.com") ? "auto" : endpoint ? "us-east-1" : "us-east-1");

let s3Client: S3Client | null = null;

export function useObjectStorage(): boolean {
  return Boolean(bucket && accessKeyId && secretAccessKey);
}

function getS3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: Boolean(endpoint),
    });
  }
  return s3Client;
}

async function streamToBuffer(body: unknown): Promise<Buffer | null> {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "object" && body !== null && Symbol.asyncIterator in body) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
  }
  return null;
}

/** Object keys under the bucket / upload root — same shape as `uploads/<key>` on disk. */
export const mediaKey = {
  channelVoice: (messageId: string) => `voice/ch-${messageId}.webm`,
  dmVoice: (messageId: string) => `voice/dm-${messageId}.webm`,
  channelImage: (messageId: string, ext: string) => `images/ch-${messageId}.${ext}`,
  dmImage: (messageId: string, ext: string) => `images/dm-${messageId}.${ext}`,
  channelVideo: (messageId: string, ext: string) => `videos/ch-${messageId}.${ext}`,
  dmVideo: (messageId: string, ext: string) => `videos/dm-${messageId}.${ext}`,
  channelAudio: (messageId: string, ext: string) => `audio-files/ch-${messageId}.${ext}`,
  dmAudio: (messageId: string, ext: string) => `audio-files/dm-${messageId}.${ext}`,
  userAvatar: (userId: string, ext: string) => `profile/avatar-${userId}.${ext}`,
  userBanner: (userId: string, ext: string) => `profile/banner-${userId}.${ext}`,
  serverIcon: (serverId: string, ext: string) => `server-icons/srv-${serverId}.${ext}`,
};

export async function writeMedia(key: string, body: Buffer, contentType: string): Promise<void> {
  if (useObjectStorage()) {
    await getS3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType || "application/octet-stream",
      }),
    );
    return;
  }
  const full = path.join(uploadRoot, key);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, body);
}

export async function readMedia(key: string): Promise<Buffer | null> {
  if (useObjectStorage()) {
    try {
      const out = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return streamToBuffer(out.Body);
    } catch (e: unknown) {
      const meta =
        e && typeof e === "object" && "$metadata" in e
          ? (e as { $metadata?: { httpStatusCode?: number } }).$metadata
          : undefined;
      if (meta?.httpStatusCode === 404) return null;
      const name = e && typeof e === "object" && "name" in e ? String((e as { name?: string }).name) : "";
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw e;
    }
  }
  const full = path.join(uploadRoot, key);
  try {
    return await fsp.readFile(full);
  } catch {
    return null;
  }
}

export async function deleteMedia(key: string): Promise<void> {
  if (useObjectStorage()) {
    try {
      await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch {
      /* noop */
    }
    return;
  }
  const full = path.join(uploadRoot, key);
  try {
    await fsp.unlink(full);
  } catch {
    /* noop */
  }
}

const imageExts = ["jpg", "png", "gif", "webp", "bin"] as const;

export async function deleteUserAvatarMedia(userId: string): Promise<void> {
  await Promise.all(imageExts.map((ext) => deleteMedia(mediaKey.userAvatar(userId, ext))));
}

export async function deleteUserBannerMedia(userId: string): Promise<void> {
  await Promise.all(imageExts.map((ext) => deleteMedia(mediaKey.userBanner(userId, ext))));
}

export async function deleteServerIconMedia(serverId: string): Promise<void> {
  await Promise.all(imageExts.map((ext) => deleteMedia(mediaKey.serverIcon(serverId, ext))));
}

export function ensureUploadDirs(): void {
  if (useObjectStorage()) return;
  const dirs = ["voice", "images", "videos", "audio-files", "profile", "server-icons"];
  for (const d of dirs) {
    fs.mkdirSync(path.join(uploadRoot, d), { recursive: true });
  }
}
