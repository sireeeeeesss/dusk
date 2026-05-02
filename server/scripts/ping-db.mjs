import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
try {
  const n = await p.user.count();
  console.log("user count", n);
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await p.$disconnect();
}
