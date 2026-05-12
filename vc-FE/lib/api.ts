import axios, { type InternalAxiosRequestConfig } from "axios";

const baseURL = process.env.NEXT_PUBLIC_API_URL ?? "";

export const api = axios.create({
  baseURL,
  timeout: 10000,
});

function isPublicApiPath(config: InternalAxiosRequestConfig): boolean {
  const path = config.url ?? "";
  if (path.startsWith("/api/auth/login")) return true;
  if (path === "/api/token" || path.startsWith("/api/token?")) return true;
  return false;
}

api.interceptors.request.use((config) => {
  if (isPublicApiPath(config)) {
    return config;
  }
  const token = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error: import("axios").AxiosError<{ error?: string }>) => {
    if (typeof window !== "undefined" && error.response?.status === 401) {
      localStorage.removeItem("adminToken");
      localStorage.removeItem("isAdmin");
      window.location.href = "/admin/login";
      return Promise.reject(error);
    }
    if (error.response?.status === 503) {
      return Promise.reject(new Error("Service temporarily unavailable"));
    }
    if (error.response?.status === 429) {
      const msg =
        (error.response.data && typeof error.response.data === "object" && error.response.data.error) ||
        "Too many requests. Please wait and try again.";
      return Promise.reject(new Error(String(msg)));
    }
    if (!error.response) {
      return Promise.reject(new Error("Cannot connect to server"));
    }
    const data = error.response.data;
    const backendMsg =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : null;
    return Promise.reject(new Error(backendMsg || "Request failed"));
  }
);

export async function adminLogin(email: string, password: string): Promise<{ token: string }> {
  const { data } = await api.post<{ token: string }>("/api/auth/login", { email, password });
  return data;
}

export async function createRoom(): Promise<{
  roomId: string;
  roomUrl: string;
  message: string;
}> {
  const { data } = await api.post("/api/rooms/create");
  return data;
}

export async function getParticipants(roomId: string): Promise<{
  count: number;
  participants: { identity: string; joinedAt: string; isPublishing: boolean }[];
}> {
  const { data } = await api.get(`/api/rooms/${encodeURIComponent(roomId)}/participants`);
  return data;
}

export async function deleteRoom(roomId: string): Promise<{ success: true }> {
  const { data } = await api.delete(`/api/rooms/${encodeURIComponent(roomId)}`);
  return data;
}

export async function getToken(
  roomId: string,
  participantName: string,
  isAdmin: boolean
): Promise<{ token: string; wsUrl: string }> {
  const headers: Record<string, string> = {};
  if (isAdmin) {
    const t = typeof window !== "undefined" ? localStorage.getItem("adminToken") : null;
    if (t) {
      headers.Authorization = `Bearer ${t}`;
    }
  }
  const { data } = await api.post<{ token: string; wsUrl: string }>(
    "/api/token",
    { roomId, participantName, isAdmin },
    { headers }
  );
  return data;
}
