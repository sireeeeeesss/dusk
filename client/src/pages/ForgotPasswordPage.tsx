import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { AuthShell } from "../components/AuthShell";

export function ForgotPasswordPage(): React.ReactElement {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.requestPasswordReset(email.trim());
      setDone(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "nope");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Forgot Password"
      subtitle="Enter your email and we will send a reset code."
      footer={
        <span>
          Remembered it?{" "}
          <Link to="/login" className="text-dusk-glow hover:underline">
            Sign in
          </Link>{" "}
          ·{" "}
          <Link to="/reset-password" className="text-dusk-accent hover:underline">
            Already have a code
          </Link>
        </span>
      }
    >
      {done ? (
        <div className="rounded-xl border border-dusk-glow/25 bg-dusk-glow/10 px-4 py-3 text-sm text-dusk-text">
          If an account exists for that email, a reset code has been sent.
        </div>
      ) : (
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
            />
          </label>
          {err && <p className="text-sm text-dusk-accent">{err}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-r from-dusk-glow to-amber-300 py-2.5 font-semibold text-dusk-void shadow-[0_12px_40px_-10px_rgba(244,162,97,0.45)] transition hover:brightness-110 disabled:opacity-50"
          >
            Send Reset Code
          </button>
        </form>
      )}
    </AuthShell>
  );
}
