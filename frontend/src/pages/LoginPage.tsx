import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  function fillDemo(role: "applicant" | "reviewer") {
    setEmail(role === "applicant" ? "applicant@example.com" : "reviewer@example.com");
    setPassword("password123");
  }

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
      }}
    >
      <div style={{ width: 380, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 32 }}>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: 4 }}>Sign in</h1>
        <p style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: 24 }}>
          Submission &amp; Approval Workflow
        </p>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inputStyle}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div style={{ padding: "8px 12px", background: "#fee2e2", color: "#b91c1c", borderRadius: 8, fontSize: "0.8rem" }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={primaryBtnStyle}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid #f1f5f9" }}>
          <p style={{ fontSize: "0.72rem", color: "#94a3b8", marginBottom: 8 }}>Demo credentials (password: password123)</p>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => fillDemo("applicant")} style={demoBtnStyle}>
              Use Applicant
            </button>
            <button type="button" onClick={() => fillDemo("reviewer")} style={demoBtnStyle}>
              Use Reviewer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.72rem",
  fontWeight: 700,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  marginBottom: 5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontSize: "0.9rem",
  boxSizing: "border-box",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: "0.9rem",
  cursor: "pointer",
};

const demoBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "7px 10px",
  background: "#f8fafc",
  border: "1px solid #e2e8f0",
  borderRadius: 7,
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "#475569",
  cursor: "pointer",
};
