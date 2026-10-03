import { strictFake } from "./strict-fake.ts";

export type OwnerMethods<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => void ? K : never]?: T[K];
};

type Callable = (...args: never[]) => void;

function isCallable(value: unknown): value is Callable {
  return typeof value === "function";
}

function isObject<T>(value: T): value is T & object {
  return typeof value === "object" && value !== null;
}

function rejectDisposal<T>(value: T): T {
  if (!isObject(value)) return value;

  return new Proxy(value, {
    get(target, key) {
      if (key === Symbol.dispose)
        throw new Error("RPC disposal is not implemented by this awaited-only fake");

      let descriptor: PropertyDescriptor | undefined;

      for (let owner = target; owner !== null && !descriptor; owner = Object.getPrototypeOf(owner))
        descriptor = Object.getOwnPropertyDescriptor(owner, key);

      return descriptor?.get ? descriptor.get.call(target) : descriptor?.value;
    },
  });
}

/** The stub and checked direct methods share the same actual Cloudflare owner type. */
export function awaitedRpc<T extends Rpc.DurableObjectBranded>(
  methods: OwnerMethods<
    Omit<
      T,
      "fetch" | "connect" | "webSocketMessage" | "webSocketClose" | "webSocketError" | "alarm"
    >
  >,
  fetch?: Fetcher["fetch"],
): DurableObjectStub<T> {
  const proxy = new Proxy(methods, {
    get(target, key) {
      if (key === "fetch" && fetch) return fetch;
      let descriptor: PropertyDescriptor | undefined;

      for (
        let owner = target;
        owner !== null && !descriptor;
        owner = Object.getPrototypeOf(owner)
      ) {
        descriptor = Object.getOwnPropertyDescriptor(owner, key);
      }

      const method = descriptor?.get ? descriptor.get.call(target) : descriptor?.value;

      if (!isCallable(method)) throw new Error(`Unimplemented RPC capability: ${String(key)}`);

      return (...args: never[]) => {
        const pending = Promise.resolve()
          .then(() => method.apply(target, args))
          .then(rejectDisposal);

        // Promise methods retain their receiver; arbitrary pipelining properties throw.
        return strictFake(pending);
      };
    },
  });

  // SAFETY: OwnerMethods<T> checks each supplied method against the real owner T, from which Cloudflare derives DurableObjectStub<T>. This test-only proxy supports awaiting, not RPC pipelining or disposal: unsupported member/disposal access throws rather than fabricating capabilities.
  return proxy as DurableObjectStub<T>;
}
