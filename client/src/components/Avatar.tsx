import { useEffect, useState } from "react";
import { fetchImageBlob } from "../api";
import type { Presence, User } from "../types";

export function Avatar({
  user,
  size = 36,
  className = "",
  presence,
}: {
  user: Pick<User, "displayName" | "avatarHue" | "accentHue" | "avatarUrl">;
  size?: number;
  className?: string;
  /** when set, shows online/offline dot (friends / dms vibe check) */
  presence?: Presence | null;
}): React.ReactElement {
  const [img, setImg] = useState<string | null>(null);
  const initial = user.displayName.slice(0, 1).toUpperCase();
  const accent = typeof user.accentHue === "number" ? user.accentHue : user.avatarHue;

  useEffect(() => {
    if (!user.avatarUrl) {
      setImg(null);
      return;
    }
    let cancelled = false;
    let blobUrl: string | null = null;
    fetchImageBlob(user.avatarUrl)
      .then((u) => {
        if (!cancelled) {
          blobUrl = u;
          setImg(u);
        }
      })
      .catch(() => {
        if (!cancelled) setImg(null);
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [user.avatarUrl]);

  const dotSize = Math.max(8, Math.round(size * 0.28));
  const dot =
    presence != null ? (
      <span
        className={`pointer-events-none absolute bottom-0 right-0 rounded-full border-2 border-[#0a0912] shadow-sm ${
          presence.isOnline ? "bg-emerald-400" : "bg-dusk-muted/80"
        }`}
        style={{ width: dotSize, height: dotSize }}
        title={presence.isOnline ? "online" : "offline"}
      />
    ) : null;

  if (img) {
    return (
      <span className={`relative inline-flex shrink-0 ${className}`}>
        <img
          src={img}
          alt=""
          className="shrink-0 rounded-md border object-cover shadow-inner"
          style={{
            width: size,
            height: size,
            borderColor: `hsla(${accent}, 65%, 48%, 0.55)`,
          }}
          title={user.displayName}
        />
        {dot}
      </span>
    );
  }

  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <div
        className="flex shrink-0 items-center justify-center rounded-md font-medium text-dusk-text shadow-inner"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.42,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: `hsla(${accent}, 65%, 48%, 0.55)`,
          boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.35), 0 0 0 1px hsla(${accent}, 70%, 55%, 0.12)`,
          background: `linear-gradient(145deg, hsl(${user.avatarHue}, 55%, 32%) 0%, hsl(${user.avatarHue}, 40%, 18%) 100%)`,
        }}
        title={user.displayName}
      >
        {initial}
      </div>
      {dot}
    </span>
  );
}
