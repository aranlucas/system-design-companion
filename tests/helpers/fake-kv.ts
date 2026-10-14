import { promiseResult } from "../../src/shared/promise-result.ts";
import { z } from "zod";
import { requiredTestValue } from "./required-test-value.ts";
import type { JsonValue } from "../../src/shared/schemas.ts";

type KvEntry = { value: string; expiration?: number };

function json<T>(value: string | null): T | null {
  if (value === null) {
    return null;
  }

  // SAFETY: KV's generic JSON overload delegates the serialized value contract to its caller, exactly as JSON.parse does; this fake does not claim schema validation.
  return JSON.parse(value) as T;
}

type KvResult<T> =
  | string
  | T
  | ArrayBuffer
  | ReadableStream
  | null
  | Map<string, string | T | null>;

/** KV persistence shared by real OAuthProvider instances in integration tests. */
export class FakeKV {
  readonly values = new Map<string, KvEntry>();
  get(key: string, options?: Partial<KVNamespaceGetOptions<undefined>>): Promise<string | null>;
  get(key: string, type: "text"): Promise<string | null>;
  get<ExpectedValue = JsonValue>(key: string, type: "json"): Promise<ExpectedValue | null>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  get(key: string, type: "stream"): Promise<ReadableStream | null>;
  get(key: string, options?: KVNamespaceGetOptions<"text">): Promise<string | null>;
  get<ExpectedValue = JsonValue>(
    key: string,
    options?: KVNamespaceGetOptions<"json">,
  ): Promise<ExpectedValue | null>;
  get(key: string, options?: KVNamespaceGetOptions<"arrayBuffer">): Promise<ArrayBuffer | null>;
  get(key: string, options?: KVNamespaceGetOptions<"stream">): Promise<ReadableStream | null>;
  get(key: Array<string>, type: "text"): Promise<Map<string, string | null>>;
  get<ExpectedValue = JsonValue>(
    key: Array<string>,
    type: "json",
  ): Promise<Map<string, ExpectedValue | null>>;
  get(
    key: Array<string>,
    options?: Partial<KVNamespaceGetOptions<undefined>>,
  ): Promise<Map<string, string | null>>;
  get(
    key: Array<string>,
    options?: KVNamespaceGetOptions<"text">,
  ): Promise<Map<string, string | null>>;
  get<ExpectedValue = JsonValue>(
    key: Array<string>,
    options?: KVNamespaceGetOptions<"json">,
  ): Promise<Map<string, ExpectedValue | null>>;
  get<T = JsonValue>(
    key: string | string[],
    options?:
      | Partial<KVNamespaceGetOptions<undefined | "text" | "json" | "arrayBuffer" | "stream">>
      | "json"
      | "text"
      | "arrayBuffer"
      | "stream",
  ): Promise<KvResult<T>> {
    return promiseResult<KvResult<T>>(() => {
      const kind = z.string().safeParse(options);

      const format = kind.success
        ? kind.data
        : z.object({ type: z.string().optional() }).parse(options ?? {}).type;

      const read = (name: string) => {
        const entry = this.values.get(name);

        return !entry || (entry.expiration && entry.expiration <= Date.now() / 1000)
          ? null
          : entry.value;
      };

      if (Array.isArray(key)) {
        if (format !== undefined && format !== "text" && format !== "json") {
          throw new Error("Unsupported multi-key KV format");
        }

        return new Map(
          key.map((name) => [name, format === "json" ? json<T>(read(name)) : read(name)]),
        );
      }

      const value = read(key);

      if (value === null) {
        return null;
      }

      if (format === "json") {
        return json<T>(value);
      }

      if (format === "arrayBuffer") {
        return new Response(value).arrayBuffer();
      }

      if (format === "stream") {
        return requiredTestValue(new Response(value).body);
      }

      return value;
    });
  }
  async put(
    key: string,
    input: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: KVNamespacePutOptions,
  ): Promise<void> {
    const value = await new Response(input).text();
    this.values.set(key, {
      value,
      expiration:
        options?.expiration ??
        (options?.expirationTtl ? Date.now() / 1000 + options.expirationTtl : undefined),
    });
  }
  delete(key: string): Promise<void> {
    return promiseResult(() => {
      this.values.delete(key);
    });
  }
  list<Metadata = JsonValue>(
    options: KVNamespaceListOptions = {},
  ): Promise<KVNamespaceListResult<Metadata>> {
    return promiseResult(() => {
      const names = [...this.values.keys()]
        .filter((name) => name.startsWith(options.prefix ?? ""))
        .filter(
          (name) =>
            !requiredTestValue(this.values.get(name)).expiration ||
            requiredTestValue(requiredTestValue(this.values.get(name)).expiration) >
              Date.now() / 1000,
        )
        .toSorted();

      const offset = Number(options.cursor ?? 0);
      const limit = options.limit ?? 1000;

      return {
        keys: names.slice(offset, offset + limit).map((name) => ({ name })),
        list_complete: offset + limit >= names.length,
        cacheStatus: null,
        cursor: offset + limit >= names.length ? "" : String(offset + limit),
      };
    });
  }
}
