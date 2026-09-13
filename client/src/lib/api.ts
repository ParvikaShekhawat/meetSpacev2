const API_BASE = "/api";
const DEFAULT_TIMEOUT_MS = 30000;

export async function fetchApi<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include",
      signal: options.signal ?? controller.signal,
    });

    if (!res.ok) {
      let errorMsg = "An error occurred";
      try {
        const data = await res.json();
        errorMsg = data.error || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}