import { useEffect, useState } from "react";
import { fetchVideoBlob } from "../api";

export function VideoAttachment({ url }: { url: string }): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchVideoBlob(url)
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

  if (err) return <p className="text-xs text-dusk-accent">video said no (codec drama)</p>;
  if (!src) return <p className="text-xs text-dusk-muted">buffering your masterpiece…</p>;
  return (
    <video
      src={src}
      controls
      playsInline
      className="max-h-80 max-w-full rounded-xl border border-white/[0.12] bg-black/35 shadow-[0_16px_48px_-28px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-[2px]"
    />
  );
}
