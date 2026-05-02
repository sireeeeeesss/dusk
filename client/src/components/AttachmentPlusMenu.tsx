import { useEffect, useRef, useState } from "react";

export function AttachmentPlusMenu({
  onMediaFile,
  onAudioFile,
}: {
  onMediaFile: (f: File) => void;
  onAudioFile: (f: File) => void;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-dusk-muted transition hover:bg-white/[0.1] hover:text-dusk-text"
        title="attach a file"
        aria-expanded={open}
      >
        +
      </button>
      {open ? (
        <div className="dusk-glass-popover absolute bottom-full left-0 z-20 mb-2 w-52 overflow-hidden py-1">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-dusk-text transition hover:bg-white/[0.06]"
            onClick={() => {
              setOpen(false);
              mediaRef.current?.click();
            }}
          >
            <span className="text-base opacity-80">🖼</span>
            <span>photo / video</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-dusk-text transition hover:bg-white/[0.06]"
            onClick={() => {
              setOpen(false);
              audioRef.current?.click();
            }}
          >
            <span className="text-base opacity-80">🎵</span>
            <span>audio file</span>
          </button>
        </div>
      ) : null}
      <input
        ref={mediaRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onMediaFile(f);
        }}
      />
      <input
        ref={audioRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.opus,.ogg,.oga"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onAudioFile(f);
        }}
      />
    </div>
  );
}
