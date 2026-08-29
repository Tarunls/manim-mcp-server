export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method || "GET").toUpperCase();
  const csrfToken = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("lesson_studio_csrf="))
    ?.slice("lesson_studio_csrf=".length);
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken
        ? { "X-CSRF-Token": csrfToken }
        : {}),
      ...(method === "POST" &&
      /\/api\/projects\/[^/]+\/(?:messages|reviews)$/.test(url)
        ? { "Idempotency-Key": crypto.randomUUID() }
        : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Something went wrong.");
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}
