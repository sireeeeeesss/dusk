import { Link } from "react-router-dom";

const HANDLE = /@([a-zA-Z0-9_]{1,32})\b/g;
const LINK = /(https?:\/\/[^\s<>"']+)|(\/invite\/[a-zA-Z0-9]{4,32})/gi;

function mentionNodesWithUsers(text: string, keyPrefix: string, usernameSet: Set<string>): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  HANDLE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = HANDLE.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(
        <span key={`${keyPrefix}t-${k++}`}>{text.slice(last, m.index)}</span>,
      );
    }
    const raw = m[1]!;
    const low = raw.toLowerCase();
    const highlight = low === "everyone" || low === "here" || usernameSet.has(low);
    nodes.push(
      <span key={`${keyPrefix}m-${k++}`} className={highlight ? "font-semibold text-dusk-glow" : undefined}>
        @{raw}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(<span key={`${keyPrefix}e-${k++}`}>{text.slice(last)}</span>);
  }
  return nodes;
}

export function MessageRichText({
  content,
  usernameSet,
}: {
  content: string;
  usernameSet: Set<string>;
}): React.ReactElement {
  const out: React.ReactNode[] = [];
  let last = 0;
  let linkKey = 0;
  LINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK.exec(content)) !== null) {
    if (m.index > last) {
      out.push(
        ...mentionNodesWithUsers(content.slice(last, m.index), `p${m.index}-`, usernameSet),
      );
    }
    if (m[1]) {
      const href = m[1];
      out.push(
        <a
          key={`lnk-${linkKey++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-dusk-twilight underline decoration-dusk-twilight/50 underline-offset-2 hover:text-dusk-glow hover:decoration-dusk-glow/70"
        >
          {href}
        </a>,
      );
    } else if (m[2]) {
      const to = m[2];
      out.push(
        <Link
          key={`lnk-${linkKey++}`}
          to={to}
          className="break-all font-medium text-dusk-twilight underline decoration-dusk-twilight/50 underline-offset-2 hover:text-dusk-glow hover:decoration-dusk-glow/70"
        >
          {to}
        </Link>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    out.push(...mentionNodesWithUsers(content.slice(last), `p${last}-end-`, usernameSet));
  }
  return <span className="whitespace-pre-wrap break-words">{out}</span>;
}
