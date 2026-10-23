import {
  experimental_createMCPClient as createMCPClient,
  experimental_createMCPEventWebhook,
  type Experimental_MCPEventStore,
  type Experimental_MCPEventSubscription,
  type Experimental_MCPEventWebhookOptions,
} from "@ai-sdk/mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promiseResult } from "@/shared/promise-result.ts";
import { handleMcp } from "@/worker/mcp.ts";
import { resetVerificationCache } from "@/worker/events.ts";
import { createDiagram, shareLink } from "@/worker/store.ts";
import { DiagramRoom } from "@/worker/room.ts";
import { makeEnv, makeRoomCtx, makeWs, testPrincipal } from "@test/helpers/fakes.ts";

/** Test storage implements the AI SDK contract, including atomic patch merging. */
type EventHandler = Experimental_MCPEventWebhookOptions["onEvent"];

class EventStore implements Experimental_MCPEventStore {
  readonly subscriptions = new Map<string, Experimental_MCPEventSubscription>();
  get(key: string) {
    return Promise.resolve(this.subscriptions.get(key));
  }
  getById(id: string) {
    return Promise.resolve([...this.subscriptions.values()].find((sub) => sub.id === id));
  }
  set(subscription: Experimental_MCPEventSubscription) {
    return promiseResult(() => {
      this.subscriptions.set(subscription.key, subscription);
    });
  }
  update(key: string, patch: Partial<Experimental_MCPEventSubscription>) {
    return promiseResult(() => {
      const current = this.subscriptions.get(key);

      if (!current) {
        throw new Error("Missing subscription");
      }

      this.subscriptions.set(key, { ...current, ...patch });
    });
  }
  delete(key: string) {
    return promiseResult(() => {
      this.subscriptions.delete(key);
    });
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("AI SDK MCP Events interoperability", () => {
  it("discovers, verifies, receives human changes, refreshes and unsubscribes through the real SDK", async () => {
    const env = makeEnv();
    const store = new EventStore();
    const onEvent = vi.fn<EventHandler>();
    vi.stubGlobal("Cloudflare", { compatibilityFlags: { global_fetch_strictly_public: true } });
    const webhook = experimental_createMCPEventWebhook({ store, onEvent });
    const deliveries: number[] = [];
    resetVerificationCache();
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);

      if (new URL(request.url).hostname === "cloudflare-dns.com") {
        return Response.json({ Status: 0, Answer: [{ type: 1, data: "8.8.8.8" }] });
      }

      const response = await webhook(request);
      deliveries.push(response.status);

      return response;
    });

    const client = await createMCPClient({
      transport: {
        type: "http",
        url: "https://design.example/mcp",
        fetch: (input, init) => handleMcp(new Request(input, init), env.env, testPrincipal()),
      },
      experimental_events: { store },
    });

    try {
      expect((await client.experimental_events.list()).events.map((event) => event.name)).toEqual([
        "diagram.changed",
        "diagram.renamed",
        "diagram.checkpointed",
      ]);
      const diagram = await createDiagram(env.env, "Watched");
      const link = shareLink("https://design.example", diagram.id, diagram.key);

      const subscriptions = await Promise.all(
        ["diagram.changed", "diagram.renamed", "diagram.checkpointed"].map((name) =>
          client.experimental_events.subscribe({
            name,
            arguments: { diagram: link },
            delivery: { mode: "webhook", url: "https://receiver.example.com/events" },
            ttlMs: 3600_000,
          }),
        ),
      );

      expect(deliveries).toEqual([200, 200, 200]);
      expect([...store.subscriptions.values()].every((sub) => sub.status === "active")).toBe(true);
      const ctx = makeRoomCtx();
      const room = new DiagramRoom(ctx.ctx, env.env);
      await room.init(diagram.id, diagram.name);

      const update = {
        type: "update",
        elements: [
          {
            id: "node",
            type: "rectangle",
            x: 0,
            y: 0,
            width: 100,
            height: 60,
            version: 1,
            versionNonce: 1,
            isDeleted: false,
            index: "a0",
            frameId: null,
          },
        ],
      };

      const socket = makeWs();
      await room.webSocketMessage(socket, JSON.stringify(update));
      await ctx.drain();
      expect(onEvent.mock.calls[0][0].event.name).toBe("diagram.changed");
      expect(onEvent.mock.calls[0][0].event.data).toEqual({
        diagram_id: diagram.id,
        origin: "human",
        changed_count: 1,
      });
      // Re-sending an unchanged element and the agent's own edits must not trigger feedback.
      await room.webSocketMessage(socket, JSON.stringify(update));
      await room.applyPatch([{ op: "add_node", label: "Agent node" }], "agent");
      await ctx.drain();
      expect(onEvent).toHaveBeenCalledTimes(1);
      await room.rename("Renamed");
      await room.snapshot("Checkpoint", "named");
      await ctx.drain();
      expect(onEvent.mock.calls.map(([delivery]) => delivery.event.name).toSorted()).toEqual([
        "diagram.changed",
        "diagram.checkpointed",
        "diagram.renamed",
      ]);
      const first = subscriptions[0];
      const renewed = await client.experimental_events.refresh({ id: first.id });
      expect(renewed.id).toBe(first.id);
      await Promise.all(
        subscriptions.map((subscription) =>
          client.experimental_events.unsubscribe({ id: subscription.id }),
        ),
      );
      expect(store.subscriptions.size).toBe(0);
      expect(env.db.event_subscriptions.size).toBe(0);
      await room.rename("After unsubscribe");
      await ctx.drain();
      expect(onEvent).toHaveBeenCalledTimes(3);
      expect(deliveries.every((status) => status >= 200 && status < 300)).toBe(true);
    } finally {
      await client.close();
    }
  });
});
