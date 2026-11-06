export async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));

  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";

// Keep the established 21-character URL-safe identifier format (126 random bits).
export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(21)), (byte) => ID_CHARS[byte & 63]).join(
    "",
  );
}
