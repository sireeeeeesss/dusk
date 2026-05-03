/** Strip bad values so `import("cloudinary")` does not throw on load (SDK validates CLOUDINARY_URL immediately). */
function prepareCloudinaryEnv(): void {
  const u = process.env.CLOUDINARY_URL?.trim();
  if (!u) return;
  if (!u.startsWith("cloudinary://")) {
    console.warn(
      "[dusk] CLOUDINARY_URL must start with cloudinary:// (not https://). Removing invalid value — set a proper URL or use CLOUDINARY_CLOUD_NAME + API_KEY + API_SECRET.",
    );
    delete process.env.CLOUDINARY_URL;
  }
}

async function getCloudinary() {
  prepareCloudinaryEnv();
  const mod = await import("cloudinary");
  const v2 = mod.v2;
  const cn = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const key = process.env.CLOUDINARY_API_KEY?.trim();
  const secret = process.env.CLOUDINARY_API_SECRET?.trim();
  if (cn && key && secret) {
    v2.config({ cloud_name: cn, api_key: key, api_secret: secret, secure: true });
  }
  return v2;
}

/** True only when credentials are usable (avoids treating a bad URL as "on"). */
export function useCloudinaryProfile(): boolean {
  const url = process.env.CLOUDINARY_URL?.trim();
  if (url?.startsWith("cloudinary://")) return true;
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME?.trim() &&
      process.env.CLOUDINARY_API_KEY?.trim() &&
      process.env.CLOUDINARY_API_SECRET?.trim(),
  );
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
  const cloudinary = await getCloudinary();
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
    const cloudinary = await getCloudinary();
    await cloudinary.uploader.destroy(publicId(kind, userId), { invalidate: true });
  } catch {
    /* already gone */
  }
}
