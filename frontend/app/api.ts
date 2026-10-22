// Keep frontend and backend on the same hostname so HttpOnly session cookies work.
export const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || (typeof window === "undefined" ? "http://localhost:8000" : `${window.location.protocol}//${window.location.hostname}:8000`)).replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.name = "ApiError"; this.status = status; }
}

export function mediaUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (/^(data:|blob:)/.test(path)) return path;
  if (/^https?:\/\//.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : "/" + path}`;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const url = path.startsWith("/api/") ? `${API_BASE}${path}` : `${API_BASE}/api/v1${path}`;
  let response: Response;
  try { response = await fetch(url, { ...init, headers, credentials: "include", cache: "no-store", signal: init.signal ?? AbortSignal.timeout(30000) }); }
  catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("无法连接服务，请检查后端窗口并重试。", 0);
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null) as {detail?:unknown}|null;
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) window.dispatchEvent(new Event("steelvision:unauthorized"));
    throw new ApiError(typeof data?.detail === "string" ? data.detail : `请求未完成（${response.status}）`, response.status);
  }
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
