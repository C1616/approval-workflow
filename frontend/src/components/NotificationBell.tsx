import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Notification } from "../api/client";

const POLL_INTERVAL_MS = 15000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  async function load() {
    try {
      const res = await api.notifications(20);
      setNotifications(res.notifications);
      setUnreadCount(res.unreadCount);
    } catch {
      // silent - the bell just won't update this cycle
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleToggle() {
    setOpen((o) => !o);
    if (!open) {
      setLoading(true);
      await load();
      setLoading(false);
    }
  }

  async function handleNotificationClick(n: Notification) {
    if (!n.isRead) {
      try {
        await api.markNotificationRead(n.id);
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        // ignore
      }
    }
    setOpen(false);
    if (n.applicationId) navigate(`/applications/${n.applicationId}`);
  }

  async function handleMarkAllRead() {
    try {
      await api.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // ignore
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button onClick={handleToggle} style={bellButtonStyle} aria-label="Notifications">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unreadCount > 0 && <span style={badgeStyle}>{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div style={dropdownStyle}>
          <div style={dropdownHeadStyle}>
            <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0f172a" }}>Notifications</span>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} style={markAllBtnStyle}>
                Mark all read
              </button>
            )}
          </div>

          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {loading && <div style={emptyMsgStyle}>Loading...</div>}
            {!loading && notifications.length === 0 && <div style={emptyMsgStyle}>You're all caught up.</div>}
            {!loading &&
              notifications.map((n) => (
                <button key={n.id} onClick={() => handleNotificationClick(n)} style={notifItemStyle(n.isRead)}>
                  {!n.isRead && <span style={dotStyle} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.8125rem", color: "#1e293b", lineHeight: 1.4 }}>{n.message}</div>
                    <div style={{ fontSize: "0.7rem", color: "#94a3b8", marginTop: 3 }}>
                      {timeAgo(n.createdAt)}
                    </div>
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const bellButtonStyle: React.CSSProperties = {
  position: "relative",
  width: 38,
  height: 38,
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  background: "#fff",
  color: "#475569",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const badgeStyle: React.CSSProperties = {
  position: "absolute",
  top: -5,
  right: -5,
  minWidth: 18,
  height: 18,
  padding: "0 4px",
  borderRadius: 9,
  background: "#ef4444",
  color: "#fff",
  fontSize: "0.65rem",
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: 46,
  right: 0,
  width: 340,
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 12,
  boxShadow: "0 12px 32px rgba(15,23,42,0.12)",
  zIndex: 50,
  overflow: "hidden",
};

const dropdownHeadStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 16px",
  borderBottom: "1px solid #f1f5f9",
};

const markAllBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#2563eb",
  fontSize: "0.72rem",
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
};

const emptyMsgStyle: React.CSSProperties = {
  padding: "28px 16px",
  textAlign: "center",
  color: "#94a3b8",
  fontSize: "0.8rem",
};

const dotStyle: React.CSSProperties = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "#2563eb",
  flexShrink: 0,
  marginTop: 5,
};

function notifItemStyle(isRead: boolean): React.CSSProperties {
  return {
    display: "flex",
    gap: 9,
    width: "100%",
    textAlign: "left",
    padding: "12px 16px",
    border: "none",
    borderBottom: "1px solid #f8fafc",
    background: isRead ? "#fff" : "#f0f6ff",
    cursor: "pointer",
  };
}
