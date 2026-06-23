import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, Application, ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { StatusBadge } from "../components/StatusBadge";

export function ApplicationDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();

  const [app, setApp] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [comment, setComment] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const res = await api.getApplication(id);
      setApp(res.application);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) return <div style={{ padding: 32 }}>Loading...</div>;
  if (error) return <div style={{ padding: 32, color: "#b91c1c" }}>{error}</div>;
  if (!app) return null;

  const isOwner = app.applicantId === user?.id;
  const isReviewer = user?.role === "REVIEWER";

  async function runAction(fn: () => Promise<{ application: Application }>) {
    setActing(true);
    setCommentError(null);
    try {
      const res = await fn();
      setApp(res.application);
      setComment("");
    } catch (err) {
      if (err instanceof ApiError) setCommentError(err.message);
    } finally {
      setActing(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
      <Link to={isReviewer ? "/queue" : "/"} style={{ fontSize: "0.8rem", color: "#64748b", textDecoration: "none" }}>
        ← Back
      </Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", margin: "12px 0 20px" }}>
        <div>
          <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>{app.title}</h1>
          <p style={{ fontSize: "0.8rem", color: "#94a3b8", marginTop: 4 }}>
            {app.category} · by {app.applicant?.name || "you"}
          </p>
        </div>
        <StatusBadge status={app.status} />
      </div>

      <div style={cardStyle}>
        <h2 style={cardHeadStyle}>Details</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Field label="Amount" value={app.amount ? `${app.amount}` : "—"} />
          <Field label="Due date" value={app.dueDate ? new Date(app.dueDate).toLocaleDateString() : "—"} />
        </div>
        <Field label="Description" value={app.description || "—"} full />
        {app.attachmentName && (
          <Field
            label="Attachment"
            value={
              <a href={`/uploads/${app.attachmentPath}`} target="_blank" rel="noreferrer">
                {app.attachmentName}
              </a>
            }
            full
          />
        )}
      </div>

      {isOwner && app.status === "DRAFT" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <Link to={`/applications/${app.id}/edit`} style={secondaryBtnStyle}>
            Edit
          </Link>
          <button onClick={() => runAction(() => api.submit(app.id))} disabled={acting} style={primaryBtnStyle}>
            {acting ? "Submitting..." : "Submit for Review"}
          </button>
        </div>
      )}

      {isReviewer && app.status === "SUBMITTED" && (
        <div style={cardStyle}>
          <h2 style={cardHeadStyle}>Reviewer Actions</h2>
          <button onClick={() => runAction(() => api.startReview(app.id))} disabled={acting} style={primaryBtnStyle}>
            {acting ? "Starting..." : "Start Review"}
          </button>
        </div>
      )}

      {isReviewer && app.status === "UNDER_REVIEW" && (
        <div style={cardStyle}>
          <h2 style={cardHeadStyle}>Reviewer Actions</h2>
          <label style={labelStyle}>Comment (required for reject / return for changes)</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            style={{ ...inputStyle, minHeight: 80, marginBottom: 10 }}
            placeholder="Add your notes..."
          />
          {commentError && (
            <div style={{ marginBottom: 10, padding: "8px 12px", background: "#fee2e2", color: "#b91c1c", borderRadius: 8, fontSize: "0.8rem" }}>
              {commentError}
            </div>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => runAction(() => api.approve(app.id))} disabled={acting} style={approveBtnStyle}>
              Approve
            </button>
            <button onClick={() => runAction(() => api.reject(app.id, comment))} disabled={acting} style={rejectBtnStyle}>
              Reject
            </button>
            <button onClick={() => runAction(() => api.returnForChanges(app.id, comment))} disabled={acting} style={secondaryBtnStyle}>
              Return for Changes
            </button>
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <h2 style={cardHeadStyle}>Audit Trail</h2>
        {!app.auditLogs || app.auditLogs.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "#94a3b8" }}>No transitions yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {app.auditLogs.map((log) => (
              <div key={log.id} style={{ paddingBottom: 12, borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#0f172a" }}>
                  {log.fromStatus} → {log.toStatus}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#94a3b8", marginTop: 2 }}>
                  {log.actor.name} ({log.actor.role}) · {new Date(log.createdAt).toLocaleString()}
                </div>
                {log.comment && (
                  <div style={{ fontSize: "0.8rem", color: "#475569", marginTop: 6, fontStyle: "italic" }}>
                    "{log.comment}"
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined, marginBottom: 10 }}>
      <div style={{ fontSize: "0.65rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </div>
      <div style={{ fontSize: "0.875rem", color: "#0f172a", marginTop: 2 }}>{value}</div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
};

const cardHeadStyle: React.CSSProperties = {
  fontSize: "0.9rem",
  fontWeight: 700,
  color: "#0f172a",
  margin: "0 0 14px",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.72rem",
  fontWeight: 700,
  color: "#475569",
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontSize: "0.875rem",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: "0.85rem",
  cursor: "pointer",
  textDecoration: "none",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  background: "#fff",
  color: "#475569",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: "0.85rem",
  cursor: "pointer",
  textDecoration: "none",
};

const approveBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  background: "#10b981",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: "0.85rem",
  cursor: "pointer",
};

const rejectBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  background: "#ef4444",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: "0.85rem",
  cursor: "pointer",
};
