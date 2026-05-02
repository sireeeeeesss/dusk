import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AuthShell } from "../components/AuthShell";
import { safePostAuthRedirect } from "../safeRedirect";

export function LoginPage(): React.ReactElement {
  const { login } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const postAuth = safePostAuthRedirect(searchParams.get("redirect"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      await login(email, password);
      nav(postAuth);
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : "nope";
      if (msg === "email_not_verified") {
        const r =
          postAuth !== "/app" ? `&redirect=${encodeURIComponent(postAuth)}` : "";
        nav(`/verify-email?email=${encodeURIComponent(email.trim())}${r}`);
        return;
      }
      setErr(msg);
    }
  }

  return (
    <AuthShell
      title="Welcome Back"
      subtitle="Sign in to continue to your workspace."
      footer={
        <span>
          New here?{" "}
          <Link
            to={postAuth !== "/app" ? `/register?redirect=${encodeURIComponent(postAuth)}` : "/register"}
            className="text-dusk-glow hover:underline"
          >
            Create an account
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
          Password
          <input
            className="dusk-input mt-1 w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <div className="flex justify-end text-xs">
          <Link to="/forgot-password" className="text-dusk-twilight hover:text-dusk-glow hover:underline">
            Forgot password?
          </Link>
        </div>
        {err && <p className="text-sm text-dusk-accent">{err}</p>}
        <button
          type="submit"
          className="w-full rounded-xl bg-gradient-to-r from-dusk-accent via-dusk-horizon to-dusk-glow py-2.5 font-medium text-white shadow-[0_12px_40px_-12px_rgba(232,93,76,0.55)] transition hover:brightness-110"
        >
          Sign In
        </button>
      </form>
    </AuthShell>
  );
}
