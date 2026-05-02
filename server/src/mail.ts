import nodemailer from "nodemailer";

/** Read at use-time so `.env` / Replit Secrets are visible (not frozen at module load before `loadEnv`). */
function resendApiKey(): string {
  return (process.env.RESEND_API_KEY ?? process.env.RESEND_KEY ?? "").trim();
}

function smtpHost(): string {
  return (process.env.SMTP_HOST ?? "").trim();
}

function smtpPort(): number {
  return Number(process.env.SMTP_PORT) || 587;
}

function smtpUser(): string {
  return (process.env.SMTP_USER ?? "").trim();
}

function smtpPass(): string {
  return (process.env.SMTP_PASS ?? "").trim();
}

function smtpSecure(): boolean {
  return process.env.SMTP_SECURE === "true" || smtpPort() === 465;
}

function appName(): string {
  return process.env.MAIL_APP_NAME ?? "Dusk";
}

/** Resend’s shared test inbox — works without a domain; set MAIL_FROM for your own noreply domain. */
function resendDefaultFrom(): string {
  return `${appName()} <onboarding@resend.dev>`;
}

let transporter: nodemailer.Transporter | null | undefined;

function rawFromEnv(): string {
  return (process.env.MAIL_FROM ?? process.env.RESEND_FROM ?? process.env.SMTP_FROM ?? "").trim();
}

/** `Dusk <noreply@example.com>` or bare `noreply@example.com` → formatted From header. */
export function resolveMailFrom(): string {
  const raw = rawFromEnv();
  if (!raw) {
    if (resendApiKey()) return resendDefaultFrom();
    return `${appName()} <noreply@localhost>`;
  }
  if (raw.includes("<") && raw.includes(">")) return raw;
  if (raw.includes("@")) return `${appName()} <${raw}>`;
  return raw;
}

function getTransporter(): nodemailer.Transporter | null {
  if (transporter !== undefined) return transporter;
  const host = smtpHost();
  if (!host) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port: smtpPort(),
    secure: smtpSecure(),
    auth: smtpUser() ? { user: smtpUser(), pass: smtpPass() } : undefined,
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
  const key = resendApiKey();
  if (!key) return false;
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
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`[${appName()} mail] Resend error ${resp.status}: ${errBody}`);
  }
  return true;
}

export async function sendMail(input: SendMailInput): Promise<{ ok: boolean; previewUrl?: string }> {
  if (resendApiKey()) {
    await sendViaResend(input);
    return { ok: true };
  }

  const tx = getTransporter();
  if (!tx) {
    console.info(
      `[${appName()} mail] No Resend or SMTP config — logging email instead of sending.\n` +
        `Replit: create a Secret named exactly RESEND_API_KEY (or set SMTP_*).\n` +
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
  if (previewUrl) console.info(`[${appName()} mail] preview: ${previewUrl}`);
  return { ok: true, previewUrl };
}
