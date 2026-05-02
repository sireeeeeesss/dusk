import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./Avatar";
import { AttachmentPlusMenu } from "./AttachmentPlusMenu";
import { ImageAttachment } from "./ImageAttachment";
import { VideoAttachment } from "./VideoAttachment";
import { MessageRichText } from "./MessageRichText";
import { VoicePlayer } from "./VoicePlayer";
import { VoiceRecordButton } from "./VoiceRecordButton";
import type { DuskSocket } from "../socket";
import { NavLink } from "react-router-dom";
import type { DmMessage, DmSummary, FriendWithPresence, LiteUser, Presence, SocialRequestRow } from "../types";
import { normalizeDmMessage } from "../normalizeMessage";
import { mediaKind, mediaKindLabel } from "../mediaKind";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function isTextOnlyDmMessage(m: DmMessage): boolean {
  return !m.hasVoice && !m.hasImage && !m.hasVideo && !m.hasAudio;
}

function mentionQueryAtCaret(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const slice = before.slice(at + 1);
  if (/\s/.test(slice)) return null;
  return { start: at, query: slice.toLowerCase() };
}

export type DmSidebarExtras = {
  friends: FriendWithPresence[];
  friendIncoming: SocialRequestRow[];
  friendOutgoing: SocialRequestRow[];
  dmIncoming: SocialRequestRow[];
  dmOutgoing: SocialRequestRow[];
  presenceByUserId: Record<string, Presence>;
  onUserSearch: () => void;
  onAcceptFriend: (id: string) => void;
  onDeclineFriend: (id: string) => void;
  onCancelFriend: (id: string) => void;
  onRemoveFriend: (userId: string) => void;
  onAcceptDmRequest: (id: string) => void;
  onDeclineDmRequest: (id: string) => void;
  onFriendOpenDm: (u: LiteUser) => void;
};

export function DmChat({
  conversationId,
  peer,
  peerPresence,
  socket,
  onAfterVoice,
}: {
  conversationId: string;
  peer: LiteUser | null;
  peerPresence?: Presence | null;
  socket: DuskSocket | null;
  onAfterVoice?: () => void;
}): React.ReactElement {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionStart, setMentionStart] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [typers, setTypers] = useState<Record<string, { displayName: string; exp: number }>>({});
  const typingStopTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const mergeDm = useCallback((msg: DmMessage) => {
    setMessages((prev) => {
      const i = prev.findIndex((p) => p.id === msg.id);
      const normalized = normalizeDmMessage(msg);
      if (i === -1) return [...prev, normalized];
      const next = [...prev];
      next[i] = normalized;
      return next;
    });
  }, []);

  const usernameSet = useMemo(() => {
    const s = new Set<string>();
    if (peer) s.add(peer.username.toLowerCase());
    if (user) s.add(user.username.toLowerCase());
    s.add("everyone");
    s.add("here");
    return s;
  }, [peer, user]);

  const mentionChoices = useMemo(() => {
    const list: LiteUser[] = [];
    if (peer) list.push(peer);
    if (user) list.push(user);
    return list.filter((u, i, a) => a.findIndex((x) => x.id === u.id) === i);
  }, [peer, user]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setLoading(true);
    api
      .dmMessages(conversationId)
      .then((m) => {
        if (!cancelled)
          setMessages(m.map((row) => normalizeDmMessage(row)));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!socket || !conversationId) return;
    socket.emit("dm:join", conversationId);
  }, [socket, conversationId]);

  useEffect(() => {
    if (!socket) return;
    const onNew = (msg: DmMessage) => {
      setMessages((prev) => {
        if (prev.some((p) => p.id === msg.id)) return prev;
        return [...prev, normalizeDmMessage(msg)];
      });
    };
    const onPatch = (msg: DmMessage) => {
      mergeDm(msg);
    };
    const onDel = (p: { conversationId: string; messageId: string }) => {
      if (p.conversationId !== conversationId) return;
      setMessages((prev) => prev.filter((x) => x.id !== p.messageId));
    };
    socket.on("dm:message:new", onNew);
    socket.on("dm:message:patch", onPatch);
    socket.on("dm:message:delete", onDel);
    return () => {
      socket.off("dm:message:new", onNew);
      socket.off("dm:message:patch", onPatch);
      socket.off("dm:message:delete", onDel);
    };
  }, [socket, conversationId, mergeDm]);

  useEffect(() => {
    if (!socket || !conversationId) return;
    const onTyping = (p: { conversationId: string; user: { id: string; displayName: string }; active: boolean }) => {
      if (p.conversationId !== conversationId || p.user.id === user?.id) return;
      setTypers((prev) => {
        const next = { ...prev };
        if (p.active) next[p.user.id] = { displayName: p.user.displayName, exp: Date.now() + 2800 };
        else delete next[p.user.id];
        return next;
      });
    };
    socket.on("typing:dm", onTyping);
    const tick = window.setInterval(() => {
      const now = Date.now();
      setTypers((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const k of Object.keys(next)) {
          if (next[k]!.exp < now) {
            delete next[k];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 600);
    return () => {
      socket.off("typing:dm", onTyping);
      window.clearInterval(tick);
    };
  }, [socket, conversationId, user?.id]);

  useEffect(() => {
    return () => {
      if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
      if (socket && conversationId) socket.emit("typing:dm", { conversationId, active: false });
    };
  }, [socket, conversationId]);

  const typingLabel = useMemo(() => {
    const names = Object.values(typers).map((t) => t.displayName);
    if (names.length === 0) return "";
    return `${names.slice(0, 2).join(", ")}${names.length > 2 ? "…" : ""} typing…`;
  }, [typers]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || !user?.id) return;
    if (last.author.id === user.id) return;
    const ids = last.mentionIds ?? [];
    if (!ids.includes(user.id)) return;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("dusk — dm ping", {
        body: `${last.author.displayName}: ${last.content.slice(0, 120)}`,
        tag: last.id,
      });
    } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, [lastId, messages, user?.id]);

  function emitTypingDm(active: boolean): void {
    if (!socket || !conversationId) return;
    socket.emit("typing:dm", { conversationId, active });
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const v = e.target.value;
    setInput(v);
    emitTypingDm(true);
    if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
    typingStopTimer.current = window.setTimeout(() => emitTypingDm(false), 2200);
    const caret = e.target.selectionStart ?? v.length;
    const ctx = mentionQueryAtCaret(v, caret);
    if (ctx) {
      setMentionOpen(true);
      setMentionStart(ctx.start);
    } else {
      setMentionOpen(false);
    }
  }

  function insertMention(u: LiteUser): void {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const before = input.slice(0, mentionStart);
    const after = input.slice(caret);
    setInput(`${before}@${u.username} ${after}`);
    setMentionOpen(false);
    requestAnimationFrame(() => el?.focus());
  }

  const filteredMentions = useMemo(() => {
    if (!mentionOpen) return [];
    const caret = inputRef.current?.selectionStart ?? input.length;
    const ctx = mentionQueryAtCaret(input, caret);
    const q = ctx?.query ?? "";
    return mentionChoices.filter((u) => u.username.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionOpen, mentionChoices, input]);

  function send(e: React.FormEvent): void {
    e.preventDefault();
    const text = input.trim();
    if (!text || !socket || !conversationId) return;
    setInput("");
    setMentionOpen(false);
    emitTypingDm(false);
    socket.emit("dm:message:send", { conversationId, content: text }, (err?: string) => {
      if (err) setInput(text);
    });
  }

  const saveDmEdit = useCallback(async () => {
    if (!editingId) return;
    const t = editDraft.trim();
    if (!t) return;
    try {
      const fresh = await api.patchDmMessage(editingId, t);
      mergeDm(fresh);
      setEditingId(null);
      setEditDraft("");
    } catch {
      /* shrug */
    }
  }, [editingId, editDraft, mergeDm]);

  const removeDm = useCallback(async (messageId: string) => {
    if (!window.confirm("delete this message?")) return;
    try {
      await api.deleteDmMessage(messageId);
      setMessages((prev) => prev.filter((x) => x.id !== messageId));
    } catch {
      /* no */
    }
  }, []);

  const onVoice = useCallback(async (blob: Blob) => {
    const cap = inputRef.current?.value?.trim() ?? "";
    setInput("");
    await api.uploadDmVoice(conversationId, blob, cap || undefined);
    onAfterVoice?.();
  }, [conversationId, onAfterVoice]);

  const sendMedia = useCallback(async () => {
    if (!conversationId || !pendingFile) return;
    const file = pendingFile;
    const cap = inputRef.current?.value?.trim() ?? "";
    setInput("");
    setPendingFile(null);
    const k = mediaKind(file);
    try {
      const msg =
        k === "audio"
          ? await api.uploadDmAudio(conversationId, file, cap || undefined)
          : k === "video"
            ? await api.uploadDmVideo(conversationId, file, cap || undefined)
            : await api.uploadDmImage(conversationId, file, cap || undefined);
      setMessages((prev) => {
        if (prev.some((p) => p.id === msg.id)) return prev;
        return [...prev, normalizeDmMessage(msg)];
      });
      onAfterVoice?.();
    } catch {
      setPendingFile(file);
    }
  }, [conversationId, pendingFile, onAfterVoice]);

  const title = peer?.displayName ?? "direct messages";

  return (
    <div className="dusk-glass-chat flex min-h-0 flex-1 flex-col">
      <header className="dusk-glass-header flex h-12 shrink-0 items-center gap-2 px-4">
        {peer ? (
          <Avatar user={peer} size={32} presence={peerPresence ?? null} />
        ) : (
          <div className="h-8 w-8 rounded-full border border-white/[0.12] bg-white/[0.05] backdrop-blur-sm" />
        )}
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-dusk-text">{title}</div>
          {peer ? <div className="truncate text-xs text-dusk-muted">@{peer.username}</div> : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-4 py-3 text-sm text-dusk-muted">loading…</p>
        ) : messages.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-dusk-muted">empty dm. drop a meme or an mp3. we don&apos;t judge.</p>
        ) : (
          <ul className="px-1 py-2">
            {messages.map((m) => {
              const mine = m.author.id === user?.id;
              const pinged = !!(user?.id && (m.mentionIds ?? []).includes(user.id) && m.author.id !== user.id);
              const hideCaption =
                (m.hasVoice && m.content === "🎤 voice message") ||
                (m.hasImage && m.content === "📷 image") ||
                (m.hasVideo && m.content === "🎬 video") ||
                (m.hasAudio && m.content === "🎵 audio");
              const hasMedia = m.hasImage || m.hasVideo || m.hasVoice || m.hasAudio;
              return (
                <li
                  key={m.id}
                  className={`group/row flex gap-3 rounded-xl px-2 py-1.5 transition hover:bg-white/[0.04] ${mine ? "flex-row-reverse" : ""}`}
                >
                  <div className="mt-0.5 shrink-0">
                    <Avatar user={m.author} size={40} />
                  </div>
                  <div className={`min-w-0 max-w-[min(760px,calc(100%-3rem))] flex-1 ${mine ? "text-right" : "text-left"}`}>
                    <div className={`flex flex-wrap items-baseline gap-x-2 ${mine ? "flex-row-reverse justify-end" : ""}`}>
                      <span className="text-[15px] font-semibold text-dusk-text">{m.author.displayName}</span>
                      <time className="text-[11px] font-medium text-dusk-muted/90">{formatTime(m.createdAt)}</time>
                      {m.editedAt ? (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-dusk-muted/70">edited</span>
                      ) : null}
                      {pinged ? (
                        <span className="rounded bg-dusk-glow/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-dusk-glow">
                          @you
                        </span>
                      ) : null}
                    </div>
                    <div className={`mt-0.5 text-[15px] leading-snug text-dusk-text/95 ${mine ? "inline-block text-left" : ""}`}>
                      {hasMedia || !hideCaption || editingId === m.id ? (
                        <div className="space-y-2">
                          {m.hasImage && m.imageUrl ? <ImageAttachment url={m.imageUrl} alt="" /> : null}
                          {m.hasVideo && m.videoUrl ? <VideoAttachment url={m.videoUrl} /> : null}
                          {m.hasVoice && m.voiceUrl ? <VoicePlayer url={m.voiceUrl} /> : null}
                          {m.hasAudio && m.audioUrl ? <VoicePlayer url={m.audioUrl} /> : null}
                          {editingId === m.id ? (
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <input
                                className="dusk-input min-w-0 flex-1 text-sm"
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                maxLength={4000}
                              />
                              <div className="flex gap-1">
                                <button
                                  type="button"
                                  className="rounded-lg bg-dusk-glow px-2 py-1 text-xs font-medium text-dusk-void"
                                  onClick={() => void saveDmEdit()}
                                >
                                  save
                                </button>
                                <button
                                  type="button"
                                  className="rounded-lg px-2 py-1 text-xs text-dusk-muted hover:bg-white/[0.06]"
                                  onClick={() => {
                                    setEditingId(null);
                                    setEditDraft("");
                                  }}
                                >
                                  cancel
                                </button>
                              </div>
                            </div>
                          ) : !hideCaption ? (
                            <div className="whitespace-pre-wrap break-words">
                              <MessageRichText content={m.content} usernameSet={usernameSet} />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {mine ? (
                      <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "justify-end" : ""}`}>
                        {isTextOnlyDmMessage(m) ? (
                          <button
                            type="button"
                            className="rounded px-1.5 py-0.5 text-[11px] text-dusk-muted opacity-0 transition hover:bg-white/[0.06] hover:text-dusk-text group-hover/row:opacity-100"
                            onClick={() => {
                              setEditingId(m.id);
                              setEditDraft(m.content);
                            }}
                          >
                            edit
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="rounded px-1.5 py-0.5 text-[11px] text-dusk-muted opacity-0 transition hover:text-dusk-accent group-hover/row:opacity-100"
                          onClick={() => void removeDm(m.id)}
                        >
                          delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="dusk-glass-footer relative shrink-0 px-4 pb-4 pt-2">
        {typingLabel ? (
          <div className="mb-1 px-1 text-[11px] font-medium italic text-dusk-twilight/90">{typingLabel}</div>
        ) : null}
        {mentionOpen && filteredMentions.length > 0 && (
          <div className="dusk-glass-popover absolute bottom-full left-4 right-4 mb-2 max-h-44 overflow-y-auto py-1">
            {filteredMentions.map((u) => (
              <button
                key={u.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-white/[0.06]"
                onClick={() => insertMention(u)}
              >
                <Avatar user={u} size={24} />
                <span className="font-medium">{u.displayName}</span>
                <span className="font-mono text-xs text-dusk-muted">@{u.username}</span>
              </button>
            ))}
          </div>
        )}
        {pendingFile ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.05] px-2.5 py-1.5 text-xs backdrop-blur-md">
            <span className="shrink-0 text-dusk-muted">{mediaKindLabel(mediaKind(pendingFile))}</span>
            <span className="min-w-0 flex-1 truncate text-dusk-text/90">{pendingFile.name}</span>
            <button type="button" className="shrink-0 text-dusk-muted hover:text-dusk-accent" onClick={() => setPendingFile(null)}>
              ×
            </button>
            <button
              type="button"
              className="shrink-0 rounded bg-dusk-glow px-2 py-0.5 text-[11px] font-semibold text-dusk-void hover:brightness-110"
              onClick={() => void sendMedia()}
            >
              upload
            </button>
          </div>
        ) : null}
        <div className="dusk-glass-composer flex min-h-[44px] items-center gap-1 px-1.5 py-1">
          <AttachmentPlusMenu onMediaFile={(f) => setPendingFile(f)} onAudioFile={(f) => setPendingFile(f)} />
          <VoiceRecordButton variant="toolbar" disabled={!conversationId} onBlob={(b) => onVoice(b)} />
          <input
            ref={inputRef}
            className="min-h-[36px] min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[15px] text-dusk-text outline-none placeholder:text-dusk-muted/60"
            placeholder={peer ? `Message @${peer.username}` : "Message…"}
            value={input}
            onChange={onInputChange}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMentionOpen(false);
            }}
            maxLength={4000}
          />
          <button
            type="submit"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-lg text-dusk-muted transition hover:bg-white/[0.08] hover:text-dusk-text disabled:opacity-40"
            title="send"
            disabled={!input.trim()}
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}

function sectionTitle(t: string): React.ReactElement {
  return <div className="px-2 pb-1 pt-3 text-[9px] font-bold uppercase tracking-[0.2em] text-dusk-muted/90 first:pt-1">{t}</div>;
}

export function DmSidebar({ items, ...social }: { items: DmSummary[] } & DmSidebarExtras): React.ReactElement {
  const {
    friends,
    friendIncoming,
    friendOutgoing,
    dmIncoming,
    dmOutgoing,
    presenceByUserId,
    onUserSearch,
    onAcceptFriend,
    onDeclineFriend,
    onCancelFriend,
    onRemoveFriend,
    onAcceptDmRequest,
    onDeclineDmRequest,
    onFriendOpenDm,
  } = social;

  return (
    <aside className="dusk-glass-surface flex w-60 shrink-0 flex-col border-r border-white/[0.06]">
      <div className="flex min-h-[52px] shrink-0 items-center justify-between gap-2 border-b border-white/[0.08] px-2 py-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-dusk-muted">direct</span>
        <button
          type="button"
          title="Search by username or display name, then send a friend request"
          className="shrink-0 rounded-lg border border-dusk-glow/30 bg-dusk-glow/10 px-2 py-1.5 text-[9px] font-bold uppercase leading-tight tracking-wide text-dusk-glow backdrop-blur-sm transition hover:border-dusk-glow/55 hover:bg-dusk-glow/15"
          onClick={onUserSearch}
        >
          add
          <br />
          friend
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {friends.length > 0 ? (
          <>
            {sectionTitle("friends")}
            <ul className="space-y-0.5">
              {friends.map((f) => (
                <li key={f.user.id} className="group flex items-center gap-1.5 rounded-xl px-1.5 py-1 hover:bg-white/[0.04]">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => onFriendOpenDm(f.user)}
                  >
                    <Avatar user={f.user} size={26} presence={f.presence} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-dusk-text">{f.user.displayName}</span>
                  </button>
                  <button
                    type="button"
                    title="remove friend"
                    className="shrink-0 rounded px-1 text-[11px] text-dusk-muted opacity-0 transition hover:text-dusk-accent group-hover:opacity-100"
                    onClick={() => onRemoveFriend(f.user.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {sectionTitle("friends")}
            <p className="px-2 pb-2 text-[11px] leading-snug text-dusk-muted">
              no friends yet — tap <span className="font-semibold text-dusk-glow">add friend</span> above, type 2+ letters in the search box, then hit{" "}
              <span className="font-semibold text-dusk-text">add</span> on someone. that&apos;s the whole ritual.
            </p>
          </>
        )}

        {friendIncoming.length > 0 ? (
          <>
            {sectionTitle("friend requests")}
            <ul className="space-y-1">
              {friendIncoming.map((r) => (
                <li key={r.id} className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Avatar user={r.user} size={24} presence={presenceByUserId[r.user.id] ?? null} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{r.user.displayName}</span>
                  </div>
                  <div className="mt-1 flex gap-1 pl-[2.125rem]">
                    <button
                      type="button"
                      className="rounded bg-dusk-glow/90 px-2 py-0.5 text-[10px] font-semibold text-dusk-void"
                      onClick={() => onAcceptFriend(r.id)}
                    >
                      yep
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/[0.1] px-2 py-0.5 text-[10px] text-dusk-muted hover:text-dusk-accent"
                      onClick={() => onDeclineFriend(r.id)}
                    >
                      nah
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {friendOutgoing.length > 0 ? (
          <>
            {sectionTitle("pending (you → them)")}
            <ul className="space-y-1">
              {friendOutgoing.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-xl border border-white/[0.05] px-2 py-1">
                  <Avatar user={r.user} size={22} />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-dusk-muted">{r.user.displayName}</span>
                  <button
                    type="button"
                    className="shrink-0 text-[10px] text-dusk-muted hover:text-dusk-accent"
                    onClick={() => onCancelFriend(r.id)}
                  >
                    cancel
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {dmIncoming.length > 0 ? (
          <>
            {sectionTitle("dm unlock requests")}
            <ul className="space-y-1">
              {dmIncoming.map((r) => (
                <li key={r.id} className="rounded-xl border border-dusk-twilight/20 bg-dusk-twilight/[0.06] px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Avatar user={r.user} size={24} />
                    <span className="min-w-0 flex-1 truncate text-xs">{r.user.displayName}</span>
                  </div>
                  <div className="mt-1 flex gap-1 pl-[2.125rem]">
                    <button
                      type="button"
                      className="rounded bg-dusk-glow/90 px-2 py-0.5 text-[10px] font-semibold text-dusk-void"
                      onClick={() => onAcceptDmRequest(r.id)}
                    >
                      unlock
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/[0.1] px-2 py-0.5 text-[10px] text-dusk-muted"
                      onClick={() => onDeclineDmRequest(r.id)}
                    >
                      deny
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {dmOutgoing.length > 0 ? (
          <>
            {sectionTitle("your dm asks")}
            <ul className="space-y-0.5 pb-1">
              {dmOutgoing.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-0.5 text-[11px] text-dusk-muted">
                  <span className="min-w-0 flex-1 truncate">→ {r.user.displayName}</span>
                  <span className="shrink-0 text-[9px] uppercase">wait</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {sectionTitle("conversations")}
        <ul>
          {items.length === 0 ? (
            <li className="px-2 py-4 text-center text-[11px] leading-snug text-dusk-muted">
              no open dms. bug a coworker from members or accept a dm request above ✌️
            </li>
          ) : (
            items.map((d) => {
              const u = d.other;
              const label = u?.displayName ?? "unknown";
              const pres = u ? presenceByUserId[u.id] ?? null : null;
              return (
                <li key={d.id}>
                  <NavLink
                    to={`/app/dm/${d.id}`}
                    className={({ isActive }) =>
                      `mb-0.5 flex flex-col gap-0.5 rounded-xl px-2 py-2 text-sm transition ${
                        isActive
                          ? "border border-white/[0.1] bg-white/[0.1] text-dusk-text shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_24px_-12px_rgba(155,127,214,0.25)] backdrop-blur-md"
                          : "text-dusk-muted hover:bg-white/[0.05] hover:text-dusk-text"
                      }`
                    }
                  >
                    <div className="flex items-center gap-2">
                      {u ? (
                        <Avatar user={u} size={28} presence={pres} />
                      ) : (
                        <span className="h-7 w-7 rounded-md border border-white/[0.1] bg-white/[0.05] backdrop-blur-sm" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                    </div>
                    {d.lastMessage ? (
                      <span className="line-clamp-2 pl-9 text-[11px] leading-snug text-dusk-muted">
                        {d.lastMessage.hasVideo ? "🎬 " : d.lastMessage.hasImage ? "🖼 " : d.lastMessage.hasVoice ? "🎤 " : d.lastMessage.hasAudio ? "🎵 " : ""}
                        {d.lastMessage.content}
                      </span>
                    ) : null}
                  </NavLink>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </aside>
  );
}
