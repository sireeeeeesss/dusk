export type MediaKind = "image" | "video" | "audio";

/** Route uploads correctly when MIME is empty or lying (common on Windows). */
export function mediaKind(file: File): MediaKind {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("image/")) return "image";
  const n = file.name.toLowerCase();
  if (/\.m4a$/i.test(n)) return "audio";
  if (/\.(mp3|wav|aac|flac|opus|ogg|oga)$/i.test(n)) return "audio";
  if (/\.(mp4|m4v|webm|mov|mkv|avi|mpeg|mpg)$/i.test(n)) return "video";
  return "image";
}

export function mediaKindLabel(k: MediaKind): string {
  if (k === "video") return "video";
  if (k === "audio") return "audio";
  return "image";
}
