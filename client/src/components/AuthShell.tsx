import { Link } from "react-router-dom";
import { DuskMark } from "./DuskMark";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="relative flex min-h-full items-center justify-center px-4 py-6 lg:px-8 lg:py-10">
      <div className="relative flex w-full max-w-[1260px] flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[rgba(10,8,16,0.42)] shadow-[0_36px_120px_-50px_rgba(0,0,0,0.85)] backdrop-blur-sm lg:min-h-[720px] lg:flex-row">
      <div className="relative flex flex-1 flex-col justify-between overflow-hidden px-8 py-10 lg:max-w-[48%] lg:py-14 lg:pl-12 lg:pr-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_20%_0%,rgba(155,127,214,0.35),transparent)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_50%_at_100%_80%,rgba(232,93,76,0.18),transparent)]" />
        <div className="relative z-[1]">
          <Link to="/login" className="inline-flex items-center gap-3 transition hover:opacity-90">
            <DuskMark size={52} />
            <div>
              <div className="dusk-wordmark text-xl tracking-tight">Dusk</div>
              <div className="text-xs font-medium uppercase tracking-[0.2em] text-dusk-muted">Chat At The Edge Of Night</div>
            </div>
          </Link>
          <h2 className="mt-10 max-w-md text-3xl font-semibold leading-tight tracking-tight text-dusk-text lg:text-4xl">
            {title}
          </h2>
          {subtitle ? <p className="mt-4 max-w-md text-sm leading-relaxed text-dusk-muted lg:text-base">{subtitle}</p> : null}
        </div>
        <p className="relative z-[1] mt-10 hidden text-xs text-dusk-muted/80 lg:block">
          Real-time conversations with a calm, focused interface.
        </p>
      </div>

      <div className="relative z-[1] flex flex-1 items-center justify-center px-4 pb-10 pt-2 lg:px-10 lg:py-12">
        <div className="dusk-glass-modal relative w-full max-w-md border border-white/[0.1] p-7 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.75)] sm:p-9">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <DuskMark size={40} />
            <div className="dusk-wordmark text-lg">Dusk</div>
          </div>
          {children}
          {footer ? <div className="mt-6 border-t border-white/[0.06] pt-5 text-center text-sm text-dusk-muted">{footer}</div> : null}
        </div>
      </div>
      </div>
    </div>
  );
}
