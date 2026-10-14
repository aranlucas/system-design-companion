/** Preserve a Promise API for a synchronous implementation, including thrown errors. */
export function promiseResult<T>(operation: () => T | PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    resolve(operation());
  });
}
