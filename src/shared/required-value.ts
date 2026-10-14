/** Fail at the violated invariant rather than passing an absent value downstream. */
export function requiredValue<T>(value: T | null | undefined, context: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Missing required value: ${context}`);
  }

  return value;
}
