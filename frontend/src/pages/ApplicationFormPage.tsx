import { useEffect, useState, FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, Application, Category, ApiError } from "../api/client";

const CATEGORIES: Category[] = ["EXPENSE", "LEAVE", "EQUIPMENT", "TRAVEL", "OTHER"];

export function ApplicationFormPage({ mode }: { mode: "create" | "edit" }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("EXPENSE");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [existing, setExisting] = useState<Application | null>(null);
  const [loading, setLoading] = useState(mode === "edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (mode === "edit" && id) {
      api
        .getApplication(id)
        .then((res) => {
          const app = res.application;
          setExisting(app);
          setTitle(app.title);
          setCategory(app.category);
          setDescription(app.description || "");
          setAmount(app.amount || "");
          setDueDate(app.dueDate ? app.dueDate.slice(0, 10) : "");
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [mode, id]);

  async function handleSave(e: FormEvent, andSubmit: boolean) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const payload = {
        title,
        category,
        description: description || undefined,
        amount: amount ? Number(amount) : ("" as const),
        dueDate: dueDate || undefined,
      };

      let app: Application;
      if (mode === "create") {
        const res = await api.createApplication(payload);
        app = res.application;
      } else {
        const res = await api.updateApplication(id!, payload);
        app = res.application;
      }

      if (file) {
        await api.uploadAttachment(app.id, file);
      }

      if (andSubmit) {
        await api.submit(app.id);
      }

      navigate(`/applications/${app.id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        if (err.details && typeof err.details === "object" && "fieldErrors" in (err.details as any)) {
          setFieldErrors((err.details as any).fieldErrors);
        }
      } else {
        setError("Something went wrong.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 32 }}>Loading...</div>;

  if (existing && existing.status !== "DRAFT") {
    return (
      <div style={{ maxWidth: 600, margin: "60px auto", padding: 24, textAlign: "center" }}>
        <p>This application is no longer editable (status: {existing.status}).</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "32px 24px" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: 20 }}>
        {mode === "create" ? "New Application" : "Edit Application"}
      </h1>

      <form style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={labelStyle}>Title *</label>
          <input style={inputStyle} value={title} onChange={(e) => setTitle(e.target.value)} required />
          {fieldErrors.title && <FieldError messages={fieldErrors.title} />}
        </div>

        <div>
          <label style={labelStyle}>Category *</label>
          <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Description</label>
          <textarea
            style={{ ...inputStyle, minHeight: 100, resize: "vertical" }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Amount</label>
            <input
              type="number"
              step="0.01"
              style={inputStyle}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Due date</label>
            <input type="date" style={inputStyle} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label style={labelStyle}>Attachment (optional)</label>
          {existing?.attachmentName && !file && (
            <p style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: 6 }}>
              Current: {existing.attachmentName}
            </p>
          )}
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>

        {error && (
          <div style={{ padding: "10px 14px", background: "#fee2e2", color: "#b91c1c", borderRadius: 8, fontSize: "0.85rem" }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button type="button" disabled={saving} onClick={(e) => handleSave(e, false)} style={secondaryBtnStyle}>
            {saving ? "Saving..." : "Save Draft"}
          </button>
          <button type="button" disabled={saving} onClick={(e) => handleSave(e, true)} style={primaryBtnStyle}>
            {saving ? "Submitting..." : "Save & Submit"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldError({ messages }: { messages: string[] }) {
  return <p style={{ fontSize: "0.75rem", color: "#b91c1c", marginTop: 4 }}>{messages.join(", ")}</p>;
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
  fontFamily: "inherit",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: "0.85rem",
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "10px 18px",
  background: "#fff",
  color: "#475569",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  fontWeight: 600,
  fontSize: "0.85rem",
  cursor: "pointer",
};
