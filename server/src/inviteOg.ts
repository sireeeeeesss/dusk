import type { Request } from "express";
import { prisma } from "./db.js";
import { normalizeInviteCodeParam } from "./inviteShared.js";

/** Link unfurlers + a few in-app preview tools */
const CRAWLER_UA =
  /facebookexternalhit|Facebot|Twitterbot|Twitter|Slackbot|Slack|Discordbot|Discord|LinkedInBot|Embedly|Quora Link Preview|vkShare|redditbot|Applebot|TelegramBot|WhatsApp|Googlebot|Pinterest|BingPreview|SkypeUriPreview|Outbrain|Iframely|YandexBot|Microsoft Office|Outlook|Teams|Notion|OpenGraph/i;

export function shouldServeInviteOg(req: Request): boolean {
  if (req.query._og === "1") return true;
  const ua = req.get("user-agent") ?? "";
  return CRAWLER_UA.test(ua);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function publicOrigin(req: Request): string {
  const rawProto = (req.get("x-forwarded-proto") ?? req.protocol).split(",")[0]?.trim() || "http";
  const proto = rawProto.replace(/:$/, "");
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "localhost").split(",")[0]?.trim() || "localhost";
  return `${proto}://${host}`;
}

export async function renderInviteOgHtml(req: Request, rawCode: unknown): Promise<string> {
  const code = normalizeInviteCodeParam(rawCode);
  const origin = publicOrigin(req);
  const canonical = code ? `${origin}/invite/${code}` : `${origin}/invite`;
  const defaultIcon = `${origin}/favicon.svg`;

  if (!code) {
    const title = "Dusk — invite";
    const desc = "This invite link looks broken. Open Dusk and ask for a fresh link.";
    return ogDocument({ title, desc, canonical, imageUrl: defaultIcon, bodyTitle: "invite link", bodySub: "missing code" });
  }

  const server = await prisma.server.findUnique({
    where: { inviteCode: code },
    include: { _count: { select: { memberships: true, channels: true } } },
  });

  if (!server) {
    const title = "Dusk — invite expired";
    const desc = "This invite is invalid or the server no longer exists.";
    return ogDocument({ title, desc, canonical, imageUrl: defaultIcon, bodyTitle: "nothing here", bodySub: "stale or fake code 💀" });
  }

  const n = server._count.memberships;
  const ch = server._count.channels;
  const title = `Join ${server.name} on Dusk`;
  const desc = `${n} member${n === 1 ? "" : "s"}, ${ch} channel${ch === 1 ? "" : "s"} · voice + text chat. Open in Dusk.`.slice(0, 300);
  const imageUrl = server.iconMime ? `${origin}/api/invites/${encodeURIComponent(code)}/icon` : defaultIcon;

  return ogDocument({
    title,
    desc,
    canonical,
    imageUrl,
    bodyTitle: server.name,
    bodySub: `${n} member${n === 1 ? "" : "s"} · you're one tap away`,
  });
}

function ogDocument(p: {
  title: string;
  desc: string;
  canonical: string;
  imageUrl: string;
  bodyTitle: string;
  bodySub: string;
}): string {
  const t = esc(p.title);
  const d = esc(p.desc);
  const c = esc(p.canonical);
  const img = esc(p.imageUrl);
  const bt = esc(p.bodyTitle);
  const bs = esc(p.bodySub);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${t}</title>
  <meta name="description" content="${d}" />
  <link rel="canonical" href="${c}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Dusk" />
  <meta property="og:title" content="${t}" />
  <meta property="og:description" content="${d}" />
  <meta property="og:url" content="${c}" />
  <meta property="og:image" content="${img}" />
  <meta property="og:image:alt" content="${t}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${t}" />
  <meta name="twitter:description" content="${d}" />
  <meta name="twitter:image" content="${img}" />
  <meta name="theme-color" content="#0c0a12" />
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:radial-gradient(ellipse 80% 50% at 50% -20%,rgba(155,127,214,.35),transparent),#0c0a12;color:#e8e4f0;}
    .card{max-width:28rem;padding:2rem 2.25rem;border-radius:1.25rem;border:1px solid rgba(255,255,255,.08);background:rgba(16,14,24,.75);backdrop-filter:blur(12px);text-align:center;}
    h1{font-size:1.35rem;font-weight:600;margin:0 0 .5rem;letter-spacing:-.02em;}
    p{margin:0;font-size:.9rem;opacity:.72;line-height:1.45;}
    a{display:inline-block;margin-top:1.35rem;padding:.65rem 1.25rem;border-radius:.75rem;background:linear-gradient(120deg,#e85d4c,#9b7fd6);color:#fff;text-decoration:none;font-weight:600;font-size:.9rem;}
    a:hover{filter:brightness(1.08);}
  </style>
</head>
<body>
  <div class="card">
    <h1>${bt}</h1>
    <p>${bs}</p>
    <a href="${c}">open in dusk</a>
  </div>
</body>
</html>`;
}
