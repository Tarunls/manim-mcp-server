export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError("Cannot reach the local server. Restart Manim Studio, then refresh this page.");
  }

  const raw = response.status === 204 ? "" : await response.text();
  let body: Record<string, unknown> | undefined;
  if (raw) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      body = undefined;
    }
  }

  if (!response.ok) {
    const serverMessage = typeof body?.error === "string" ? body.error : undefined;
    if (response.status === 404 && !serverMessage) {
      throw new ApiError("The browser and local server are different versions. Restart Manim Studio, then refresh.", response.status);
    }
    throw new ApiError(serverMessage || `Request failed (${response.status}).`, response.status);
  }

  if (response.status === 204) return undefined as T;
  if (!body) {
    throw new ApiError("The local server returned an unexpected response. Restart Manim Studio, then refresh.", response.status);
  }
  return body as T;
}
