import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../stores/auth";
import { PageHeader } from "../components/common/PageHeader";

export function SettingsPage() {
  const { user } = useAuth();
  const [session, setSession] = useState<{ user?: { email: string; role: string; id: string } } | null>(null);
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUrl, setTotpUrl] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api<{ user: { email: string; role: string; id: string } }>("/auth/session").then(setSession);
  }, []);

  async function setupTotp() {
    const r = await api<{ secret: string; otpauth_url: string }>("/auth/totp/setup", { method: "POST" });
    setTotpSecret(r.secret);
    setTotpUrl(r.otpauth_url);
    setMsg("Scan the OTP URL in your authenticator app, then verify with a code.");
  }

  async function verifyTotp(e: FormEvent) {
    e.preventDefault();
    const r = await api<{ ok: boolean }>("/auth/totp/verify", {
      method: "POST",
      body: JSON.stringify({ code: totpCode }),
    });
    setMsg(r.ok ? "TOTP verified." : "Invalid code.");
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Account and security" />

      <div className="card" style={{ maxWidth: 560, marginBottom: "1rem" }}>
        <h3>Account</h3>
        <table className="table">
          <tbody>
            <tr>
              <td className="muted">Email</td>
              <td>{session?.user?.email ?? user?.email ?? "—"}</td>
            </tr>
            <tr>
              <td className="muted">Role</td>
              <td>
                <span className="badge">{session?.user?.role ?? user?.role ?? "—"}</span>
              </td>
            </tr>
            <tr>
              <td className="muted">User ID</td>
              <td className="muted" style={{ fontSize: "0.8rem" }}>
                {session?.user?.id ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <h3>Two-factor (TOTP)</h3>
        <p className="muted">Optional authenticator app for additional sign-in security.</p>
        <div className="toolbar">
          <button type="button" className="secondary" onClick={setupTotp}>
            Generate TOTP secret
          </button>
        </div>
        {totpSecret && (
          <pre className="code" style={{ marginTop: "0.75rem" }}>
            Secret: {totpSecret}
            {"\n"}
            {totpUrl}
          </pre>
        )}
        <form onSubmit={verifyTotp} className="toolbar" style={{ marginTop: "0.75rem" }}>
          <input
            placeholder="6-digit code"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            maxLength={6}
            style={{ maxWidth: 140 }}
          />
          <button type="submit">Verify</button>
        </form>
        {msg && <p className="muted" style={{ marginTop: "0.5rem" }}>{msg}</p>}
      </div>
    </>
  );
}
