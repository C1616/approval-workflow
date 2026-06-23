import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Application } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

export function MyApplicationsPage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myApplications()
      .then((res) => setApps(res.applications))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const draftCount = apps.filter((a) => a.status === "DRAFT").length;
  const pendingCount = apps.filter((a) => a.status === "SUBMITTED" || a.status === "UNDER_REVIEW").length;
  const approvedCount = apps.filter((a) => a.status === "APPROVED").length;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0, color: "#0f172a", letterSpacing: "-0.01em" }}>
            My Applications
          </h1>
          <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "4px 0 0" }}>{apps.length} total</p>
        </div>
        <Link to="/applications/new" style={primaryBtnStyle}>
          + New Application
        </Link>
      </div>

      {!loading && apps.length > 0 && (
        <div style={kpiRowStyle}>
          <KpiCard accent="#64748b" label="Drafts" value={draftCount} />
          <KpiCard accent="#f59e0b" label="In Progress" value={pendingCount} />
          <KpiCard accent="#10b981" label="Approved" value={approvedCount} />
        </div>
      )}

      {loading && <div style={emptyStyle}>Loading...</div>}
      {error && <div style={{ ...emptyStyle, color: "#b91c1c" }}>{error}</div>}

      {!loading && !error && apps.length === 0 && (
        <div style={emptyStyle}>You haven't created any applications yet.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {apps.map((app) => (
          <Link key={app.id} to={`/applications/${app.id}`} style={rowCardStyle}>
            <div>
              <div style={{ fontWeight: 600, fontSize: "0.92rem", color: "#0f172a" }}>{app.title}</div>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: 3 }}>
                {app.category} &middot; Updated {new Date(app.updatedAt).toLocaleDateString()}
              </div>
            </div>
            <StatusBadge status={app.status} />
          </Link>
        ))}
      </div>
    </div>
  );
}

function KpiCard({ accent, label, value }: { accent: string; label: string; value: number }) {
  return (
    <div style={{ ...kpiCardStyle, borderLeft: `4px solid ${accent}` }}>
      <div style={{ fontSize: "1.6rem", fontWeight: 700, color: "#0f172a", letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: "0.7rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

const kpiRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 14,
  marginBottom: 22,
};

const kpiCardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: "16px 18px",
};

const rowCardStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "16px 18px",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  textDecoration: "none",
  color: "inherit",
};

const emptyStyle: React.CSSProperties = {
  padding: "3rem 1rem",
  textAlign: "center",
  color: "#94a3b8",
  background: "#fff",
  border: "1px dashed #e2e8f0",
  borderRadius: 12,
  fontSize: "0.875rem",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: "0.85rem",
  textDecoration: "none",
};
