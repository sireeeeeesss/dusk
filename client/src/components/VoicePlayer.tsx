import { useEffect, useState } from "react";
import { fetchAuthedMediaBlob } from "../api";

export function VoicePlayer({ url }: { url: string }): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchAuthedMediaBlob(url)
      .then((u) => {
        if (!cancelled) {
          objectUrl = u;
          setSrc(u);
          setErr(false);
        }
      })
      .catch(() => {
        if (!cancelled) setErr(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (err) return <span className="text-xs text-dusk-accent">audio died heroically</span>;
  if (!src) return <span className="text-xs text-dusk-muted">loading waveform gremlins…</span>;
  return (
    <audio
      controls
      className="h-9 w-full max-w-[min(280px,100%)] rounded-lg border border-white/[0.12] bg-[rgba(8,6,14,0.55)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-md"
      src={src}
    />
  );
}
