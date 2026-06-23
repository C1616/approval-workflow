import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";
import { NotificationBell } from "./NotificationBell";

export function NavBar() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header style={headerStyle}>
      <Link to="/" style={brandStyle}>
        <div style={brandLogoStyle}>AW</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a", lineHeight: 1.2 }}>
            Approval Workflow
          </div>
          <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>Submission &amp; Review</div>
        </div>
      </Link>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <NotificationBell />

        <div style={{ width: 1, height: 26, background: "#e2e8f0" }} />

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#0f172a" }}>{user.name}</div>
          <div style={{ fontSize: "0.68rem", color: "#94a3b8" }}>{user.role}</div>
        </div>
        <div style={avatarStyle}>{user.name.charAt(0).toUpperCase()}</div>

        <button onClick={logout} style={signOutBtnStyle}>
          Sign out
        </button>
      </div>
    </header>
  );
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 28px",
  borderBottom: "1px solid #e2e8f0",
  background: "#fff",
  position: "sticky",
  top: 0,
  zIndex: 40,
};

const brandStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  textDecoration: "none",
};

const brandLogoStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 9,
  background: "#2563eb",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontSize: "0.78rem",
  flexShrink: 0,
};

const avatarStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: "50%",
  background: "#eff6ff",
  color: "#2563eb",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 700,
  fontSize: "0.8rem",
  flexShrink: 0,
};

const signOutBtnStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontSize: "0.78rem",
  fontWeight: 600,
  color: "#475569",
  cursor: "pointer",
};
