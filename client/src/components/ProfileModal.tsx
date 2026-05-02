import { useEffect, useState } from "react";
import { api } from "../api";
import type { User } from "../types";
import { Avatar } from "./Avatar";
import { ProfileBanner } from "./ProfileBanner";

const PRESETS = ["🫩", "✨", "⌨️", "🎧", "☕", "🌙", "🔥", "💀"];

export function ProfileModal({
  user,
  open,
  onClose,
  onSaved,
}: {
  user: User;
  open: boolean;
  onClose: () => void;
  onSaved: (u: User, token: string) => void;
}): React.ReactElement | null {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.bio ?? "");
  const [customStatus, setCustomStatus] = useState(user.customStatus ?? "");
  const [avatarHue, setAvatarHue] = useState(user.avatarHue);
  const [accentHue, setAccentHue] = useState(user.accentHue ?? 32);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"profile" | "security">("profile");

  useEffect(() => {
    if (!open) return;
    setDisplayName(user.displayName);
    setUsername(user.username);
    setBio(user.bio ?? "");
    setCustomStatus(user.customStatus ?? "");
    setAvatarHue(user.avatarHue);
    setAccentHue(user.accentHue ?? 32);
    setErr(null);
    setTab("profile");
  }, [open, user]);

  if (!open) return null;

  async function saveProfile(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api.patchMe({ displayName, username, bio, customStatus, avatarHue, accentHue });
      onSaved(r.user, r.token);
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "nope");
    }
  }

  async function savePassword(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      await api.changePassword(curPw, newPw);
      setCurPw("");
      setNewPw("");
      setTab("profile");
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "nope");
    }
  }

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    try {
      const r = await api.uploadAvatar(f);
      onSaved(r.user, r.token);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "upload died");
    }
  }

  async function onBannerPick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    try {
      const r = await api.uploadBanner(f);
      onSaved(r.user, r.token);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "upload died");
    }
  }

  async function clearAvatar(): Promise<void> {
    setErr(null);
    try {
      const r = await api.removeAvatar();
      onSaved(r.user, r.token);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "nope");
    }
  }

  async function clearBanner(): Promise<void> {
    setErr(null);
    try {
      const r = await api.removeBanner();
      onSaved(r.user, r.token);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "nope");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(3,2,8,0.72)] p-4 backdrop-blur-md">
      <div className="dusk-glass-modal max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <ProfileBanner user={user} />
        <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] px-5 pb-4 pt-2">
          <div className="flex min-w-0 flex-1 items-end gap-3 -mt-10">
            <Avatar user={user} size={72} className="rounded-xl ring-4 ring-[rgba(16,12,24,0.9)] shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)]" />
            <div className="min-w-0 pb-0.5">
              <h2 className="text-lg font-semibold tracking-tight">edit profile</h2>
              <p className="text-xs text-dusk-muted">look good. smell good. ship the frosted twilight panel we literally did that.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="cursor-pointer rounded-lg border border-white/[0.12] bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-dusk-text backdrop-blur-sm transition hover:border-dusk-glow/50">
                  new pfp
                  <input type="file" accept="image/*" className="hidden" onChange={(ev) => void onAvatarPick(ev)} />
                </label>
                {user.avatarUrl ? (
                  <button
                    type="button"
                    onClick={() => void clearAvatar()}
                    className="rounded-lg border border-white/[0.1] px-2 py-1 text-[11px] text-dusk-muted backdrop-blur-sm transition hover:border-dusk-accent/50 hover:text-dusk-accent"
                  >
                    remove pfp
                  </button>
                ) : null}
                <label className="cursor-pointer rounded-lg border border-white/[0.12] bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-dusk-text backdrop-blur-sm transition hover:border-dusk-glow/50">
                  banner
                  <input type="file" accept="image/*" className="hidden" onChange={(ev) => void onBannerPick(ev)} />
                </label>
                {user.bannerUrl ? (
                  <button
                    type="button"
                    onClick={() => void clearBanner()}
                    className="rounded-lg border border-white/[0.1] px-2 py-1 text-[11px] text-dusk-muted backdrop-blur-sm transition hover:border-dusk-accent/50 hover:text-dusk-accent"
                  >
                    strip banner
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-dusk-muted transition hover:bg-white/[0.08] hover:text-dusk-text"
          >
            ✕
          </button>
        </div>
        <div className="flex gap-1 border-b border-white/[0.08] px-3 pt-2">
          {(["profile", "security"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setErr(null);
              }}
              className={`rounded-t-lg px-3 py-2 text-sm capitalize transition ${
                tab === t
                  ? "border border-b-0 border-white/[0.1] bg-white/[0.08] text-dusk-text backdrop-blur-md"
                  : "text-dusk-muted hover:bg-white/[0.04] hover:text-dusk-text"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="p-5">
          {tab === "profile" ? (
            <form onSubmit={saveProfile} className="space-y-4">
              <label className="block text-xs font-medium uppercase tracking-wide text-dusk-muted">
                display name
                <input
                  className="dusk-input mt-1 w-full text-sm"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={64}
                />
              </label>
              <label className="block text-xs font-medium uppercase tracking-wide text-dusk-muted">
                username
                <input
                  className="dusk-input mt-1 w-full font-mono text-sm"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={32}
                />
              </label>
              <label className="block text-xs font-medium uppercase tracking-wide text-dusk-muted">
                bio
                <textarea
                  className="dusk-input mt-1 min-h-[72px] w-full resize-y text-sm"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={190}
                />
              </label>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-dusk-muted">custom status</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCustomStatus((s) => (s.includes(p) ? s : `${p} ${s}`.trim()))}
                      className="rounded-lg border border-white/[0.1] bg-white/[0.05] px-2 py-1 text-xs backdrop-blur-sm transition hover:border-dusk-glow/45"
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <input
                  className="dusk-input mt-2 w-full text-sm"
                  value={customStatus}
                  onChange={(e) => setCustomStatus(e.target.value)}
                  maxLength={100}
                  placeholder="vibing / coding / touching grass"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="text-xs font-medium uppercase tracking-wide text-dusk-muted">
                  avatar hue
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={avatarHue}
                    onChange={(e) => setAvatarHue(Number(e.target.value))}
                    className="mt-2 w-full accent-dusk-accent"
                  />
                </label>
                <label className="text-xs font-medium uppercase tracking-wide text-dusk-muted">
                  accent hue
                  <input
                    type="range"
                    min={0}
                    max={359}
                    value={accentHue}
                    onChange={(e) => setAccentHue(Number(e.target.value))}
                    className="mt-2 w-full accent-dusk-glow"
                  />
                </label>
              </div>
              {err && <p className="text-sm text-dusk-accent">{err}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-xl px-3 py-2 text-sm text-dusk-muted transition hover:bg-white/[0.06] hover:text-dusk-text"
                  onClick={onClose}
                >
                  cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-gradient-to-r from-dusk-accent to-dusk-horizon px-4 py-2 text-sm font-medium text-white shadow-[0_8px_24px_-8px_rgba(232,93,76,0.45)] transition hover:brightness-110"
                >
                  save glow-up
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={savePassword} className="space-y-4">
              <label className="block text-xs font-medium uppercase tracking-wide text-dusk-muted">
                current password
                <input
                  type="password"
                  className="dusk-input mt-1 w-full text-sm"
                  value={curPw}
                  onChange={(e) => setCurPw(e.target.value)}
                />
              </label>
              <label className="block text-xs font-medium uppercase tracking-wide text-dusk-muted">
                new password
                <input
                  type="password"
                  className="dusk-input mt-1 w-full text-sm"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
              </label>
              {err && <p className="text-sm text-dusk-accent">{err}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="submit"
                  className="rounded-xl bg-gradient-to-r from-dusk-glow to-amber-200 px-4 py-2 text-sm font-semibold text-dusk-void shadow-[0_8px_24px_-8px_rgba(244,162,97,0.4)] transition hover:brightness-110"
                >
                  update password
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
