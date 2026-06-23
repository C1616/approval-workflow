import { ApplicationStatus } from "../api/client";

const STYLES: Record<ApplicationStatus, { bg: string; fg: string; label: string }> = {
  DRAFT: { bg: "#f1f5f9", fg: "#475569", label: "Draft" },
  SUBMITTED: { bg: "#fef3c7", fg: "#a16207", label: "Submitted" },
  UNDER_REVIEW: { bg: "#dbeafe", fg: "#1d4ed8", label: "Under Review" },
  APPROVED: { bg: "#dcfce7", fg: "#15803d", label: "Approved" },
  REJECTED: { bg: "#fee2e2", fg: "#b91c1c", label: "Rejected" },
};

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  const s = STYLES[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 20,
        fontSize: "0.7rem",
        fontWeight: 700,
        background: s.bg,
        color: s.fg,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}
