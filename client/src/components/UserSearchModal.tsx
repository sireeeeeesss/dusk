import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Avatar } from "./Avatar";
import type { LiteUser } from "../types";

export function UserSearchModal({
  open,
  onClose,
  onAfterRequest,
}: {
  open: boolean;
  onClose: () => void;
  onAfterRequest?: () => void;
}): React.ReactElement | null {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<LiteUser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const runSearch = useCallback(async (query: string) => {
    const t = query.trim();
    if (t.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const rows = await api.userSearch(t);
      setResults(rows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "search died");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setQ("");
      setResults([]);
      setErr(null);
      return;
    }
    const id = window.setTimeout(() => void runSearch(q), 220);
    return () => window.clearTimeout(id);
  }, [open, q, runSearch]);

  async function sendRequest(u: LiteUser): Promise<void> {
    setBusyId(u.id);
    setErr(null);
    try {
      await api.sendFriendRequest(u.id);
      onAfterRequest?.();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "nope";
      if (msg === "incoming_request_exists") {
        setErr("they already slid into your requests first — check incoming friend reqs 🫩");
      } else {
        setErr(msg);
      }
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(4,2,10,0.72)] p-4 backdrop-blur-md">
      <div className="dusk-glass-modal flex max-h-[min(520px,85vh)] w-full max-w-md flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="bg-gradient-to-r from-dusk-text to-dusk-twilight bg-clip-text text-lg font-semibold text-transparent">
              add a friend
            </h3>
            <p className="mt-1 text-xs text-dusk-muted">
              type 2+ characters (username or display name). each row has an <span className="font-semibold text-dusk-text">add</span> button — that sends a{" "}
              <span className="font-semibold text-dusk-glow">friend request</span>, not a DM.
            </p>
          </div>
          <button type="button" className="rounded-lg px-2 py-1 text-sm text-dusk-muted hover:bg-white/[0.06]" onClick={onClose}>
            ×
          </button>
        </div>
        <input
          className="dusk-input mt-4 w-full text-sm"
          placeholder="username or display name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
        {err ? <p className="mt-2 text-xs text-dusk-accent">{err}</p> : null}
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {loading ? <p className="py-6 text-center text-xs text-dusk-muted">summoning names…</p> : null}
          {!loading && q.trim().length >= 2 && results.length === 0 && !err ? (
            <p className="py-6 text-center text-xs text-dusk-muted">nobody matches that lore 💀</p>
          ) : null}
          <ul className="space-y-1 pb-2">
            {results.map((u) => (
              <li key={u.id} className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2 py-2">
                <Avatar user={u} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{u.displayName}</div>
                  <div className="truncate font-mono text-[11px] text-dusk-muted">@{u.username}</div>
                </div>
                <button
                  type="button"
                  disabled={busyId === u.id}
                  className="shrink-0 rounded-lg bg-dusk-glow/90 px-2.5 py-1 text-[11px] font-semibold text-dusk-void disabled:opacity-40"
                  onClick={() => void sendRequest(u)}
                >
                  {busyId === u.id ? "…" : "request"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
