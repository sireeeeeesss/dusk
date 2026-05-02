import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { AuthShell } from "../components/AuthShell";

export function ResetPasswordPage(): React.ReactElement {
  const { applyAuthResponse } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = params.get("email");
    if (q) setEmail(q);
  }, [params]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const r = await api.confirmPasswordReset(email.trim().toLowerCase(), code.trim(), newPassword);
      applyAuthResponse(r.token, r.user);
      nav("/app", { replace: true });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "nope");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="Reset Password"
      subtitle="Enter your email, reset code, and a new password."
      footer={
        <span>
          Need a code?{" "}
          <Link to="/forgot-password" className="text-dusk-glow hover:underline">
            Request one
          </Link>
        </span>
      }
    >
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
        <label className="block text-sm text-dusk-muted">
          Reset Code
          <input
            className="dusk-input mt-1 w-full font-mono text-lg tracking-[0.25em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            required
          />
        </label>
        <label className="block text-sm text-dusk-muted">
          New Password
          <input
            className="dusk-input mt-1 w-full"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
          />
        </label>
        {err && <p className="text-sm text-dusk-accent">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-gradient-to-r from-dusk-accent via-dusk-horizon to-dusk-glow py-2.5 font-medium text-white shadow-[0_12px_40px_-12px_rgba(232,93,76,0.55)] transition hover:brightness-110 disabled:opacity-50"
        >
          Update Password and Sign In
        </button>
      </form>
    </AuthShell>
  );
}
