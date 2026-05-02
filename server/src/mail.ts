import nodemailer from "nodemailer";

const RESEND_API_KEY = (process.env.RESEND_API_KEY ?? "").trim();
const SMTP_HOST = (process.env.SMTP_HOST ?? "").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = (process.env.SMTP_USER ?? "").trim();
const SMTP_PASS = (process.env.SMTP_PASS ?? "").trim();
const SMTP_SECURE = process.env.SMTP_SECURE === "true" || SMTP_PORT === 465;
const APP_NAME = process.env.MAIL_APP_NAME ?? "Dusk";

/** Resend’s shared test inbox — works without a domain; set MAIL_FROM for your own noreply domain. */
const RESEND_DEFAULT_FROM = `${APP_NAME} <onboarding@resend.dev>`;

let transporter: nodemailer.Transporter | null | undefined;

function rawFromEnv(): string {
  return (process.env.MAIL_FROM ?? process.env.RESEND_FROM ?? process.env.SMTP_FROM ?? "").trim();
}

/** `Dusk <noreply@example.com>` or bare `noreply@example.com` → formatted From header. */
export function resolveMailFrom(): string {
  const raw = rawFromEnv();
  if (!raw) {
    if (RESEND_API_KEY) return RESEND_DEFAULT_FROM;
    return `${APP_NAME} <noreply@localhost>`;
  }
  if (raw.includes("<") && raw.includes(">")) return raw;
  if (raw.includes("@")) return `${APP_NAME} <${raw}>`;
  return raw;
}

function getTransporter(): nodemailer.Transporter | null {
  if (transporter !== undefined) return transporter;
  if (!SMTP_HOST) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return transporter;
}

export type SendMailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

async function sendViaResend(input: SendMailInput): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  const from = resolveMailFrom();
  const replyTo = (process.env.MAIL_REPLY_TO ?? "").trim() || undefined;
  const body: Record<string, unknown> = {
    from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  if (replyTo) body.reply_to = replyTo;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`[${APP_NAME} mail] Resend error ${resp.status}: ${errBody}`);
  }
  return true;
}

export async function sendMail(input: SendMailInput): Promise<{ ok: boolean; previewUrl?: string }> {
  if (RESEND_API_KEY) {
    await sendViaResend(input);
    return { ok: true };
  }

  const tx = getTransporter();
  if (!tx) {
    console.info(
      `[${APP_NAME} mail] No Resend or SMTP config — logging email instead of sending.\n` +
        `Set RESEND_API_KEY + MAIL_FROM (or SMTP_*) for production.\n` +
        `To: ${input.to}\nSubject: ${input.subject}\n---\n${input.text}\n---`,
    );
    return { ok: true };
  }
  const from = resolveMailFrom();
  const replyTo = (process.env.MAIL_REPLY_TO ?? "").trim() || undefined;
  const info = await tx.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    ...(replyTo ? { replyTo } : {}),
  });
  const rawPreview = nodemailer.getTestMessageUrl(info);
  const previewUrl = typeof rawPreview === "string" ? rawPreview : undefined;
  if (previewUrl) console.info(`[${APP_NAME} mail] preview: ${previewUrl}`);
  return { ok: true, previewUrl };
}
