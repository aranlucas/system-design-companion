import { apiErrorMessage, type ApiFailure } from "./api-error.ts";

/** Query cancellation is propagated to the underlying request. */
export async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const body: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      apiErrorMessage(body as ApiFailure, "Could not load data. Retrying automatically."),
    );
  return body as T;
}
