import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth";

export function LoginPage() {
  const [email, setEmail] = useState("admin@localhost");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { login, loading, user, bootstrapped, restoreSession } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!bootstrapped) void restoreSession();
  }, [bootstrapped, restoreSession]);

  useEffect(() => {
    if (bootstrapped && user) navigate("/", { replace: true });
  }, [bootstrapped, user, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }

  return (
    <div className="login-box">
      <h1>AI Agents Controller</h1>
      <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p style={{ color: "var(--bad)" }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
