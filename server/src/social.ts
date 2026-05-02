import type { PrismaClient } from "@prisma/client";

/** Canonical friendship pair ordering (string compare on ids). */
export function friendshipPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function areFriends(prisma: PrismaClient, u1: string, u2: string): Promise<boolean> {
  if (u1 === u2) return false;
  const [userAId, userBId] = friendshipPair(u1, u2);
  const row = await prisma.friendship.findUnique({
    where: { userAId_userBId: { userAId, userBId } },
  });
  return !!row;
}

export async function hasAcceptedDmRequest(prisma: PrismaClient, u1: string, u2: string): Promise<boolean> {
  const row = await prisma.dmRequest.findFirst({
    where: {
      status: "accepted",
      OR: [
        { fromUserId: u1, toUserId: u2 },
        { fromUserId: u2, toUserId: u1 },
      ],
    },
  });
  return !!row;
}

export async function canCreateNewDm(prisma: PrismaClient, me: string, other: string): Promise<boolean> {
  if (me === other) return false;
  if (await areFriends(prisma, me, other)) return true;
  if (await hasAcceptedDmRequest(prisma, me, other)) return true;
  return false;
}

export async function friendUserIds(prisma: PrismaClient, userId: string): Promise<string[]> {
  const [asA, asB] = await Promise.all([
    prisma.friendship.findMany({ where: { userAId: userId }, select: { userBId: true } }),
    prisma.friendship.findMany({ where: { userBId: userId }, select: { userAId: true } }),
  ]);
  const ids = new Set<string>();
  for (const r of asA) ids.add(r.userBId);
  for (const r of asB) ids.add(r.userAId);
  return [...ids];
}
