import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { AuthShell } from "../components/AuthShell";
import { ServerIcon } from "../components/ServerIcon";
import type { Channel, Server } from "../types";

export type InvitePreview = {
  name: string;
  memberCount: number;
  channelCount: number;
  iconUrl: string | null;
};

function firstTextChannelId(channels: Channel[]): string | undefined {
  return channels.find((c) => c.kind !== "voice")?.id ?? channels[0]?.id;
}

function InviteSkeleton(): React.ReactElement {
  return (
    <div className="animate-pulse space-y-5">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 shrink-0 rounded-2xl bg-white/[0.08]" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-6 w-3/4 max-w-[14rem] rounded-lg bg-white/[0.08]" />
          <div className="h-3 w-24 rounded bg-white/[0.06]" />
        </div>
      </div>
      <div className="flex gap-2">
        <div className="h-8 flex-1 rounded-full bg-white/[0.06]" />
        <div className="h-8 flex-1 rounded-full bg-white/[0.06]" />
      </div>
      <div className="h-11 w-full rounded-xl bg-white/[0.07]" />
    </div>
  );
}

export function InvitePage(): React.ReactElement {
  const { code } = useParams();
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const normalized = (code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  const load = useCallback(async () => {
    if (!normalized) {
      setLoadErr("missing invite code");
      return;
    }
    setLoadErr(null);
    try {
      const p = await api.invitePreview(normalized);
      setPreview(p);
    } catch (e) {
      setPreview(null);
      setLoadErr(e instanceof Error ? e.message : "invite not found");
    }
  }, [normalized]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!preview) return;
    const prevTitle = document.title;
    document.title = `Join ${preview.name} · Dusk`;
    return () => {
      document.title = prevTitle;
    };
  }, [preview]);

  const invitePath = normalized ? `/invite/${normalized}` : "/invite";
  const loginHref = `/login?redirect=${encodeURIComponent(invitePath)}`;
  const registerHref = `/register?redirect=${encodeURIComponent(invitePath)}`;

  async function join(): Promise<void> {
    if (!user?.emailVerified || !normalized) return;
    setJoinErr(null);
    setJoining(true);
    try {
      const srv: Server = await api.joinServer(normalized);
      const ch = firstTextChannelId(srv.channels) ?? srv.channels[0]?.id;
      if (ch) nav(`/app/${srv.id}/${ch}`);
      else nav("/app");
    } catch (e) {
      setJoinErr(e instanceof Error ? e.message : "join failed");
    } finally {
      setJoining(false);
    }
  }

  const shellTitle = preview ? `You're invited` : "Server invite";
  const shellSubtitle = preview
    ? `${preview.name} · ${preview.memberCount} member${preview.memberCount === 1 ? "" : "s"} · ${preview.channelCount} channel${preview.channelCount === 1 ? "" : "s"}`
    : "pulling up the invite…";

  return (
    <AuthShell title={shellTitle} subtitle={shellSubtitle}>
      {authLoading ? (
        <p className="text-sm text-dusk-muted">syncing your session…</p>
      ) : loadErr ? (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-dusk-accent/30 bg-dusk-accent/10 text-2xl">
            ✕
          </div>
          <p className="text-sm text-dusk-accent">{loadErr}</p>
          <Link to="/app" className="inline-block text-sm font-medium text-dusk-glow underline decoration-dusk-glow/40 underline-offset-4">
            back to dusk
          </Link>
        </div>
      ) : preview ? (
        <div className="space-y-6">
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.1] bg-gradient-to-br from-white/[0.09] via-white/[0.03] to-dusk-twilight/[0.08] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_20px_50px_-28px_rgba(155,127,214,0.35)]">
            <div className="pointer-events-none absolute -right-8 -top-10 h-36 w-36 rounded-full bg-dusk-glow/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-12 -left-6 h-32 w-32 rounded-full bg-dusk-accent/10 blur-3xl" />
            <div className="relative flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
              <div className="shrink-0 rounded-2xl border border-white/[0.12] bg-dusk-void/40 p-1 shadow-inner">
                <ServerIcon serverId={`invite-${normalized}`} name={preview.name} iconUrl={preview.iconUrl} size={80} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-dusk-muted">dusk server</p>
                <h3 className="mt-1 truncate text-xl font-semibold tracking-tight text-dusk-text sm:text-2xl">{preview.name}</h3>
                <p className="mt-1 font-mono text-[11px] text-dusk-muted">invite · {normalized}</p>
              </div>
            </div>
            <div className="relative mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
              <span className="rounded-full border border-white/[0.08] bg-dusk-void/30 px-3 py-1 text-[11px] font-medium text-dusk-text/90 backdrop-blur-sm">
                {preview.memberCount} member{preview.memberCount === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-white/[0.08] bg-dusk-void/30 px-3 py-1 text-[11px] font-medium text-dusk-text/90 backdrop-blur-sm">
                {preview.channelCount} channel{preview.channelCount === 1 ? "" : "s"}
              </span>
              <span className="rounded-full border border-dusk-glow/25 bg-dusk-glow/10 px-3 py-1 text-[11px] font-semibold text-dusk-glow backdrop-blur-sm">
                live chat + voice
              </span>
            </div>
          </div>

          {user && user.emailVerified ? (
            <div className="space-y-3">
              {joinErr ? <p className="text-center text-sm text-dusk-accent">{joinErr}</p> : null}
              <button
                type="button"
                disabled={joining}
                onClick={() => void join()}
                className="w-full rounded-xl bg-gradient-to-r from-dusk-accent via-dusk-horizon to-dusk-glow py-3 text-[15px] font-semibold text-white shadow-[0_14px_44px_-14px_rgba(232,93,76,0.55)] transition hover:brightness-110 disabled:opacity-50"
              >
                {joining ? "joining…" : "accept invite & open server"}
              </button>
              <Link to="/app" className="block text-center text-xs text-dusk-muted transition hover:text-dusk-text">
                maybe later — take me home
              </Link>
            </div>
          ) : user && !user.emailVerified ? (
            <div className="space-y-3 rounded-xl border border-dusk-twilight/25 bg-dusk-twilight/[0.06] p-4 text-center text-sm text-dusk-muted">
              <p>verify your email first, then this same link still works. we&apos;re patient like that.</p>
              <Link
                to={`/verify-email?email=${encodeURIComponent(user.email ?? "")}&redirect=${encodeURIComponent(invitePath)}`}
                className="inline-block font-semibold text-dusk-glow underline decoration-dusk-glow/40 underline-offset-4"
              >
                go verify →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-center text-sm text-dusk-muted">pick your fighter: existing account or fresh blood.</p>
              <Link
                to={loginHref}
                className="block w-full rounded-xl bg-gradient-to-r from-dusk-accent via-dusk-horizon to-dusk-glow py-3 text-center text-[15px] font-semibold text-white shadow-[0_14px_44px_-14px_rgba(232,93,76,0.55)] transition hover:brightness-110"
              >
                log in & join
              </Link>
              <Link
                to={registerHref}
                className="block w-full rounded-xl border border-white/[0.12] bg-white/[0.05] py-3 text-center text-sm font-semibold text-dusk-text backdrop-blur-sm transition hover:border-dusk-glow/45 hover:bg-white/[0.08]"
              >
                create account
              </Link>
            </div>
          )}
        </div>
      ) : (
        <InviteSkeleton />
      )}
    </AuthShell>
  );
}
