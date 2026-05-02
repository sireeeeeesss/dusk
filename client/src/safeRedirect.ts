/** After auth, only jump to invite links or home — blocks open redirects. */
export function safePostAuthRedirect(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s.startsWith("/") || s.startsWith("//")) return "/app";
  const path = s.split("?")[0] ?? "";
  if (path.startsWith("/invite/") && path.length > 8 && path.length < 200) return path;
  return "/app";
}
