import { useEffect, useState } from "react";
import { fetchImageBlob } from "../api";
import type { User } from "../types";

export function ProfileBanner({ user, className = "" }: { user: Pick<User, "bannerUrl">; className?: string }): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!user.bannerUrl) {
      setSrc(null);
      return;
    }
    let cancelled = false;
    let blobUrl: string | null = null;
    fetchImageBlob(user.bannerUrl)
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
  }, [user.bannerUrl]);

  return (
    <div
      className={`relative h-28 w-full overflow-hidden bg-dusk-raised ${className}`}
      style={
        src
          ? undefined
          : {
              backgroundImage: "linear-gradient(120deg, #2a1f38 0%, #1a1a22 45%, #2a2030 100%)",
            }
      }
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : null}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-dusk-surface via-transparent to-transparent opacity-90" />
    </div>
  );
}
