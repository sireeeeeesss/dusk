const APP = process.env.MAIL_APP_NAME ?? "Dusk";
/** Links in emails (verify / open app). Use public web app URL in production. */
const BASE_URL = (process.env.PUBLIC_APP_URL ?? process.env.CLIENT_URL ?? "http://127.0.0.1:5173").replace(
  /\/$/,
  "",
);

const brand = {
  bg: "#0b0914",
  card: "#12101c",
  text: "#e8e4f0",
  muted: "#9b94b0",
  accent: "#e85d4c",
  glow: "#f4a261",
  border: "rgba(255,255,255,0.08)",
};

function layout(inner: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${APP}</title>
</head>
<body style="margin:0;background:${brand.bg};font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${brand.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:${brand.card};border-radius:20px;border:1px solid ${brand.border};overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px 28px;text-align:left;">
              <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${brand.muted};">${APP}</div>
              <div style="margin-top:10px;width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,${brand.accent},${brand.glow});box-shadow:0 12px 40px -12px rgba(232,93,76,0.55);"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px 28px;color:${brand.text};font-size:15px;line-height:1.55;">
              ${inner}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px 28px;font-size:12px;line-height:1.5;color:${brand.muted};">
              If you didn&apos;t request this, ignore this email. Codes expire in 15 minutes.
              <br /><br />
              <a href="${BASE_URL}" style="color:${brand.glow};text-decoration:none;">Open ${APP}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:20px 0;padding:18px 22px;border-radius:14px;background:rgba(255,255,255,0.04);border:1px solid ${brand.border};text-align:center;font-size:32px;letter-spacing:0.35em;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${brand.glow};">${code}</div>`;
}

export function verifyEmailContent(code: string): { subject: string; text: string; html: string } {
  const subject = `${APP} — verify your email`;
  const text = `Your ${APP} verification code is: ${code}\n\nIt expires in 15 minutes.\n\n${BASE_URL}\n`;
  const html = layout(
    `<p style="margin:0 0 8px 0;">Use this code to verify your email and finish signing in:</p>
     ${codeBlock(code)}
     <p style="margin:0;color:${brand.muted};font-size:13px;">Paste it in the app — we’ll keep the lights on.</p>`,
  );
  return { subject, text, html };
}

export function resetPasswordContent(code: string): { subject: string; text: string; html: string } {
  const subject = `${APP} — reset your password`;
  const text = `Your ${APP} password reset code is: ${code}\n\nIt expires in 15 minutes.\nIf you didn’t ask for this, ignore this message.\n\n${BASE_URL}\n`;
  const html = layout(
    `<p style="margin:0 0 8px 0;">Someone (hopefully you) asked to reset your password. Use this code:</p>
     ${codeBlock(code)}
     <p style="margin:0;color:${brand.muted};font-size:13px;">If this wasn’t you, your account is still safe — just delete the email and touch grass.</p>`,
  );
  return { subject, text, html };
}
