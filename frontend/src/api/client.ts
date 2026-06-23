export type Role = "APPLICANT" | "REVIEWER";

export type ApplicationStatus = "DRAFT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";

export type Category = "EXPENSE" | "LEAVE" | "EQUIPMENT" | "TRAVEL" | "OTHER";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AuditLogEntry {
  id: string;
  fromStatus: ApplicationStatus;
  toStatus: ApplicationStatus;
  comment: string | null;
  createdAt: string;
  actor: { name: string; role: Role };
}

export interface Application {
  id: string;
  title: string;
  category: Category;
  description: string | null;
  amount: string | null;
  dueDate: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  status: ApplicationStatus;
  applicantId: string;
  applicant?: { id: string; name: string; email: string };
  createdAt: string;
  updatedAt: string;
  auditLogs?: AuditLogEntry[];
}

export interface Notification {
  id: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  applicationId: string | null;
  application?: { id: string; title: string } | null;
}

export interface QueueResponse {
  applications: Application[];
  total: number;
  page: number;
  pageSize: number;
}

const API_BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("token");
}

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed with status ${res.status}`, res.status, body?.details);
  }
  return body as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: AuthUser; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () => request<{ user: AuthUser }>("/auth/me"),

  myApplications: () => request<{ applications: Application[] }>("/applications/mine"),

  queue: (params: { status?: string; search?: string; page?: number; pageSize?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.search) q.set("search", params.search);
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    const qs = q.toString();
    return request<QueueResponse>(`/applications/queue${qs ? `?${qs}` : ""}`);
  },

  getApplication: (id: string) => request<{ application: Application }>(`/applications/${id}`),

  createApplication: (data: {
    title: string;
    category: Category;
    description?: string;
    amount?: number | "";
    dueDate?: string;
  }) =>
    request<{ application: Application }>("/applications", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateApplication: (id: string, data: Partial<{ title: string; category: Category; description: string; amount: number | ""; dueDate: string }>) =>
    request<{ application: Application }>(`/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  submit: (id: string) => request<{ application: Application }>(`/applications/${id}/submit`, { method: "POST" }),

  startReview: (id: string) =>
    request<{ application: Application }>(`/applications/${id}/start-review`, { method: "POST" }),

  approve: (id: string) => request<{ application: Application }>(`/applications/${id}/approve`, { method: "POST" }),

  reject: (id: string, comment: string) =>
    request<{ application: Application }>(`/applications/${id}/reject`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),

  returnForChanges: (id: string, comment: string) =>
    request<{ application: Application }>(`/applications/${id}/return`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),

  uploadAttachment: async (id: string, file: File) => {
    const token = getToken();
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/applications/${id}/attachment`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
      credentials: "include",
    });
    const body = await res.json();
    if (!res.ok) throw new ApiError(body?.error || "Upload failed", res.status);
    return body as { application: Application };
  },

  notifications: (limit?: number) =>
    request<{ notifications: Notification[]; unreadCount: number }>(
      `/notifications${limit ? `?limit=${limit}` : ""}`
    ),

  unreadNotificationCount: () => request<{ unreadCount: number }>("/notifications/unread-count"),

  markNotificationRead: (id: string) =>
    request<{ notification: Notification }>(`/notifications/${id}/read`, { method: "POST" }),

  markAllNotificationsRead: () => request<{ ok: true }>("/notifications/read-all", { method: "POST" }),
};
