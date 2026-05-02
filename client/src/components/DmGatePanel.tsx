import { api } from "../api";
import type { LiteUser } from "../types";

export function DmGatePanel({
  peer,
  onClose,
  onSent,
}: {
  peer: LiteUser;
  onClose: () => void;
  onSent: () => void;
}): React.ReactElement {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-[rgba(4,2,10,0.72)] p-4 backdrop-blur-md">
      <div className="dusk-glass-modal w-full max-w-md space-y-4 p-6">
        <h3 className="text-lg font-semibold text-dusk-text">dm is gated 🫩</h3>
        <p className="text-sm text-dusk-muted">
          you&apos;re not mutuals with <span className="font-medium text-dusk-text">{peer.displayName}</span> yet. send a dm unlock
          request and hope they&apos;re feeling charitable.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-xl px-3 py-2 text-sm text-dusk-muted hover:bg-white/[0.06]"
            onClick={onClose}
          >
            cancel
          </button>
          <button
            type="button"
            className="rounded-xl bg-gradient-to-r from-dusk-accent to-dusk-horizon px-4 py-2 text-sm font-medium text-white"
            onClick={() =>
              void (async () => {
                try {
                  await api.createDmRequest(peer.id);
                  onClose();
                  onSent();
                } catch (e) {
                  console.error(e);
                }
              })()
            }
          >
            send dm request
          </button>
        </div>
      </div>
    </div>
  );
}
