import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { AuthShell } from "../components/AuthShell";
import { safePostAuthRedirect } from "../safeRedirect";

export function VerifyEmailPage(): React.ReactElement {
  const { user, applyAuthResponse } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const emailFromQuery = params.get("email") ?? "";
  const redirectAfter = safePostAuthRedirect(params.get("redirect"));
  const [email, setEmail] = useState(emailFromQuery);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentHint, setSentHint] = useState<string | null>(null);

  useEffect(() => {
    if (emailFromQuery) setEmail(emailFromQuery);
  }, [emailFromQuery]);

  useEffect(() => {
    if (user?.emailVerified) nav(redirectAfter, { replace: true });
  }, [user?.emailVerified, nav, user, redirectAfter]);

  const effectiveEmail = useMemo(() => (email.trim() || user?.email || "").toLowerCase(), [email, user?.email]);

  const resend = useCallback(async () => {
    if (!effectiveEmail) {
      setErr("need an email to resend");
      return;
    }
    setErr(null);
    setSentHint(null);
    setBusy(true);
    try {
      await api.requestEmailVerification(effectiveEmail);
      setSentHint("if that email exists and isn’t verified yet, we sent a fresh code ✌️");
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "resend failed");
    } finally {
      setBusy(false);
    }
  }, [effectiveEmail]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    if (!effectiveEmail || !code.trim()) {
      setErr("email + code pls");
      return;
    }
    setBusy(true);
    try {
      const r = await api.confirmEmailVerification(effectiveEmail, code.trim());
      applyAuthResponse(r.token, r.user);
      nav(redirectAfter, { replace: true });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "nope");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Verify Your Email"
      subtitle="Enter the 6-digit code sent to your inbox."
      footer={
        <span>
          Wrong account?{" "}
          <Link
            to={
              redirectAfter !== "/app"
                ? `/login?redirect=${encodeURIComponent(redirectAfter)}`
                : "/login"
            }
            className="text-dusk-glow hover:underline"
          >
            Back to sign in
          </Link>
        </span>
      }
    >
      <h3 className="mb-1 text-lg font-semibold text-dusk-text">Enter Code</h3>
      <p className="mb-5 text-sm text-dusk-muted">Codes expire in approximately 15 minutes.</p>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
        <label className="block text-sm text-dusk-muted">
          Email
          <input
            className="dusk-input mt-1 w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoComplete="email"
            required
            disabled={!!user?.email}
          />
        </label>
        <label className="block text-sm text-dusk-muted">
          6-Digit Code
          <input
            className="dusk-input mt-1 w-full font-mono text-lg tracking-[0.35em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            required
          />
        </label>
        {err && <p className="text-sm text-dusk-accent">{err}</p>}
        {sentHint && <p className="text-sm text-dusk-glow">{sentHint}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-gradient-to-r from-dusk-accent via-dusk-horizon to-dusk-glow py-2.5 font-medium text-white shadow-[0_12px_40px_-12px_rgba(232,93,76,0.55)] transition hover:brightness-110 disabled:opacity-50"
        >
          Verify and Continue
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resend()}
          className="w-full rounded-xl border border-white/[0.12] bg-white/[0.04] py-2.5 text-sm font-medium text-dusk-muted transition hover:border-dusk-twilight/40 hover:text-dusk-text disabled:opacity-50"
        >
          Resend Code
        </button>
      </form>
    </AuthShell>
  );
}
