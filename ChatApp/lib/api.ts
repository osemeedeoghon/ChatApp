import { API_URL } from "./config";
import type {
  AuthResponse, Conversation, LocalFile, Message, MessagePage, User,
} from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export const session = {
  getToken: () => token,
  setToken: (value: string | null) => {
    token = value;
  },
  /** Called when the server rejects the current session (expired or revoked). */
  setUnauthorizedHandler: (handler: (() => void) | null) => {
    onUnauthorized = handler;
  },
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  form?: FormData;
  authenticated?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, form, authenticated = true } = options;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authenticated && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), form ? 60_000 : 15_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timeout);
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && authenticated && token) onUnauthorized?.();
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : "Something went wrong. Please try again.";

export const api = {
  register: (email: string, password: string, displayName: string) =>
    request<AuthResponse>("/register", {
      method: "POST",
      body: { email, password, displayName },
      authenticated: false,
    }),
  login: (email: string, password: string) =>
    request<AuthResponse>("/login", { method: "POST", body: { email, password }, authenticated: false }),
  me: () => request<User>("/me"),
  updateProfile: (displayName: string) => request<User>("/me", { method: "PATCH", body: { displayName } }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<AuthResponse>("/me/password", { method: "POST", body: { currentPassword, newPassword } }),

  users: (search?: string) =>
    request<User[]>(search ? `/users?q=${encodeURIComponent(search)}` : "/users"),

  conversations: () => request<Conversation[]>("/conversations"),
  conversation: (id: number) => request<Conversation>(`/conversations/${id}`),
  createDirect: (userId: number) =>
    request<Conversation>("/conversations", { method: "POST", body: { userId } }),
  createGroup: (title: string, userIds: number[]) =>
    request<Conversation>("/conversations", { method: "POST", body: { title, userIds } }),
  renameGroup: (id: number, title: string) =>
    request<Conversation>(`/conversations/${id}`, { method: "PATCH", body: { title } }),
  leaveGroup: (id: number) => request<null>(`/conversations/${id}/leave`, { method: "POST" }),
  markRead: (id: number, messageId: number) =>
    request<{ lastReadMessageId: number }>(`/conversations/${id}/read`, {
      method: "POST",
      body: { messageId },
    }),

  messages: (conversationId: number, before?: number) =>
    request<MessagePage>(
      `/conversations/${conversationId}/messages${before ? `?before=${before}` : ""}`
    ),
  sendMessage: (
    conversationId: number,
    payload: { text: string | null; clientId: string; replyToId: number | null; attachmentId: string | null }
  ) => request<Message>(`/conversations/${conversationId}/messages`, { method: "POST", body: payload }),
  editMessage: (id: number, text: string) =>
    request<Message>(`/messages/${id}`, { method: "PATCH", body: { text } }),
  deleteMessage: (id: number) => request<Message>(`/messages/${id}`, { method: "DELETE" }),
  toggleReaction: (id: number, emoji: string) =>
    request<Message>(`/messages/${id}/reactions`, { method: "POST", body: { emoji } }),
  search: (q: string) => request<Message[]>(`/search?q=${encodeURIComponent(q)}`),

  uploadAttachment: (conversationId: number, file: LocalFile) => {
    const form = new FormData();
    if (file.file) {
      form.append("file", file.file, file.name);
    } else {
      // React Native's FormData accepts a { uri, name, type } descriptor.
      form.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    }
    return request<{ id: string; name: string; mimeType: string; size: number }>(
      `/conversations/${conversationId}/attachments`,
      { method: "POST", form }
    );
  },
};
