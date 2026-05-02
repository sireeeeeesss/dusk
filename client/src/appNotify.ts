const FAV_IDLE = "/favicon.svg";
const FAV_UNREAD = "/favicon-unread.svg";

let audioUnlocked = false;

export function unlockAppAudio(): void {
  audioUnlocked = true;
}

export function setUnreadFavicon(unread: boolean): void {
  const href = unread ? FAV_UNREAD : FAV_IDLE;
  let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    document.head.appendChild(link);
  }
  link.type = "image/svg+xml";
  link.href = href;
}

let lastPing = 0;
const PING_GAP_MS = 1100;

export function playMessagePing(): void {
  if (!audioUnlocked) return;
  const now = Date.now();
  if (now - lastPing < PING_GAP_MS) return;
  lastPing = now;
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(740, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.11, ctx.currentTime + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.15);
    o.onended = () => void ctx.close();
  } catch {
    /* autoplay policy / headless */
  }
}
