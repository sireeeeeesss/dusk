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
