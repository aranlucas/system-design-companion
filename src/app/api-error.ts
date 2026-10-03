import {
  assertBoundary,
  isText,
  isValidationError,
  isIssues,
  type ApiFailure,
} from "./validation.ts";

export type { ApiFailure } from "./validation.ts";

export function apiErrorMessage(response: ApiFailure, fallback: string): string {
  const error = response.error;

  if (isText(error)) return error || fallback;

  if (!isValidationError(error)) return fallback;

  try {
    const issues: unknown = JSON.parse(error.message);
    assertBoundary(issues, isIssues);

    return issues[0]?.message || fallback;
  } catch {
    return fallback;
  }
}
