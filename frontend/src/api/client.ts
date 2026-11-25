import { User, Conversation, Message, NearbyUser, ConnectionRequestItem } from "../types";

const TOKEN_KEY = "india_chat_access_token";
const REFRESH_KEY = "india_chat_refresh_token";

export const API_BASE = import.meta.env.VITE_API_URL
  ? String(import.meta.env.VITE_API_URL).replace(/\/$/, "")
  : "";

export function getFullUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export function getStoredToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken?: string) {
  sessionStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) sessionStorage.setItem(REFRESH_KEY, refreshToken);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem("bharatchat_token");
}

export function clearTokens() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem("bharatchat_token");
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith("http") ? endpoint : `${API_BASE}${endpoint}`;
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (!(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res = await fetch(url, { ...options, headers });

  if (res.status === 401 && sessionStorage.getItem(REFRESH_KEY)) {
    const refreshToken = sessionStorage.getItem(REFRESH_KEY);
    try {
      const refreshRes = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (refreshRes.ok) {
        const refreshData = await refreshRes.json();
        setTokens(refreshData.accessToken, refreshData.refreshToken);
        headers.set("Authorization", `Bearer ${refreshData.accessToken}`);
        res = await fetch(url, { ...options, headers });
      } else {
        clearTokens();
        window.dispatchEvent(new Event("auth:expired"));
      }
    } catch {
      clearTokens();
      window.dispatchEvent(new Event("auth:expired"));
    }
  }

  const rawText = await res.text();
  let data: any = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = { message: rawText || `Request failed with status ${res.status}` };
  }

  if (!res.ok) {
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }
  return data;
}

export const api = {
  auth: {
    login: (credentials: { identifier: string; password: string }) =>
      request<{ success: boolean; user: User; accessToken: string; refreshToken: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      }),

    register: (data: {
      username: string;
      displayName: string;
      password: string;
      identifier?: string;
      email?: string;
      phone?: string;
    }) =>
      request<{ success: boolean; user: User; accessToken: string; refreshToken: string }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    guest: () =>
      request<{ success: boolean; user: User; accessToken: string; refreshToken: string }>("/api/auth/guest", {
        method: "POST",
      }),

    requestOtp: (destination: string) =>
      request<{
        success: boolean;
        message: string;
        devOtp?: string;
        userExists?: boolean;
        isNewUser?: boolean;
        username?: string;
        displayName?: string;
      }>("/api/auth/otp/request", {
        method: "POST",
        body: JSON.stringify({ destination }),
      }),

    checkUsername: (username: string) =>
      request<{ success: boolean; available: boolean }>(
        `/api/auth/check-username?username=${encodeURIComponent(username)}`
      ),

    verifyOtp: (payload: { destination: string; code: string; username?: string; displayName?: string }) =>
      request<{ success: boolean; user: User; accessToken: string; refreshToken: string }>("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    getMe: () =>
      request<{ success: boolean; user: User }>("/api/auth/me"),

    logout: () =>
      request<{ success: boolean; message: string }>("/api/auth/logout", { method: "POST" }),
  },

  users: {
    search: (query: string) =>
      request<{ success: boolean; users: User[] }>(`/api/users/search?q=${encodeURIComponent(query)}`),

    lookupByUsername: (username: string) =>
      request<{ success: boolean; user: User }>(`/api/users/lookup/${encodeURIComponent(username.replace(/^@/, ""))}`),

    getProfile: (userId: string) =>
      request<{ success: boolean; user: User }>(`/api/users/${userId}`),

    updateMe: (data: { displayName?: string; username?: string; bio?: string | null; avatarUrl?: string | null }) =>
      request<{ success: boolean; user: User }>("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    block: (userId: string) =>
      request<{ success: boolean; message: string }>(`/api/users/${userId}/block`, { method: "POST" }),

    unblock: (userId: string) =>
      request<{ success: boolean; message: string }>(`/api/users/${userId}/block`, { method: "DELETE" }),

    report: (userId: string, reason: string, details?: string) =>
      request<{ success: boolean; reportId: string }>(`/api/users/${userId}/report`, {
        method: "POST",
        body: JSON.stringify({ reason, details }),
      }),
  },

  conversations: {
    list: () =>
      request<{ success: boolean; conversations: Conversation[] }>("/api/conversations"),

    getById: (conversationId: string) =>
      request<{ success: boolean; conversation: Conversation }>(`/api/conversations/${conversationId}`),

    toggleArchive: (conversationId: string, archived: boolean) =>
      request<{ success: boolean; archived: boolean; archivedAt?: string | null }>(
        `/api/conversations/${conversationId}/archive`,
        {
          method: "POST",
          body: JSON.stringify({ archived }),
        }
      ),

    createDirect: (userId: string) =>
      request<{ success: boolean; conversation: Conversation; existing?: boolean }>("/api/conversations/direct", {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),

    createGroup: (title: string, memberIds: string[]) =>
      request<{ success: boolean; conversation: Conversation }>("/api/conversations/group", {
        method: "POST",
        body: JSON.stringify({ title, memberIds }),
      }),

    updateGroup: (conversationId: string, title: string) =>
      request<{ success: boolean; conversation: Conversation }>(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      }),

    getMembers: (conversationId: string) =>
      request<{ success: boolean; members: Conversation["members"] }>(`/api/conversations/${conversationId}/members`),

    addMember: (conversationId: string, userId: string) =>
      request<{ success: boolean; member: Conversation["members"][0] }>(`/api/conversations/${conversationId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId }),
      }),

    removeMember: (conversationId: string, userId: string) =>
      request<{ success: boolean; message: string }>(`/api/conversations/${conversationId}/members/${userId}`, {
        method: "DELETE",
      }),
  },

  messages: {
    getHistory: (conversationId: string, limit = 40, cursor?: string) => {
      let url = `/api/messages/conversation/${conversationId}?limit=${limit}`;
      if (cursor) url += `&cursor=${cursor}`;
      return request<{ success: boolean; messages: Message[]; nextCursor?: string | null }>(url);
    },

    send: (payload: {
      conversationId: string;
      body?: string;
      type?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "VOICE" | "SYSTEM";
      isViewOnce?: boolean;
      replyToId?: string;
      attachments?: Array<{
        originalName: string;
        storagePath: string;
        mimeType: string;
        sizeBytes: number;
      }>;
    }) =>
      request<{ success: boolean; message: Message }>("/api/messages", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    openViewOnce: (messageId: string) =>
      request<{
        success: boolean;
        attachments: Array<{
          id: string;
          originalName: string;
          storagePath: string;
          mimeType: string;
          sizeBytes: number;
        }>;
        viewedAt: string;
      }>(`/api/messages/${messageId}/view-once`, {
        method: "POST",
      }),

    edit: (messageId: string, body: string) =>
      request<{ success: boolean; message: Message }>(`/api/messages/${messageId}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      }),

    remove: (messageId: string) =>
      request<{ success: boolean; message: Message }>(`/api/messages/${messageId}`, {
        method: "DELETE",
      }),

    markRead: (messageId: string) =>
      request<{ success: boolean }>(`/api/messages/${messageId}/read`, {
        method: "POST",
      }),

    markConversationRead: (conversationId: string) =>
      request<{ success: boolean }>(`/api/messages/conversation/${conversationId}/read`, {
        method: "POST",
      }),
  },

  uploads: {
    upload: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await request<{
        success: boolean;
        file: {
          originalName: string;
          filename: string;
          mimeType: string;
          sizeBytes: number;
          url: string;
        };
      }>("/api/uploads", {
        method: "POST",
        body: formData,
      });
      return res.file;
    },
  },

  translate: {
    convert: (text: string, targetLang = "en", sourceLang = "auto") =>
      request<{
        success: boolean;
        originalText: string;
        translatedText: string;
        intermediateHindi?: string;
        detectedSource: string;
        converted: boolean;
      }>("/api/translate", {
        method: "POST",
        body: JSON.stringify({ text, targetLang, sourceLang }),
      }),
  },

  nearby: {
    getSettings: () =>
      request<{
        success: boolean;
        settings: {
          discoveryEnabled: boolean;
          invisibleMode: boolean;
          isPresenceActive: boolean;
        };
      }>("/api/nearby/settings"),

    updateSettings: (data: { discoveryEnabled?: boolean; invisibleMode?: boolean }) =>
      request<{
        success: boolean;
        settings: {
          discoveryEnabled: boolean;
          invisibleMode: boolean;
        };
      }>("/api/nearby/settings", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    scan: (payload: { latitude: number; longitude: number; accuracy?: number }) =>
      request<{
        success: boolean;
        nearbyUsers: NearbyUser[];
        scannedAt: string;
        expiresInSeconds: number;
      }>("/api/nearby/scan", {
        method: "POST",
        body: JSON.stringify(payload),
      }),

    stop: () =>
      request<{ success: boolean }>("/api/nearby/stop", {
        method: "POST",
      }),

    getRequests: () =>
      request<{
        success: boolean;
        incoming: ConnectionRequestItem[];
        outgoing: ConnectionRequestItem[];
      }>("/api/nearby/requests"),

    sendRequest: (toUserId: string, message?: string) =>
      request<{
        success: boolean;
        request: ConnectionRequestItem;
        conversationId?: string;
        alreadyConnected?: boolean;
        autoAccepted?: boolean;
      }>("/api/nearby/requests", {
        method: "POST",
        body: JSON.stringify({ toUserId, message }),
      }),

    respondRequest: (requestId: string, action: "ACCEPT" | "REJECT") =>
      request<{
        success: boolean;
        request: ConnectionRequestItem;
        conversationId?: string;
      }>(`/api/nearby/requests/${requestId}/respond`, {
        method: "POST",
        body: JSON.stringify({ action }),
      }),

    cancelRequest: (requestId: string) =>
      request<{ success: boolean }>(`/api/nearby/requests/${requestId}`, {
        method: "DELETE",
      }),
  },
};
