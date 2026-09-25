interface ValidationIssue {
  message: string;
}

interface ValidationError {
  message: string;
}

export interface ApiFailure {
  error?: string | ValidationError;
}

export function apiErrorMessage(response: ApiFailure, fallback: string): string {
  const error = response.error;
  if (typeof error === "string") return error || fallback;
  if (!error) return fallback;
  // ZodError serializes its issues as JSON in message.
  try {
    const issues = JSON.parse(error.message) as ValidationIssue[];
    return issues[0]?.message || fallback;
  } catch {
    return fallback;
  }
}
