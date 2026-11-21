export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}
export async function api(path, body, signal, method) {
  const headers = {};
  if (body !== undefined) {
    const csrf = await fetch("/api/auth/csrf", { cache: "no-store", signal });
    if (!csrf.ok)
      throw new ApiError("Unable to start a secure request.", csrf.status);
    headers["X-CSRF-Token"] = (await csrf.json()).token;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(
      data.error || "Unable to load records. Please try again.",
      response.status,
      data,
    );
  }
  return response.status === 204 ? null : response.json();
}
export async function list(path, signal) {
  const rows = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    const batch = await api(
      `${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`,
      undefined,
      signal,
    );
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
  throw new Error(
    "This register is too large to load in one view. Contact your administrator.",
  );
}
