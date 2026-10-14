import { promiseResult } from "@/shared/promise-result.ts";
import { z } from "zod";
import { strictFake } from "@test/helpers/strict-fake.ts";
import { requiredTestValue } from "@test/helpers/required-test-value.ts";

type HttpMetadata = { contentType?: string };

type StoredObject = { bytes: Uint8Array; httpMetadata?: HttpMetadata };

/** Minimal R2 stand-in: JSON blobs and binary objects by key. */
export class FakeR2 {
  objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    if (options?.onlyIf) {
      throw new Error("Conditional R2 writes are not implemented");
    }

    const text = z.string().safeParse(value);

    const bytes = text.success
      ? new TextEncoder().encode(text.data)
      : new Uint8Array(await new Response(value).arrayBuffer());

    const httpMetadata =
      options?.httpMetadata instanceof Headers
        ? { contentType: options.httpMetadata.get("content-type") ?? undefined }
        : options?.httpMetadata;

    this.objects.set(key, { bytes, httpMetadata });

    return strictFake<R2Object>({ key, size: bytes.length }, { nonThenable: true });
  }

  list(options: R2ListOptions = {}): Promise<R2Objects> {
    return promiseResult(() => {
      return {
        truncated: false,
        delimitedPrefixes: [],
        objects: [...this.objects.keys()].flatMap((key) =>
          key.startsWith(options.prefix ?? "")
            ? [strictFake<R2Object>({ key }, { nonThenable: true })]
            : [],
        ),
      };
    });
  }

  delete(keys: string | string[]) {
    return promiseResult(() => {
      for (const key of [keys].flat()) {
        this.objects.delete(key);
      }
    });
  }

  head(key: string) {
    return promiseResult(() => {
      return this.objects.has(key) ? strictFake<R2Object>({ key }, { nonThenable: true }) : null;
    });
  }

  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    return promiseResult(() => {
      if (options?.onlyIf || options?.range) {
        throw new Error("Conditional/ranged R2 reads are not implemented");
      }

      const v = this.objects.get(key);

      if (!v) {
        return null;
      }

      return strictFake<R2ObjectBody>(
        {
          httpMetadata: v.httpMetadata ?? {},
          get body() {
            return requiredTestValue(new Response(v.bytes).body);
          },
          json: <T>() => {
            return promiseResult(() => {
              // SAFETY: R2 json<T> uses the caller-selected decoded JSON contract; this mirrors that API rather than claiming runtime validation.
              return JSON.parse(new TextDecoder().decode(v.bytes)) as T;
            });
          },
        },
        { nonThenable: true },
      );
    });
  }
}
