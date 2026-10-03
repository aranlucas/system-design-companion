import { assertBoundary, isApiFailure, type Guard } from "./validation.ts";
import { apiErrorMessage } from "./api-error.ts";

/** Query cancellation is propagated to the underlying request. */
export async function getJson<T>(url: string, signal: AbortSignal, guard: Guard<T>): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const body: unknown = await response.json();

  if (!response.ok)
    throw new Error(
      apiErrorMessage(
        isApiFailure(body) ? body : {},
        "Could not load data. Retrying automatically.",
      ),
    );

  assertBoundary(body, guard);

  return body;
}
