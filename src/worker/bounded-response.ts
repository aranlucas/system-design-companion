/** Read a small untrusted response without buffering an unbounded body. */
export async function boundedResponse(response: Response): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- consume a bounded stream
      const result = await reader.read();
      const value: unknown = result.value;

      if (result.done) {
        break;
      }

      if (!(value instanceof Uint8Array)) {
        throw new Error("verification response must contain byte chunks");
      }

      size += value.length;

      if (size > 4096) {
        throw new Error("verification response too large");
      }

      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(bytes);
}
