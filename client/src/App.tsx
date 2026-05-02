import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { VerifyEmailPage } from "./pages/VerifyEmailPage";
import { InvitePage } from "./pages/InvitePage";
import { WorkspacePage } from "./pages/WorkspacePage";

function Protected({ children }: { children: React.ReactNode }): React.ReactElement | null {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-dusk-muted">
        <span className="dusk-glass-composer animate-pulse rounded-full px-5 py-2.5 text-sm">loading…</span>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.emailVerified === false) {
    const q = user.email ? `?email=${encodeURIComponent(user.email)}` : "";
    return <Navigate to={`/verify-email${q}`} replace />;
  }
  return <>{children}</>;
}

export function App(): React.ReactElement {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/app" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/invite/:code" element={<InvitePage />} />
        <Route
          path="/app/*"
          element={
            <Protected>
              <WorkspacePage />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </AuthProvider>
  );
}
