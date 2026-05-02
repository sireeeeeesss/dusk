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
import type { Message, Server, User } from "../types";
import { normalizeChannelMessage } from "../normalizeMessage";
import { mediaKind, mediaKindLabel } from "../mediaKind";

const QUICK = ["👍", "❤️", "🔥", "😭", "✨", "🫩", "🎬"];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function isTextOnlyMessage(m: Message): boolean {
  return !m.hasVoice && !m.hasImage && !m.hasVideo && !m.hasAudio;
}

function reactionCounts(
  reactions: Message["reactions"],
  myId: string | undefined,
): { emoji: string; n: number; mine: boolean }[] {
  const map = new Map<string, { n: number; mine: boolean }>();
  for (const r of reactions) {
    const cur = map.get(r.emoji) ?? { n: 0, mine: false };
    cur.n += 1;
    if (myId && r.userId === myId) cur.mine = true;
    map.set(r.emoji, cur);
  }
  return Array.from(map.entries()).map(([emoji, v]) => ({ emoji, ...v }));
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

export function ChannelChat({
  server,
  channelId,
  socket,
}: {
  server: Server;
  channelId: string;
  socket: DuskSocket | null;
}): React.ReactElement {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
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
  const channel = server.channels.find((c) => c.id === channelId);

  const canModerate = useMemo(() => {
    if (!user?.id) return false;
    if (server.ownerId === user.id) return true;
    const row = server.memberships.find((x) => x.user.id === user.id);
    return row?.role === "owner" || row?.role === "admin";
  }, [server, user?.id]);

  const usernameSet = useMemo(() => {
    const s = new Set<string>();
    for (const m of server.memberships) s.add(m.user.username.toLowerCase());
    s.add("everyone");
    s.add("here");
    return s;
  }, [server.memberships]);

  const mentionChoices = useMemo(() => {
    return server.memberships.map((m) => m.user);
  }, [server.memberships]);

  const mergeMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      const i = prev.findIndex((p) => p.id === msg.id);
      const normalized = normalizeChannelMessage(msg);
      if (i === -1) return [...prev, normalized];
      const next = [...prev];
      next[i] = normalized;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setMessages([]);
    setLoading(true);
    api
      .messages(channelId)
      .then((m) => {
        if (!cancelled)
          setMessages(m.map((row) => normalizeChannelMessage(row)));
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
  }, [channelId]);

  useEffect(() => {
    if (!socket || !channelId) return;
    socket.emit("channel:join", channelId);
  }, [socket, channelId]);

  useEffect(() => {
    if (!socket) return;
    const onNew = (msg: Message) => {
      setMessages((prev) => {
        if (prev.some((p) => p.id === msg.id)) return prev;
        return [...prev, normalizeChannelMessage(msg)];
      });
    };
    const onPatch = (msg: Message) => {
      mergeMessage(msg);
    };
    const onDel = (p: { channelId: string; messageId: string }) => {
      if (p.channelId !== channelId) return;
      setMessages((prev) => prev.filter((x) => x.id !== p.messageId));
    };
    socket.on("message:new", onNew);
    socket.on("message:patch", onPatch);
    socket.on("message:delete", onDel);
    return () => {
      socket.off("message:new", onNew);
      socket.off("message:patch", onPatch);
      socket.off("message:delete", onDel);
    };
  }, [socket, channelId, mergeMessage]);

  useEffect(() => {
    if (!socket || !channelId) return;
    const onTyping = (p: { channelId: string; user: { id: string; displayName: string }; active: boolean }) => {
      if (p.channelId !== channelId || p.user.id === user?.id) return;
      setTypers((prev) => {
        const next = { ...prev };
        if (p.active) next[p.user.id] = { displayName: p.user.displayName, exp: Date.now() + 2800 };
        else delete next[p.user.id];
        return next;
      });
    };
    socket.on("typing:channel", onTyping);
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
      socket.off("typing:channel", onTyping);
      window.clearInterval(tick);
    };
  }, [socket, channelId, user?.id]);

  useEffect(() => {
    return () => {
      if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
      if (socket && channelId) socket.emit("typing:channel", { channelId, active: false });
    };
  }, [socket, channelId]);

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
      new Notification("dusk — you were mentioned", {
        body: `${last.author.displayName}: ${last.content.slice(0, 120)}`,
        tag: last.id,
      });
    } else if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, [lastId, messages, user?.id]);

  function emitTyping(active: boolean): void {
    if (!socket || !channelId) return;
    socket.emit("typing:channel", { channelId, active });
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const v = e.target.value;
    setInput(v);
    emitTyping(true);
    if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
    typingStopTimer.current = window.setTimeout(() => emitTyping(false), 2200);
    const el = e.target;
    const caret = el.selectionStart ?? v.length;
    const ctx = mentionQueryAtCaret(v, caret);
    if (ctx && channelId) {
      setMentionOpen(true);
      setMentionStart(ctx.start);
    } else {
      setMentionOpen(false);
    }
  }

  function insertMention(u: Pick<User, "id" | "username" | "displayName" | "avatarHue" | "accentHue">): void {
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
    const ctx = mentionQueryAtCaret(input, inputRef.current?.selectionStart ?? input.length);
    const q = ctx?.query ?? "";
    return mentionChoices.filter((u) => u.username.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionOpen, mentionChoices, input]);

  function send(e: React.FormEvent): void {
    e.preventDefault();
    const text = input.trim();
    if (!text || !socket || !channelId) return;
    setInput("");
    setMentionOpen(false);
    emitTyping(false);
    if (typingStopTimer.current) window.clearTimeout(typingStopTimer.current);
    socket.emit("message:send", { channelId, content: text }, (err?: string) => {
      if (err) setInput(text);
    });
  }

  const onVoice = useCallback(
    async (blob: Blob) => {
      if (!channelId) return;
      const cap = inputRef.current?.value?.trim() ?? "";
      setInput("");
      const msg = await api.uploadChannelVoice(channelId, blob, cap || undefined);
      mergeMessage(msg);
    },
    [channelId, mergeMessage],
  );

  const sendMedia = useCallback(async () => {
    if (!channelId || !pendingFile) return;
    const file = pendingFile;
    const cap = inputRef.current?.value?.trim() ?? "";
    setInput("");
    setPendingFile(null);
    const k = mediaKind(file);
    try {
      const msg =
        k === "audio"
          ? await api.uploadChannelAudio(channelId, file, cap || undefined)
          : k === "video"
            ? await api.uploadChannelVideo(channelId, file, cap || undefined)
            : await api.uploadChannelImage(channelId, file, cap || undefined);
      mergeMessage(msg);
    } catch {
      setPendingFile(file);
    }
  }, [channelId, pendingFile, mergeMessage]);

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const fresh = await api.toggleReaction(messageId, emoji);
      mergeMessage(fresh);
    },
    [mergeMessage],
  );

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    const t = editDraft.trim();
    if (!t) return;
    try {
      const fresh = await api.patchMessage(editingId, t);
      mergeMessage(fresh);
      setEditingId(null);
      setEditDraft("");
    } catch {
      /* toast who */
    }
  }, [editingId, editDraft, mergeMessage]);

  const removeMessage = useCallback(
    async (messageId: string) => {
      if (!window.confirm("delete this message?")) return;
      try {
        await api.deleteMessage(messageId);
        setMessages((prev) => prev.filter((x) => x.id !== messageId));
      } catch {
        /* nope */
      }
    },
    [],
  );

  const typingLabel = useMemo(() => {
    const names = Object.values(typers).map((t) => t.displayName);
    if (names.length === 0) return "";
    const slice = names.slice(0, 3);
    return `${slice.join(", ")}${names.length > 3 ? "…" : ""} typing…`;
  }, [typers]);

  const headerAccent = useMemo(() => {
    const h = user?.accentHue ?? 32;
    return `linear-gradient(90deg, hsl(${h}, 70%, 55%) 0%, hsl(${(h + 40) % 360}, 60%, 45%) 100%)`;
  }, [user?.accentHue]);

  if (!channel) {
    return (
      <div className="flex flex-1 items-center justify-center text-dusk-muted">
        channel vanished into the ether 🫩
      </div>
    );
  }

  return (
    <div className="dusk-glass-chat flex min-h-0 flex-1 flex-col">
      <header className="dusk-glass-header z-10 flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="bg-gradient-to-br from-dusk-twilight to-dusk-muted bg-clip-text text-lg font-semibold text-transparent">#</span>
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-dusk-text">{channel.name}</h1>
        <span className="ml-auto hidden h-2 w-2 rounded-full sm:block" style={{ background: headerAccent }} aria-hidden />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-4 py-3 text-sm text-dusk-muted">loading…</p>
        ) : messages.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-dusk-muted">this channel is quiet. say something unhinged.</p>
        ) : (
          <ul className="px-1 py-2">
            {messages.map((m) => {
              const mine = m.author.id === user?.id;
              const grouped = reactionCounts(m.reactions, user?.id);
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
                    <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0 ${mine ? "flex-row-reverse justify-end" : ""}`}>
                      <span className="text-[15px] font-semibold text-dusk-text">{m.author.displayName}</span>
                      <time className="text-[11px] font-medium text-dusk-muted/90">{formatTime(m.createdAt)}</time>
                      {m.editedAt ? (
                        <span className="text-[10px] font-medium uppercase tracking-wide text-dusk-muted/70">edited</span>
                      ) : null}
                      {pinged ? (
                        <span className="rounded bg-dusk-glow/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-dusk-glow">
                          @you
                        </span>
                      ) : null}
                    </div>
                    <div className={`mt-0.5 text-[15px] leading-snug text-dusk-text/95 ${mine ? "items-end" : ""}`}>
                      {hasMedia || !hideCaption || editingId === m.id ? (
                        <div className={`space-y-2 ${mine ? "inline-block text-left" : ""}`}>
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
                                  className="rounded-lg bg-dusk-accent px-2 py-1 text-xs text-white"
                                  onClick={() => void saveEdit()}
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
                    <div className={`mt-1 flex flex-wrap items-center gap-1 ${mine ? "justify-end" : ""}`}>
                      {mine && isTextOnlyMessage(m) ? (
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
                      {(mine || canModerate) && (
                        <button
                          type="button"
                          className="rounded px-1.5 py-0.5 text-[11px] text-dusk-muted opacity-0 transition hover:bg-white/[0.06] hover:text-dusk-accent group-hover/row:opacity-100"
                          onClick={() => void removeMessage(m.id)}
                        >
                          delete
                        </button>
                      )}
                      {QUICK.map((e) => (
                        <button
                          key={e + m.id}
                          type="button"
                          className="rounded px-1.5 py-0.5 text-[13px] text-dusk-muted opacity-0 transition hover:bg-white/[0.06] hover:text-dusk-text group-hover/row:opacity-100"
                          onClick={() => void toggleReaction(m.id, e)}
                          title="react"
                        >
                          {e}
                        </button>
                      ))}
                      {grouped.map(({ emoji, n, mine: mr }) => (
                        <button
                          key={emoji + m.id}
                          type="button"
                          onClick={() => void toggleReaction(m.id, emoji)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] backdrop-blur-sm ${
                            mr
                              ? "border-dusk-accent/45 bg-dusk-accent/15 text-dusk-glow shadow-[0_0_12px_-4px_rgba(232,93,76,0.35)]"
                              : "border-white/[0.1] bg-white/[0.04]"
                          }`}
                        >
                          {emoji} {n}
                        </button>
                      ))}
                    </div>
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
              className="shrink-0 rounded bg-dusk-accent px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-dusk-accent-dim"
              onClick={() => void sendMedia()}
            >
              upload
            </button>
          </div>
        ) : null}
        <div className="dusk-glass-composer flex min-h-[44px] items-center gap-1 px-1.5 py-1">
          <AttachmentPlusMenu onMediaFile={(f) => setPendingFile(f)} onAudioFile={(f) => setPendingFile(f)} />
          <VoiceRecordButton variant="toolbar" disabled={!channelId} onBlob={(b) => onVoice(b)} />
          <input
            ref={inputRef}
            className="min-h-[36px] min-w-0 flex-1 bg-transparent px-2 py-1.5 text-[15px] text-dusk-text outline-none placeholder:text-dusk-muted/60"
            placeholder={`Message #${channel.name}`}
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
