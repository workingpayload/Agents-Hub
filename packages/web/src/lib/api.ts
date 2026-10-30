import { useHub } from './store';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: unknown,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = useHub.getState().token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && token && path !== '/api/pairing/complete') {
    useHub.getState().setUnauthorized();
  }
  if (!res.ok) throw new ApiError(data?.error ?? `${res.status} ${res.statusText}`, res.status, data);
  return data as T;
}

export const post = <T = unknown>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });
