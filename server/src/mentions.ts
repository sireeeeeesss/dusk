export function serializeMentionIds(ids: string[]): string {
  return JSON.stringify([...new Set(ids)]);
}

export function parseMentionIds(raw: string | null | undefined): string[] {
  try {
    const j = JSON.parse(raw || "[]");
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const HANDLE = /@([a-zA-Z0-9_]{1,32})\b/g;

export function resolveChannelMentions(
  content: string,
  members: { userId: string; username: string }[],
  authorId: string,
): string[] {
  const ids = new Set<string>();
  const map = new Map(members.map((m) => [m.username.toLowerCase(), m.userId]));
  let m: RegExpExecArray | null;
  const text = content;
  HANDLE.lastIndex = 0;
  while ((m = HANDLE.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    if (tag === "everyone" || tag === "here") {
      for (const mem of members) {
        if (mem.userId !== authorId) ids.add(mem.userId);
      }
    } else {
      const id = map.get(tag);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

export function resolveDmMentions(
  content: string,
  participants: { userId: string; username: string }[],
  authorId: string,
): string[] {
  const ids = new Set<string>();
  const map = new Map(participants.map((p) => [p.username.toLowerCase(), p.userId]));
  let m: RegExpExecArray | null;
  HANDLE.lastIndex = 0;
  while ((m = HANDLE.exec(content)) !== null) {
    const tag = m[1].toLowerCase();
    if (tag === "everyone" || tag === "here") {
      for (const p of participants) {
        if (p.userId !== authorId) ids.add(p.userId);
      }
    } else {
      const id = map.get(tag);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
