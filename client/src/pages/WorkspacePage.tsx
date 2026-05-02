import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { playMessagePing, setUnreadFavicon, unlockAppAudio } from "../appNotify";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "../components/Avatar";
import { DuskMark } from "../components/DuskMark";
import { ChannelChat } from "../components/ChannelChat";
import { DmChat, DmSidebar, type DmSidebarExtras } from "../components/DmChat";
import { DmGatePanel } from "../components/DmGatePanel";
import { UserSearchModal } from "../components/UserSearchModal";
import { VoiceChannelPanel } from "../components/VoiceChannelPanel";
import { ProfileModal } from "../components/ProfileModal";
import { ServerIcon } from "../components/ServerIcon";
import { connectSocket, type DuskSocket } from "../socket";
import type {
  Channel,
  ChannelKind,
  DmSummary,
  FriendWithPresence,
  LiteUser,
  Presence,
  Server,
  SocialRequestRow,
  User,
} from "../types";

function isVoiceChannel(c: Pick<Channel, "kind">): boolean {
  return c.kind === "voice";
}

function parseAppPath(pathname: string): { channelId?: string; conversationId?: string } {
  const dm = pathname.match(/^\/app\/dm\/([^/]+)$/);
  if (dm?.[1]) return { conversationId: dm[1] };
  const ch = pathname.match(/^\/app\/([^/]+)\/([^/]+)$/);
  if (ch?.[1] && ch[1] !== "dm" && ch[2]) return { channelId: ch[2] };
  return {};
}

function canManageServerChannels(server: Server, userId: string | undefined): boolean {
  if (!userId) return false;
  if (server.ownerId === userId) return true;
  const m = server.memberships.find((x) => x.user.id === userId);
  return m?.role === "owner" || m?.role === "admin";
}

function defaultOpenChannelId(channels: Channel[]): string | undefined {
  return channels.find((c) => c.kind !== "voice")?.id ?? channels[0]?.id;
}

function toLiteUser(u: User | LiteUser): LiteUser {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarHue: u.avatarHue,
    accentHue: u.accentHue,
    avatarUrl: u.avatarUrl ?? null,
    bannerUrl: u.bannerUrl ?? null,
  };
}

function MembersPanel({
  server,
  members,
  onOpenDm,
  onRefresh,
}: {
  server: Server;
  members: { user: User; role: string }[];
  onOpenDm?: (peer: User) => void;
  onRefresh: () => Promise<void>;
}): React.ReactElement {
  const { user } = useAuth();
  const isOwner = !!(user && server.ownerId === user.id);
  const list = useMemo(() => {
    return [...members].sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
  }, [members]);

  return (
    <aside className="dusk-glass-surface hidden w-56 shrink-0 flex-col border-l border-white/[0.06] lg:flex">
      <div className="flex h-12 items-center border-b border-white/[0.08] px-3 text-xs font-semibold uppercase tracking-wide text-dusk-muted">
        members — {list.length}
      </div>
      <ul className="overflow-y-auto p-2">
        {list.map((m) => (
          <li key={m.user.id} className="group flex flex-wrap items-center gap-2 rounded-xl px-2 py-1.5 transition hover:bg-white/[0.06]">
            <Avatar user={m.user} size={28} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{m.user.displayName}</div>
              <div className="truncate font-mono text-xs text-dusk-muted">@{m.user.username}</div>
            </div>
            {m.role !== "member" && (
              <span className="shrink-0 rounded-lg border border-dusk-glow/25 bg-dusk-glow/10 px-1.5 py-0.5 text-[10px] uppercase text-dusk-glow backdrop-blur-sm">
                {m.role}
              </span>
            )}
            {isOwner && m.user.id !== user?.id && m.user.id !== server.ownerId ? (
              <div className="flex w-full shrink-0 flex-wrap items-center gap-1 pl-9 opacity-0 transition group-hover:opacity-100">
                <select
                  className="dusk-input max-w-[7rem] py-0.5 text-[10px]"
                  value={m.role === "admin" ? "admin" : "member"}
                  title="role"
                  onChange={(e) => {
                    const role = e.target.value === "admin" ? "admin" : "member";
                    void (async () => {
                      try {
                        await api.patchMemberRole(server.id, m.user.id, role);
                        await onRefresh();
                      } catch (err) {
                        console.error(err);
                      }
                    })();
                  }}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
                <button
                  type="button"
                  className="rounded border border-dusk-accent/40 px-1.5 py-0.5 text-[10px] text-dusk-accent hover:bg-dusk-accent/10"
                  onClick={() =>
                    void (async () => {
                      if (!window.confirm(`kick @${m.user.username}?`)) return;
                      try {
                        await api.kickMember(server.id, m.user.id);
                        await onRefresh();
                      } catch (err) {
                        console.error(err);
                      }
                    })()
                  }
                >
                  kick
                </button>
              </div>
            ) : null}
            {onOpenDm && m.user.id !== user?.id && (
              <button
                type="button"
                title="message"
                onClick={() => onOpenDm(m.user)}
                className="shrink-0 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-dusk-muted opacity-0 backdrop-blur-sm transition hover:border-dusk-twilight/40 hover:text-dusk-text group-hover:opacity-100"
              >
                dm
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Desk({
  servers,
  socket,
  onOpenDm,
  refreshServers,
}: {
  servers: Server[];
  socket: DuskSocket | null;
  onOpenDm: (peer: User) => void;
  refreshServers: () => Promise<void>;
}): React.ReactElement {
  const { user } = useAuth();
  const nav = useNavigate();
  const iconFileRef = useRef<HTMLInputElement>(null);
  const { serverId, channelId } = useParams();
  const [addKind, setAddKind] = useState<ChannelKind | null>(null);
  const [newChName, setNewChName] = useState("");
  const [addErr, setAddErr] = useState<string | null>(null);
  const [renameChannelId, setRenameChannelId] = useState<string | null>(null);
  const [renameChInput, setRenameChInput] = useState("");
  const [renameChErr, setRenameChErr] = useState<string | null>(null);
  const [serverRenameOpen, setServerRenameOpen] = useState(false);
  const [serverNameDraft, setServerNameDraft] = useState("");
  const [serverRenameErr, setServerRenameErr] = useState<string | null>(null);

  const server = servers.find((s) => s.id === serverId);
  const textChs = useMemo(
    () => (server ? server.channels.filter((c) => !isVoiceChannel(c)) : []),
    [server],
  );
  const voiceChs = useMemo(
    () => (server ? server.channels.filter((c) => isVoiceChannel(c)) : []),
    [server],
  );
  const channelOk = !!(server && channelId && server.channels.some((c) => c.id === channelId));
  const current = server?.channels.find((c) => c.id === channelId);
  const canManage = useMemo(
    () => (server ? canManageServerChannels(server, user?.id) : false),
    [server, user?.id],
  );

  if (!server || !channelId) {
    return <Navigate to="/app" replace />;
  }
  if (!channelOk) {
    const first = textChs[0]?.id ?? server.channels[0]?.id;
    return first ? <Navigate to={`/app/${server.id}/${first}`} replace /> : <Navigate to="/app" replace />;
  }

  const S = server!;

  async function submitNewChannel(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!addKind || !newChName.trim()) return;
    setAddErr(null);
    try {
      const updated = await api.createChannel(S.id, { name: newChName.trim(), kind: addKind });
      await refreshServers();
      const newest = updated.channels.reduce((a, b) => (b.position > a.position ? b : a));
      nav(`/app/${S.id}/${newest.id}`);
      setAddKind(null);
      setNewChName("");
    } catch (err) {
      setAddErr(err instanceof Error ? err.message : "nope");
    }
  }

  async function removeChannel(id: string): Promise<void> {
    if (!window.confirm("delete this channel? messages in it go poof.")) return;
    try {
      const updated = await api.deleteChannel(id);
      await refreshServers();
      const next = defaultOpenChannelId(updated.channels);
      if (next) nav(`/app/${updated.id}/${next}`);
    } catch (e) {
      console.error(e);
    }
  }

  async function submitRenameChannel(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!renameChannelId || !renameChInput.trim()) return;
    setRenameChErr(null);
    try {
      await api.patchChannel(renameChannelId, renameChInput.trim());
      await refreshServers();
      setRenameChannelId(null);
      setRenameChInput("");
    } catch (err) {
      setRenameChErr(err instanceof Error ? err.message : "nope");
    }
  }

  async function submitRenameServer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!serverNameDraft.trim()) return;
    setServerRenameErr(null);
    try {
      await api.patchServer(S.id, serverNameDraft.trim());
      await refreshServers();
      setServerRenameOpen(false);
    } catch (err) {
      setServerRenameErr(err instanceof Error ? err.message : "nope");
    }
  }

  async function leaveServerAct(): Promise<void> {
    if (!window.confirm("leave this server? you'll need an invite to come back.")) return;
    try {
      await api.leaveServer(S.id);
      await refreshServers();
      nav("/app");
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="dusk-glass-surface flex w-56 shrink-0 flex-col border-r border-white/[0.06]">
        <div className="flex h-12 items-center gap-2 border-b border-white/[0.08] px-2">
          {user && server.ownerId === user.id ? (
            <>
              <input
                ref={iconFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  ev.target.value = "";
                  if (!f) return;
                  void (async () => {
                    try {
                      await api.uploadServerIcon(server.id, f);
                      await refreshServers();
                    } catch (err) {
                      console.error("server icon upload failed", err);
                    }
                  })();
                }}
              />
              <button
                type="button"
                title="server icon (owner)"
                onClick={() => iconFileRef.current?.click()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.12] bg-white/[0.04] text-xs text-dusk-muted backdrop-blur-sm transition hover:border-dusk-glow/50 hover:text-dusk-glow"
              >
                +
              </button>
            </>
          ) : null}
          <span className="min-w-0 flex-1 truncate font-semibold">{server.name}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between px-2 pt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-dusk-muted">text</div>
            {canManage ? (
              <button
                type="button"
                title="new text channel"
                onClick={() => {
                  setAddKind("text");
                  setNewChName("");
                  setAddErr(null);
                }}
                className="rounded-md px-1.5 py-0.5 text-xs text-dusk-muted transition hover:bg-white/[0.08] hover:text-dusk-text"
              >
                +
              </button>
            ) : null}
          </div>
          <ul className="max-h-[40%] shrink-0 overflow-y-auto px-1 pb-1">
            {textChs.map((c) => (
              <li key={c.id} className="group/ch relative">
                <NavLink
                  to={`/app/${server.id}/${c.id}`}
                  className={({ isActive }) =>
                    `mb-0.5 flex items-center rounded-xl px-2 py-1.5 pr-14 text-sm transition ${
                      isActive
                        ? "border border-white/[0.08] bg-white/[0.08] text-dusk-text shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md"
                        : "text-dusk-muted hover:bg-white/[0.05] hover:text-dusk-text"
                    }`
                  }
                >
                  <span className="mr-2 text-dusk-twilight/80">#</span>
                  <span className="min-w-0 truncate">{c.name}</span>
                </NavLink>
                {canManage ? (
                  <>
                    <button
                      type="button"
                      title="rename channel"
                      onClick={() => {
                        setRenameChannelId(c.id);
                        setRenameChInput(c.name);
                        setRenameChErr(null);
                      }}
                      className="absolute right-7 top-1/2 z-10 -translate-y-1/2 rounded px-1 text-[11px] text-dusk-muted opacity-0 transition hover:text-dusk-glow group-hover/ch:opacity-100"
                    >
                      ✎
                    </button>
                    {textChs.length > 1 ? (
                      <button
                        type="button"
                        title="delete channel"
                        onClick={() => void removeChannel(c.id)}
                        className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded px-1 text-[11px] text-dusk-muted opacity-0 transition hover:text-dusk-accent group-hover/ch:opacity-100"
                      >
                        ×
                      </button>
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-white/[0.06] px-2 pt-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-dusk-muted">voice</div>
            {canManage ? (
              <button
                type="button"
                title="new voice channel"
                onClick={() => {
                  setAddKind("voice");
                  setNewChName("");
                  setAddErr(null);
                }}
                className="rounded-md px-1.5 py-0.5 text-xs text-dusk-muted transition hover:bg-white/[0.08] hover:text-dusk-text"
              >
                +
              </button>
            ) : null}
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            {voiceChs.map((c) => (
              <li key={c.id} className="group/ch relative">
                <NavLink
                  to={`/app/${server.id}/${c.id}`}
                  className={({ isActive }) =>
                    `mb-0.5 flex items-center rounded-xl px-2 py-1.5 pr-14 text-sm transition ${
                      isActive
                        ? "border border-dusk-glow/25 bg-dusk-glow/10 text-dusk-text backdrop-blur-md"
                        : "text-dusk-muted hover:bg-white/[0.05] hover:text-dusk-text"
                    }`
                  }
                >
                  <span className="mr-2 shrink-0 text-dusk-glow" aria-hidden>
                    🔊
                  </span>
                  <span className="min-w-0 truncate">{c.name}</span>
                </NavLink>
                {canManage ? (
                  <>
                    <button
                      type="button"
                      title="rename channel"
                      onClick={() => {
                        setRenameChannelId(c.id);
                        setRenameChInput(c.name);
                        setRenameChErr(null);
                      }}
                      className="absolute right-7 top-1/2 z-10 -translate-y-1/2 rounded px-1 text-[11px] text-dusk-muted opacity-0 transition hover:text-dusk-glow group-hover/ch:opacity-100"
                    >
                      ✎
                    </button>
                    {server.channels.length > 1 ? (
                      <button
                        type="button"
                        title="delete channel"
                        onClick={() => void removeChannel(c.id)}
                        className="absolute right-1 top-1/2 z-10 -translate-y-1/2 rounded px-1 text-[11px] text-dusk-muted opacity-0 transition hover:text-dusk-accent group-hover/ch:opacity-100"
                      >
                        ×
                      </button>
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-auto space-y-2 border-t border-white/[0.08] p-2 text-[10px] text-dusk-muted">
          <div className="space-y-1">
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-dusk-muted/90">invite</div>
            <Link
              to={`/invite/${server.inviteCode}`}
              title="open invite page"
              className="block truncate rounded-lg border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 font-mono text-[11px] font-medium text-dusk-glow transition hover:border-dusk-glow/40 hover:bg-dusk-glow/10"
            >
              /invite/{server.inviteCode}
            </Link>
          </div>
          <button
            type="button"
            className="w-full rounded-lg border border-dusk-glow/35 bg-dusk-glow/10 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-dusk-glow backdrop-blur-sm transition hover:border-dusk-glow/60"
            onClick={() =>
              void navigator.clipboard.writeText(
                `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${server.inviteCode}`,
              )
            }
          >
            copy invite link
          </button>
          <button
            type="button"
            className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] py-1.5 text-[10px] font-semibold uppercase tracking-wide text-dusk-text backdrop-blur-sm transition hover:border-dusk-glow/40"
            onClick={() => void navigator.clipboard.writeText(server.inviteCode)}
          >
            copy code only
          </button>
          {server.ownerId === user?.id ? (
            <button
              type="button"
              className="w-full rounded-lg border border-white/[0.1] py-1.5 text-[10px] font-semibold uppercase tracking-wide text-dusk-muted transition hover:bg-white/[0.06] hover:text-dusk-text"
              onClick={() => {
                setServerNameDraft(server.name);
                setServerRenameErr(null);
                setServerRenameOpen(true);
              }}
            >
              rename server
            </button>
          ) : (
            <button
              type="button"
              className="w-full rounded-lg border border-dusk-accent/30 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-dusk-accent transition hover:bg-dusk-accent/10"
              onClick={() => void leaveServerAct()}
            >
              leave server
            </button>
          )}
        </div>
      </aside>
      {current && isVoiceChannel(current) ? (
        <VoiceChannelPanel channel={current} socket={socket} />
      ) : (
        <ChannelChat server={server} channelId={channelId} socket={socket} />
      )}
      <MembersPanel server={server} members={server.memberships} onOpenDm={onOpenDm} onRefresh={refreshServers} />

      {addKind ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,2,10,0.65)] p-4 backdrop-blur-md">
          <div className="dusk-glass-modal w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-dusk-text">
              new {addKind === "voice" ? "voice" : "text"} channel
            </h3>
            <form onSubmit={(e) => void submitNewChannel(e)} className="mt-3 space-y-3">
              <input
                className="dusk-input w-full text-sm"
                placeholder="channel-name"
                value={newChName}
                onChange={(e) => setNewChName(e.target.value)}
                autoFocus
                maxLength={80}
              />
              {addErr ? <p className="text-xs text-dusk-accent">{addErr}</p> : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl px-3 py-1.5 text-xs text-dusk-muted hover:bg-white/[0.06]"
                  onClick={() => setAddKind(null)}
                >
                  cancel
                </button>
                <button type="submit" className="rounded-xl bg-dusk-accent px-3 py-1.5 text-xs font-medium text-white">
                  create
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {renameChannelId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,2,10,0.65)] p-4 backdrop-blur-md">
          <div className="dusk-glass-modal w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-dusk-text">rename channel</h3>
            <form onSubmit={(e) => void submitRenameChannel(e)} className="mt-3 space-y-3">
              <input
                className="dusk-input w-full text-sm"
                value={renameChInput}
                onChange={(e) => setRenameChInput(e.target.value)}
                autoFocus
                maxLength={80}
              />
              {renameChErr ? <p className="text-xs text-dusk-accent">{renameChErr}</p> : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl px-3 py-1.5 text-xs text-dusk-muted hover:bg-white/[0.06]"
                  onClick={() => setRenameChannelId(null)}
                >
                  cancel
                </button>
                <button type="submit" className="rounded-xl bg-dusk-accent px-3 py-1.5 text-xs font-medium text-white">
                  save
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {serverRenameOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,2,10,0.65)] p-4 backdrop-blur-md">
          <div className="dusk-glass-modal w-full max-w-sm p-5">
            <h3 className="text-sm font-semibold text-dusk-text">rename server</h3>
            <form onSubmit={(e) => void submitRenameServer(e)} className="mt-3 space-y-3">
              <input
                className="dusk-input w-full text-sm"
                value={serverNameDraft}
                onChange={(e) => setServerNameDraft(e.target.value)}
                autoFocus
                maxLength={80}
              />
              {serverRenameErr ? <p className="text-xs text-dusk-accent">{serverRenameErr}</p> : null}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded-xl px-3 py-1.5 text-xs text-dusk-muted hover:bg-white/[0.06]"
                  onClick={() => setServerRenameOpen(false)}
                >
                  cancel
                </button>
                <button type="submit" className="rounded-xl bg-dusk-accent px-3 py-1.5 text-xs font-medium text-white">
                  save
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DmEnter({ dms, refreshDms, sidebar }: { dms: DmSummary[]; refreshDms: () => void; sidebar: DmSidebarExtras }): React.ReactElement {
  if (dms[0]) return <Navigate to={`/app/dm/${dms[0].id}`} replace />;
  return (
    <div className="flex min-h-0 flex-1">
      <DmSidebar items={[]} {...sidebar} />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="max-w-md text-sm text-dusk-muted">
          no dms yet. for <span className="font-semibold text-dusk-glow">friend requests</span>, use{" "}
          <span className="font-semibold text-dusk-text">add friend</span> in the rail on the left — search, then hit{" "}
          <span className="font-semibold text-dusk-text">request</span>. for a dm from a server, hit{" "}
          <span className="font-semibold text-dusk-text">dm</span> on someone in the member list.
        </p>
        <button
          type="button"
          className="rounded-xl border border-white/[0.12] bg-white/[0.06] px-3 py-2 text-xs text-dusk-muted backdrop-blur-md transition hover:border-dusk-glow/40 hover:text-dusk-text"
          onClick={() => refreshDms()}
        >
          refresh list
        </button>
      </div>
    </div>
  );
}

function DmWorkspace({
  dms,
  socket,
  refreshDms,
  sidebar,
}: {
  dms: DmSummary[];
  socket: DuskSocket | null;
  refreshDms: () => void;
  sidebar: DmSidebarExtras;
}): React.ReactElement {
  const { conversationId } = useParams();
  const [peer, setPeer] = useState<LiteUser | null>(null);

  const fromList = useMemo(() => {
    if (!conversationId) return null;
    return dms.find((d) => d.id === conversationId)?.other ?? null;
  }, [conversationId, dms]);

  useEffect(() => {
    if (!conversationId) return;
    if (fromList) {
      setPeer(fromList);
      return;
    }
    let cancelled = false;
    api
      .dmPeer(conversationId)
      .then((r) => {
        if (!cancelled) setPeer(r.other);
      })
      .catch(() => {
        if (!cancelled) setPeer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, fromList]);

  if (!conversationId) {
    return <Navigate to="/app/dm" replace />;
  }

  const peerPresence = peer ? sidebar.presenceByUserId[peer.id] ?? null : null;

  return (
    <div className="flex min-h-0 flex-1">
      <DmSidebar items={dms} {...sidebar} />
      <DmChat
        conversationId={conversationId}
        peer={peer}
        peerPresence={peerPresence}
        socket={socket}
        onAfterVoice={refreshDms}
      />
    </div>
  );
}

function HomeJump({ servers, dms }: { servers: Server[]; dms: DmSummary[] }): React.ReactElement {
  const s0 = servers[0];
  if (s0) {
    const first = s0.channels.find((c) => c.kind !== "voice") ?? s0.channels[0];
    if (first) return <Navigate to={`/app/${s0.id}/${first.id}`} replace />;
  }
  if (dms[0]) return <Navigate to={`/app/dm/${dms[0].id}`} replace />;
  return <Navigate to="/app/dm" replace />;
}

export function WorkspacePage(): React.ReactElement {
  const { user, logout, applyAuthResponse } = useAuth();
  const nav = useNavigate();
  const [servers, setServers] = useState<Server[]>([]);
  const [dms, setDms] = useState<DmSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [socket, setSocket] = useState<DuskSocket | null>(null);
  const [socketEpoch, setSocketEpoch] = useState(0);
  const [modal, setModal] = useState<"create" | "join" | null>(null);
  const [modalInput, setModalInput] = useState("");
  const [modalErr, setModalErr] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const location = useLocation();
  const [notifyCount, setNotifyCount] = useState(0);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const dmsRef = useRef(dms);
  dmsRef.current = dms;

  const [friends, setFriends] = useState<FriendWithPresence[]>([]);
  const [friendIncoming, setFriendIncoming] = useState<SocialRequestRow[]>([]);
  const [friendOutgoing, setFriendOutgoing] = useState<SocialRequestRow[]>([]);
  const [dmIncoming, setDmIncoming] = useState<SocialRequestRow[]>([]);
  const [dmOutgoing, setDmOutgoing] = useState<SocialRequestRow[]>([]);
  const [presenceByUserId, setPresenceByUserId] = useState<Record<string, Presence>>({});
  const [userSearchOpen, setUserSearchOpen] = useState(false);
  const [dmGatePeer, setDmGatePeer] = useState<LiteUser | null>(null);

  const refreshServers = useCallback(() => {
    return api
      .servers()
      .then(setServers)
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "failed"));
  }, []);

  const refreshDms = useCallback(() => {
    return api.dms().then(setDms);
  }, []);

  const refreshSocial = useCallback(async () => {
    try {
      const [f, fin, fout, din, dout] = await Promise.all([
        api.friends(),
        api.friendRequests("incoming"),
        api.friendRequests("outgoing"),
        api.dmRequests("incoming"),
        api.dmRequests("outgoing"),
      ]);
      setFriends(f);
      setFriendIncoming(fin);
      setFriendOutgoing(fout);
      setDmIncoming(din);
      setDmOutgoing(dout);
      const ids = new Set<string>();
      for (const row of f) ids.add(row.user.id);
      for (const d of dmsRef.current) {
        if (d.other) ids.add(d.other.id);
      }
      const arr = [...ids];
      if (arr.length === 0) return;
      const pres = await api.presenceBulk(arr);
      setPresenceByUserId((prev) => {
        const n = { ...prev };
        for (const p of pres) n[p.userId] = p;
        return n;
      });
    } catch (e) {
      console.error(e);
    }
  }, []);

  const tryOpenDm = useCallback(
    async (peer: User | LiteUser) => {
      try {
        const { conversationId } = await api.openDm(peer.id);
        await refreshDms();
        nav(`/app/dm/${conversationId}`);
      } catch (e) {
        if (e instanceof Error && e.message === "dm_request_required") {
          setDmGatePeer(toLiteUser(peer));
          return;
        }
        console.error(e);
      }
    },
    [nav, refreshDms],
  );

  const onAcceptFriend = useCallback(
    async (id: string) => {
      try {
        await api.acceptFriendRequest(id);
        await refreshSocial();
        await refreshDms();
      } catch (e) {
        console.error(e);
      }
    },
    [refreshSocial, refreshDms],
  );

  const onDeclineFriend = useCallback(
    async (id: string) => {
      try {
        await api.declineFriendRequest(id);
        await refreshSocial();
      } catch (e) {
        console.error(e);
      }
    },
    [refreshSocial],
  );

  const onCancelFriend = useCallback(
    async (id: string) => {
      try {
        await api.cancelFriendRequest(id);
        await refreshSocial();
      } catch (e) {
        console.error(e);
      }
    },
    [refreshSocial],
  );

  const onRemoveFriend = useCallback(
    async (userId: string) => {
      if (!window.confirm("remove this friend? cold.")) return;
      try {
        await api.removeFriend(userId);
        await refreshSocial();
        await refreshDms();
      } catch (e) {
        console.error(e);
      }
    },
    [refreshSocial, refreshDms],
  );

  const onAcceptDmRequest = useCallback(
    async (id: string) => {
      try {
        const { conversationId } = await api.acceptDmRequest(id);
        await refreshSocial();
        await refreshDms();
        nav(`/app/dm/${conversationId}`);
      } catch (e) {
        console.error(e);
      }
    },
    [nav, refreshSocial, refreshDms],
  );

  const onDeclineDmRequest = useCallback(
    async (id: string) => {
      try {
        await api.declineDmRequest(id);
        await refreshSocial();
      } catch (e) {
        console.error(e);
      }
    },
    [refreshSocial],
  );

  const dmSidebarExtras: DmSidebarExtras = useMemo(
    () => ({
      friends,
      friendIncoming,
      friendOutgoing,
      dmIncoming,
      dmOutgoing,
      presenceByUserId,
      onUserSearch: () => setUserSearchOpen(true),
      onAcceptFriend: (id) => void onAcceptFriend(id),
      onDeclineFriend: (id) => void onDeclineFriend(id),
      onCancelFriend: (id) => void onCancelFriend(id),
      onRemoveFriend: (userId) => void onRemoveFriend(userId),
      onAcceptDmRequest: (id) => void onAcceptDmRequest(id),
      onDeclineDmRequest: (id) => void onDeclineDmRequest(id),
      onFriendOpenDm: (u) => void tryOpenDm(u),
    }),
    [
      friends,
      friendIncoming,
      friendOutgoing,
      dmIncoming,
      dmOutgoing,
      presenceByUserId,
      onAcceptFriend,
      onDeclineFriend,
      onCancelFriend,
      onRemoveFriend,
      onAcceptDmRequest,
      onDeclineDmRequest,
      tryOpenDm,
    ],
  );

  const bootstrap = useCallback(async () => {
    setLoadErr(null);
    try {
      const [s, d] = await Promise.all([api.servers(), api.dms()]);
      setServers(s);
      setDms(d);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "failed");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!ready) return;
    void refreshSocial();
  }, [ready, dms, refreshSocial]);

  useEffect(() => {
    const s = connectSocket();
    setSocket(s);
    return () => {
      s.disconnect();
    };
  }, [socketEpoch, user?.id]);

  useEffect(() => {
    if (!socket) return;
    const onUp = () => {
      void refreshServers();
    };
    socket.on("server:updated", onUp);
    return () => {
      socket.off("server:updated", onUp);
    };
  }, [socket, refreshServers]);

  const serverIdsJoined = useMemo(() => servers.map((x) => x.id).join(","), [servers]);

  useEffect(() => {
    if (!socket || !ready || servers.length === 0) return;
    for (const s of servers) {
      socket.emit("server:join", s.id);
    }
    return () => {
      for (const s of servers) {
        socket.emit("server:leave", s.id);
      }
    };
  }, [socket, ready, serverIdsJoined, servers]);

  useEffect(() => {
    setNotifyCount(0);
    setUnreadFavicon(false);
  }, [location.pathname]);

  useEffect(() => {
    const fn = (): void => {
      if (document.visibilityState === "visible") {
        setNotifyCount(0);
        setUnreadFavicon(false);
      }
    };
    window.addEventListener("visibilitychange", fn);
    return () => window.removeEventListener("visibilitychange", fn);
  }, []);

  useEffect(() => {
    document.title = notifyCount > 0 ? `(${notifyCount}) Dusk` : "Dusk";
  }, [notifyCount]);

  useEffect(() => {
    const unlock = (): void => {
      unlockAppAudio();
      window.removeEventListener("pointerdown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  useEffect(() => {
    if (!socket || !user?.id) return;
    const onCh = (p: { channelId: string; authorId: string }): void => {
      if (p.authorId === user.id) return;
      const { channelId: activeCh } = parseAppPath(pathRef.current);
      const visible = document.visibilityState === "visible";
      playMessagePing();
      if (p.channelId === activeCh && visible) return;
      setNotifyCount((n) => n + 1);
      setUnreadFavicon(true);
    };
    const onDm = (p: { conversationId: string; authorId: string }): void => {
      if (p.authorId === user.id) return;
      const { conversationId: activeDm } = parseAppPath(pathRef.current);
      const visible = document.visibilityState === "visible";
      playMessagePing();
      if (p.conversationId === activeDm && visible) return;
      setNotifyCount((n) => n + 1);
      setUnreadFavicon(true);
    };
    socket.on("notify:channel-message", onCh);
    socket.on("notify:dm-message", onDm);
    return () => {
      socket.off("notify:channel-message", onCh);
      socket.off("notify:dm-message", onDm);
    };
  }, [socket, user?.id]);

  useEffect(() => {
    if (!socket || !user?.id) return;
    const onPresence = (p: Presence): void => {
      setPresenceByUserId((prev) => ({ ...prev, [p.userId]: p }));
    };
    const onFriendReq = (): void => {
      void refreshSocial();
    };
    const onFriendUp = (): void => {
      void refreshSocial();
      void refreshDms();
    };
    const onDmReq = (): void => {
      void refreshSocial();
    };
    const onDmReqUp = (p: { status?: string; conversationId?: string }): void => {
      void refreshSocial();
      void refreshDms();
      if (p.status === "accepted" && p.conversationId) {
        nav(`/app/dm/${p.conversationId}`);
      }
    };
    socket.on("presence:update", onPresence);
    socket.on("friend:request:new", onFriendReq);
    socket.on("friend:updated", onFriendUp);
    socket.on("dm:request:new", onDmReq);
    socket.on("dm:request:updated", onDmReqUp);
    return () => {
      socket.off("presence:update", onPresence);
      socket.off("friend:request:new", onFriendReq);
      socket.off("friend:updated", onFriendUp);
      socket.off("dm:request:new", onDmReq);
      socket.off("dm:request:updated", onDmReqUp);
    };
  }, [socket, user?.id, refreshSocial, refreshDms, nav]);

  const openDmFromMember = useCallback(
    (peer: User) => {
      void tryOpenDm(peer);
    },
    [tryOpenDm],
  );

  async function handleModalSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setModalErr(null);
    try {
      if (modal === "create") {
        const srv = await api.createServer(modalInput.trim() || "my server");
        await refreshServers();
        nav(`/app/${srv.id}/${defaultOpenChannelId(srv.channels) ?? ""}`);
      } else if (modal === "join") {
        const srv = await api.joinServer(modalInput.trim().toUpperCase());
        await refreshServers();
        nav(`/app/${srv.id}/${defaultOpenChannelId(srv.channels) ?? ""}`);
      }
      setModal(null);
      setModalInput("");
    } catch (err) {
      setModalErr(err instanceof Error ? err.message : "nope");
    }
  }

  const firstDmHref = dms[0] ? `/app/dm/${dms[0].id}` : "/app/dm";

  if (loadErr) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="dusk-glass-modal max-w-sm px-8 py-6">
          <p className="text-dusk-accent">{loadErr}</p>
          <button
            type="button"
            className="mt-4 text-sm text-dusk-glow underline decoration-dusk-glow/50 underline-offset-4 transition hover:decoration-dusk-glow"
            onClick={() => window.location.reload()}
          >
            retry like a champ
          </button>
        </div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-dusk-muted">
        <span className="dusk-glass-composer animate-pulse rounded-full px-5 py-2.5 text-sm">syncing your digital trauma…</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 pb-14">
        <nav className="dusk-glass-surface-strong flex w-[72px] shrink-0 flex-col items-center gap-2 border-r border-white/[0.08] py-3">
          <div className="mb-2 flex flex-col items-center gap-1">
            <DuskMark unread={notifyCount > 0} size={40} />
            <span className="dusk-wordmark select-none text-[9px]">dusk</span>
          </div>
          <NavLink
            to={firstDmHref}
            className={({ isActive }) =>
              `flex h-11 w-11 items-center justify-center rounded-xl border text-sm font-semibold backdrop-blur-sm transition ${
                isActive
                  ? "border-dusk-glow/50 bg-gradient-to-br from-dusk-glow/20 to-dusk-twilight/15 text-dusk-glow shadow-[inset_0_0_0_1px_rgba(244,162,97,0.25),0_0_20px_-4px_rgba(244,162,97,0.35)]"
                  : "border-white/[0.08] bg-white/[0.04] text-dusk-muted hover:border-dusk-twilight/30 hover:text-dusk-text"
              }`
            }
            title="direct messages"
          >
            @
          </NavLink>
          <div className="my-1 h-px w-8 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
          <div className="flex flex-1 flex-col items-center gap-2 overflow-y-auto px-1">
            {servers.map((s) => (
              <NavLink
                key={s.id}
                to={`/app/${s.id}/${defaultOpenChannelId(s.channels) ?? ""}`}
                className={({ isActive }) =>
                  `flex shrink-0 items-center justify-center rounded-xl p-0 transition ${
                    isActive
                      ? "ring-2 ring-dusk-accent/90 ring-offset-2 ring-offset-transparent drop-shadow-[0_0_12px_rgba(232,93,76,0.45)]"
                      : "opacity-90 hover:opacity-100 hover:drop-shadow-[0_0_8px_rgba(155,127,214,0.25)]"
                  }`
                }
                title={s.name}
              >
                <ServerIcon serverId={s.id} name={s.name} iconUrl={s.iconUrl} size={44} />
              </NavLink>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setModal("create");
              setModalInput("");
              setModalErr(null);
            }}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-dashed border-dusk-border text-dusk-muted hover:border-dusk-glow hover:text-dusk-glow"
            title="create server"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              setModal("join");
              setModalInput("");
              setModalErr(null);
            }}
            className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.1] bg-white/[0.04] text-xs font-medium text-dusk-muted backdrop-blur-sm transition hover:border-dusk-twilight/35 hover:text-dusk-text"
            title="join with invite"
          >
            ↗
          </button>
        </nav>

        <div className="flex min-h-0 flex-1 flex-col">
          {servers.length === 0 && (
            <div className="shrink-0 border-b border-white/[0.06] bg-[rgba(6,5,12,0.45)] px-4 py-2 text-center text-[11px] text-dusk-muted backdrop-blur-md">
              no servers yet — hit <span className="font-semibold text-dusk-text">+</span> or <span className="font-semibold text-dusk-text">↗</span>{" "}
              in the rail, or camp in <NavLink className="text-dusk-glow underline" to="/app/dm">dms</NavLink>.
            </div>
          )}
          <div className="flex min-h-0 flex-1">
            <Routes>
              <Route index element={<HomeJump servers={servers} dms={dms} />} />
              <Route
                path="dm/:conversationId"
                element={<DmWorkspace dms={dms} socket={socket} refreshDms={refreshDms} sidebar={dmSidebarExtras} />}
              />
              <Route path="dm" element={<DmEnter dms={dms} refreshDms={refreshDms} sidebar={dmSidebarExtras} />} />
              <Route
                path=":serverId/:channelId"
                element={<Desk servers={servers} socket={socket} onOpenDm={openDmFromMember} refreshServers={refreshServers} />}
              />
            </Routes>
          </div>
        </div>
      </div>

      <div className="dusk-glass-footer absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between py-2 pl-[84px] pr-3">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1 text-left transition hover:bg-white/[0.05]"
          onClick={() => setProfileOpen(true)}
        >
          {user && <Avatar user={user} size={32} />}
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{user?.displayName}</div>
            <div className="truncate font-mono text-xs text-dusk-muted">
              @{user?.username}
              {user?.customStatus ? <span className="ml-2 text-dusk-glow">· {user.customStatus}</span> : null}
            </div>
          </div>
        </button>
        <button type="button" onClick={logout} className="shrink-0 text-xs text-dusk-muted hover:text-dusk-accent">
          log out
        </button>
      </div>

      {user && (
        <ProfileModal
          user={user}
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          onSaved={(u, token) => {
            applyAuthResponse(token, u);
            setSocketEpoch((x) => x + 1);
          }}
        />
      )}

      <UserSearchModal
        open={userSearchOpen}
        onClose={() => setUserSearchOpen(false)}
        onAfterRequest={() => void refreshSocial()}
      />

      {dmGatePeer ? (
        <DmGatePanel peer={dmGatePeer} onClose={() => setDmGatePeer(null)} onSent={() => void refreshSocial()} />
      ) : null}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(4,2,10,0.65)] p-4 backdrop-blur-md">
          <div className="dusk-glass-modal w-full max-w-md p-6">
            <h3 className="bg-gradient-to-r from-dusk-text to-dusk-twilight bg-clip-text text-lg font-semibold text-transparent">
              {modal === "create" ? "create server" : "join with invite"}
            </h3>
            <form onSubmit={handleModalSubmit} className="mt-4 space-y-3">
              <input
                className="dusk-input w-full text-sm"
                placeholder={modal === "create" ? "server name" : "invite code"}
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
                autoFocus
              />
              {modalErr && <p className="text-sm text-dusk-accent">{modalErr}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="rounded-xl px-3 py-2 text-sm text-dusk-muted transition hover:bg-white/[0.06] hover:text-dusk-text"
                  onClick={() => setModal(null)}
                >
                  cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-gradient-to-r from-dusk-accent to-dusk-horizon px-4 py-2 text-sm font-medium text-white shadow-[0_8px_24px_-8px_rgba(232,93,76,0.55)] transition hover:brightness-110"
                >
                  {modal === "create" ? "create" : "join"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
