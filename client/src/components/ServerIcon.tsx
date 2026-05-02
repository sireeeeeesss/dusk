import { useEffect, useState } from "react";
import { fetchImageBlob } from "../api";

export function ServerIcon({
  serverId,
  name,
  iconUrl,
  size = 44,
  className = "",
}: {
  serverId: string;
  name: string;
  iconUrl: string | null;
  size?: number;
  className?: string;
}): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!iconUrl) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let blobUrl: string | null = null;
    fetchImageBlob(iconUrl)
      .then((u) => {
        if (!cancelled) {
          blobUrl = u;
          setSrc(u);
        }
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [iconUrl, serverId]);

  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`shrink-0 rounded-xl border border-dusk-border object-cover ${className}`}
        style={{ width: size, height: size }}
        title={name}
      />
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl border border-dusk-border bg-dusk-raised text-[11px] font-bold text-dusk-muted ${className}`}
      style={{ width: size, height: size }}
      title={name}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
