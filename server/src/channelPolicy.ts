import type { Channel, Membership, Server } from "@prisma/client";

export function canManageChannels(
  userId: string,
  server: { ownerId: string; memberships: { userId: string; role: string }[] },
): boolean {
  if (server.ownerId === userId) return true;
  const m = server.memberships.find((x) => x.userId === userId);
  return m?.role === "owner" || m?.role === "admin";
}

export function isTextChannel(channel: Channel): boolean {
  return (channel.kind ?? "text") === "text";
}
