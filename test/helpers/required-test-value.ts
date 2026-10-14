/** Fail with a useful fixture error instead of hiding missing data behind a non-null assertion. */
export function requiredTestValue<T>(value?: T | null): T {
  if (value === undefined || value === null) {
    throw new Error("Expected test fixture value to be present");
  }

  return value;
}
