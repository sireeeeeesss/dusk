/** Normalizes invite codes from URL params (alphanumeric, uppercased). */
export function normalizeInviteCodeParam(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length < 4 || c.length > 32) return null;
  return c;
}
