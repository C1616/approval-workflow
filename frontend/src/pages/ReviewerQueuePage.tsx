import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Application } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

const FILTERS = ["ALL", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;
const PAGE_SIZE = 8;

export function ReviewerQueuePage() {
  const [apps, setApps] = useState<Application[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<string>("SUBMITTED");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setLoading(true);
    api
      .queue({ status: filter, search: search || undefined, page, pageSize: PAGE_SIZE })
      .then((res) => {
        setApps(res.applications);
        setTotal(res.total);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter, search, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const submittedCount = apps.filter((a) => a.status === "SUBMITTED").length;
  const underReviewCount = apps.filter((a) => a.status === "UNDER_REVIEW").length;

  function handleFilterChange(f: string) {
    setFilter(f);
    setPage(1);
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0, color: "#0f172a", letterSpacing: "-0.01em" }}>
          Review Queue
        </h1>
        <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "4px 0 0" }}>
          {total} total matching application{total === 1 ? "" : "s"}
        </p>
      </div>

      <div style={kpiRowStyle}>
        <KpiCard accent="#f59e0b" label="Submitted (this page)" value={submittedCount} />
        <KpiCard accent="#2563eb" label="Under Review (this page)" value={underReviewCount} />
        <KpiCard accent="#64748b" label="Total in this filter" value={total} />
      </div>

      <div style={controlsRowStyle}>
        <div style={searchWrapStyle}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" strokeLinecap="round" />
          </svg>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by title or applicant..."
            style={searchInputStyle}
          />
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button key={f} onClick={() => handleFilterChange(f)} style={pillStyle(filter === f)}>
              {f.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={emptyStyle}>Loading...</div>}
      {error && <div style={{ ...emptyStyle, color: "#b91c1c" }}>{error}</div>}
      {!loading && !error && apps.length === 0 && <div style={emptyStyle}>No applications match your filters.</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        {apps.map((app) => (
          <Link key={app.id} to={`/applications/${app.id}`} style={rowCardStyle}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: "0.92rem", color: "#0f172a" }}>{app.title}</div>
              <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: 3 }}>
                {app.category} &middot; {app.applicant?.name} &middot; {new Date(app.updatedAt).toLocaleDateString()}
              </div>
            </div>
            <StatusBadge status={app.status} />
          </Link>
        ))}
      </div>

      {!loading && totalPages > 1 && (
        <div style={paginationRowStyle}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} style={pagerBtnStyle(page === 1)}>
            ← Prev
          </button>
          <span style={{ fontSize: "0.8rem", color: "#64748b" }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={pagerBtnStyle(page === totalPages)}
          >
            Next →
          </button>
        </div>
      )}
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

const controlsRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  marginBottom: 18,
  flexWrap: "wrap",
};

const searchWrapStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 9,
  padding: "9px 14px",
  flex: "1 1 260px",
  maxWidth: 360,
};

const searchInputStyle: React.CSSProperties = {
  border: "none",
  outline: "none",
  fontSize: "0.83rem",
  width: "100%",
  background: "transparent",
};

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "7px 14px",
    borderRadius: 20,
    border: active ? "1px solid #2563eb" : "1px solid #e2e8f0",
    background: active ? "#2563eb" : "#fff",
    color: active ? "#fff" : "#64748b",
    fontSize: "0.74rem",
    fontWeight: 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}

const rowCardStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  padding: "16px 18px",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  textDecoration: "none",
  color: "inherit",
};

const paginationRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 16,
  padding: "12px 0",
};

function pagerBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    background: "#fff",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    fontSize: "0.78rem",
    fontWeight: 600,
    color: disabled ? "#cbd5e1" : "#475569",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const emptyStyle: React.CSSProperties = {
  padding: "3rem 1rem",
  textAlign: "center",
  color: "#94a3b8",
  background: "#fff",
  border: "1px dashed #e2e8f0",
  borderRadius: 12,
  fontSize: "0.875rem",
  marginBottom: 18,
};
