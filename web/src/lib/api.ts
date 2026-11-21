import { lookupMessage } from "./i18n.ts";
// fetch against the app's own origin. The session cookie and Origin header come with it.
export class ApiError extends Error {
  status: number;
  body: any;

  constructor(status: number, message: string, body?: unknown) {
    super(lookupMessage(message));
    this.status = status;
    this.body = body;
  }
}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized = () => {};

export function setUnauthorizedHandler(handler: Unauthorized): void {
  onUnauthorized = handler;
}

export async function apiWithHeaders<T = any>(method: string, url: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Får ikke kontakt med serveren");
  }
  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    if (res.status === 401 && url !== "/api/auth/exchange") onUnauthorized();
    throw new ApiError(res.status, parsed?.error ?? `Feil ${res.status}`, parsed);
  }
  return { data: parsed as T, headers: res.headers };
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  return (await apiWithHeaders<T>(method, url, body)).data;
}

export const get = <T = any>(url: string) => api<T>("GET", url);
export const getWithHeaders = <T = any>(url: string) => apiWithHeaders<T>("GET", url);
export const post = <T = any>(url: string, body?: unknown) => api<T>("POST", url, body);
export const patch = <T = any>(url: string, body?: unknown) => api<T>("PATCH", url, body);
export const put = <T = any>(url: string, body?: unknown) => api<T>("PUT", url, body);
export const del = <T = any>(url: string) => api<T>("DELETE", url);
