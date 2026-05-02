export function DuskMark({
  unread,
  className = "",
  size = 48,
}: {
  unread?: boolean;
  className?: string;
  size?: number;
}): React.ReactElement {
  const src = unread ? "/dusk-mark-unread.svg" : "/dusk-mark.svg";
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      className={`shrink-0 rounded-2xl shadow-[0_12px_40px_-12px_rgba(232,93,76,0.45)] ${className}`}
      draggable={false}
    />
  );
}
