import { v2 as cloudinary } from "cloudinary";

export function useCloudinaryProfile(): boolean {
  return Boolean(process.env.CLOUDINARY_URL?.trim());
}

function publicId(kind: "avatar" | "banner", userId: string): string {
  const id = kind === "avatar" ? `avatar_${userId}` : `banner_${userId}`;
  return `dusk/${id}`;
}

export async function uploadProfileImageCloudinary(
  kind: "avatar" | "banner",
  userId: string,
  buffer: Buffer,
  mime: string,
): Promise<string> {
  const dataUri = `data:${mime};base64,${buffer.toString("base64")}`;
  const res = await cloudinary.uploader.upload(dataUri, {
    folder: "dusk",
    public_id: kind === "avatar" ? `avatar_${userId}` : `banner_${userId}`,
    overwrite: true,
    invalidate: true,
    resource_type: "image",
  });
  return String(res.secure_url ?? "");
}

export async function destroyProfileImageCloudinary(kind: "avatar" | "banner", userId: string): Promise<void> {
  if (!useCloudinaryProfile()) return;
  try {
    await cloudinary.uploader.destroy(publicId(kind, userId), { invalidate: true });
  } catch {
    /* already gone */
  }
}
