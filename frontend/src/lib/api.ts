const API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8100";

export function getApiUrl(path: string): string {
  return `${API_URL.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
