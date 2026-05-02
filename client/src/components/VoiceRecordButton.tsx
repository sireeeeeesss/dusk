import { useCallback, useRef, useState } from "react";

type Props = {
  disabled?: boolean;
  onBlob: (blob: Blob) => Promise<void>;
  /** slimmer control for the inline composer bar */
  variant?: "default" | "toolbar";
};

export function VoiceRecordButton({ disabled, onBlob, variant = "default" }: Props): React.ReactElement {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const stop = useCallback(() => {
    mr.current?.stop();
    mr.current = null;
    setRecording(false);
  }, []);

  const start = useCallback(async () => {
    if (disabled || busy) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        chunks.current = [];
        if (blob.size > 800) {
          setBusy(true);
          try {
            await onBlob(blob);
          } finally {
            setBusy(false);
          }
        }
      };
      mr.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      // mic denied — user gets nothing, we're not their parent
    }
  }, [disabled, busy, onBlob]);

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => (recording ? stop() : void start())}
      className={
        variant === "toolbar"
          ? `flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-full text-sm transition ${
              recording
                ? "bg-dusk-accent/25 text-dusk-glow animate-pulse"
                : "text-dusk-muted hover:bg-white/[0.06] hover:text-dusk-text"
            }`
          : `flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-xl border text-sm backdrop-blur-sm transition ${
              recording
                ? "border-dusk-accent bg-dusk-accent/25 text-dusk-glow shadow-[0_0_20px_-6px_rgba(232,93,76,0.5)] animate-pulse"
                : "border-white/[0.12] bg-white/[0.06] text-dusk-muted hover:border-dusk-glow/45 hover:text-dusk-text"
            }`
      }
      title={recording ? "stop & send" : "voice message"}
    >
      {busy ? "…" : "🎙"}
    </button>
  );
}
