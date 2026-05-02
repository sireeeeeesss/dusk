/**
 * Must be imported before any other local module that reads process.env at load time.
 * (ESM evaluates static imports before the entry module body, so dotenv in index.ts was too late for mail.ts.)
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const onReplit = Boolean(process.env.REPL_ID ?? process.env.REPLIT_DEPLOYMENT);
const dbUrl = (process.env.DATABASE_URL ?? "").trim();
if (onReplit && dbUrl && /localhost|127\.0\.0\.1/.test(dbUrl)) {
  console.error(
    "[dusk] DATABASE_URL points at localhost — that only works with Docker on your own PC.\n" +
      "On Replit: open your PostgreSQL database → copy the connection string → Secrets → DATABASE_URL.\n" +
      "If you uploaded server/.env from your laptop, delete it here or remove DATABASE_URL from that file so Secrets win.",
  );
  process.exit(1);
}
