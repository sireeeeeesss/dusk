import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.user.count();
  if (count > 0) {
    console.log("db already seeded, skipping");
    return;
  }
  const hash = await bcrypt.hash("demo1234", 10);
  const alice = await prisma.user.create({
    data: {
      email: "alice@dusk.local",
      username: "alice",
      passwordHash: hash,
      displayName: "Alice",
      avatarHue: 12,
      emailVerified: true,
    },
  });
  const bob = await prisma.user.create({
    data: {
      email: "bob@dusk.local",
      username: "bob",
      passwordHash: hash,
      displayName: "Bob",
      avatarHue: 280,
      emailVerified: true,
    },
  });
  const server = await prisma.server.create({
    data: {
      name: "Dusk HQ",
      inviteCode: "DUSK01",
      ownerId: alice.id,
      memberships: {
        create: [
          { userId: alice.id, role: "owner" },
          { userId: bob.id, role: "member" },
        ],
      },
      channels: {
        create: [
          { name: "general", position: 0, kind: "text" },
          { name: "build-in-public", position: 1, kind: "text" },
          { name: "voice lounge", position: 2, kind: "voice" },
        ],
      },
    },
    include: { channels: true },
  });
  const general = server.channels.find((c) => c.name === "general")!;
  await prisma.message.createMany({
    data: [
      {
        channelId: general.id,
        authorId: alice.id,
        content: "welcome to dusk — no blur, no fake glass, just vibes ✌️",
      },
      {
        channelId: general.id,
        authorId: bob.id,
        content: "finally a client that doesn't look like a windshield",
      },
    ],
  });
  const conv = await prisma.conversation.create({
    data: {
      isGroup: false,
      participants: { create: [{ userId: alice.id }, { userId: bob.id }] },
    },
  });
  await prisma.dmMessage.create({
    data: {
      conversationId: conv.id,
      authorId: bob.id,
      content: "psst. this is a dm. scandalous.",
    },
  });
  console.log("seeded demo users alice/bob password demo1234, invite DUSK01 + sample dm");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
