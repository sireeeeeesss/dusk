import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Avatar } from "./Avatar";
import { useVoiceMesh } from "../hooks/useVoiceMesh";
import type { DuskSocket } from "../socket";
import type { Channel } from "../types";

export function VoiceChannelPanel({
  channel,
  socket,
}: {
  channel: Channel;
  socket: DuskSocket | null;
}): React.ReactElement {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const voice = useVoiceMesh(socket, channel.id, user?.id, connected);

  useEffect(() => {
    setConnected(false);
    return () => {
      voice.disconnect();
    };
    // voice.disconnect is stable for a given channel/socket session
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset when switching voice channels
  }, [channel.id]);

  async function onConnect(): Promise<void> {
    setConnected(true);
    try {
      await voice.connect();
    } catch {
      setConnected(false);
    }
  }

  function onDisconnect(): void {
    voice.disconnect();
    setConnected(false);
  }

  return (
    <div className="dusk-glass-chat flex min-h-0 flex-1 flex-col">
      <header className="dusk-glass-header flex h-12 shrink-0 items-center gap-2 px-4">
        <span className="text-lg text-dusk-glow" aria-hidden>
          🔊
        </span>
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-dusk-text">{channel.name}</h1>
        <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-dusk-muted">voice</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
        <div className="dusk-glass-modal mx-auto max-w-lg p-6">
          <p className="text-sm text-dusk-muted">
            peer-to-peer audio with whoever&apos;s connected. no sfu — if nat hates you, blame physics. stun is google&apos;s
            public one.
          </p>
          {voice.error ? <p className="mt-2 text-sm text-dusk-accent">{voice.error}</p> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {!connected ? (
              <button
                type="button"
                onClick={() => void onConnect()}
                disabled={!socket}
                className="rounded-xl bg-gradient-to-r from-dusk-accent to-dusk-horizon px-4 py-2 text-sm font-medium text-white shadow-[0_8px_24px_-8px_rgba(232,93,76,0.45)] transition enabled:hover:brightness-110 disabled:opacity-40"
              >
                connect mic
              </button>
            ) : (
              <button
                type="button"
                onClick={onDisconnect}
                className="rounded-xl border border-white/[0.15] bg-white/[0.06] px-4 py-2 text-sm text-dusk-text backdrop-blur-sm transition hover:bg-white/[0.1]"
              >
                disconnect
              </button>
            )}
          </div>

          <div className="mt-6">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-dusk-muted">here ({voice.roster.length})</div>
            <ul className="mt-2 space-y-2">
              {voice.roster.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2">
                  <Avatar
                    user={{
                      displayName: p.displayName,
                      avatarHue: p.avatarHue,
                      accentHue: p.avatarHue,
                      avatarUrl: null,
                    }}
                    size={32}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.displayName}</div>
                    <div className="truncate font-mono text-[11px] text-dusk-muted">@{p.username}</div>
                  </div>
                  {p.id === user?.id ? (
                    <span className="ml-auto text-[10px] font-semibold uppercase text-dusk-glow">you</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="sr-only" aria-live="polite">
            {[...voice.remoteStreams.entries()].map(([id, stream]) => (
              <RemoteAudio key={id} stream={stream} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RemoteAudio({ stream }: { stream: MediaStream }): React.ReactElement {
  return <audio autoPlay playsInline ref={(el) => { if (el) el.srcObject = stream; }} />;
}
