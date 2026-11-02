export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch("/api/v1" + path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (r.status === 204) return undefined as T;
  const result = await r.json();
  if (!r.ok)
    throw new ApiError(
      r.status,
      result.error?.code ?? "HTTP_ERROR",
      result.error?.message ?? "请求失败",
      result.error?.details,
    );
  return result.data;
}
const pending = new Map<string, string>();
export async function intent<T = any>(
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const key = path + JSON.stringify(payload),
    requestId = pending.get(key) ?? crypto.randomUUID();
  pending.set(key, requestId);
  try {
    const result = await api<T>(path, {
      method: "POST",
      body: JSON.stringify({ ...payload, requestId }),
    });
    pending.delete(key);
    return result;
  } catch (e) {
    if (e instanceof ApiError && e.status < 500) pending.delete(key);
    throw e;
  }
}
