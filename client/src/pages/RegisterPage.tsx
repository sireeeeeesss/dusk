import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthShell } from "../components/AuthShell";
import { safePostAuthRedirect } from "../safeRedirect";

export function RegisterPage(): React.ReactElement {
  const { register } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const postAuth = safePostAuthRedirect(searchParams.get("redirect"));
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      await register({
        email,
        username,
        password,
        displayName: displayName || undefined,
      });
      nav(postAuth);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "nope");
    }
  }

  return (
    <AuthShell
      title="Create Your Account"
      subtitle="Set up your profile and jump in."
      footer={
        <span>
          Already have an account?{" "}
          <Link
            to={postAuth !== "/app" ? `/login?redirect=${encodeURIComponent(postAuth)}` : "/login"}
            className="text-dusk-accent hover:underline"
          >
            Sign in
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
            required
          />
        </label>
        <label className="block text-sm text-dusk-muted">
          Username
          <input
            className="dusk-input mt-1 w-full font-mono text-sm"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm text-dusk-muted">
          Display Name <span className="opacity-60">(optional)</span>
          <input className="dusk-input mt-1 w-full" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="block text-sm text-dusk-muted">
          Password
          <input
            className="dusk-input mt-1 w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </label>
        {err && <p className="text-sm text-dusk-accent">{err}</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-gradient-to-r from-dusk-glow to-amber-300 py-2.5 font-semibold text-dusk-void shadow-[0_12px_40px_-10px_rgba(244,162,97,0.45)] transition hover:brightness-110"
        >
          Create Account
        </button>
        <p className="text-center text-xs text-dusk-muted">
          We will email you a 6-digit verification code.
        </p>
      </form>
    </AuthShell>
  );
}
