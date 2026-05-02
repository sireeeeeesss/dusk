import { useEffect, useState } from "react";
import { fetchImageBlob } from "../api";

export function ImageAttachment({ url, alt }: { url: string; alt?: string }): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    fetchImageBlob(url)
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

  if (err) return <p className="text-xs text-dusk-accent">image refused to load (rude)</p>;
  if (!src) return <p className="text-xs text-dusk-muted">decoding pixels…</p>;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block">
      <img
        src={src}
        alt={alt ?? "attachment"}
        className="max-h-72 max-w-full rounded-xl border border-white/[0.12] object-contain shadow-[0_16px_48px_-28px_rgba(0,0,0,0.85),inset_0_1px_0_rgba(255,255,255,0.06)]"
      />
    </a>
  );
}
