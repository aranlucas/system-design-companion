import { test as base } from "@e2e-dev/web";
import { z } from "zod";
import { storedElementsSchema } from "../src/shared/schemas.ts";
import { Scene, graphView } from "../src/worker/scene.ts";
import { live } from "./web-engine.ts";

interface MockWorkspace {
  signedIn: boolean;
  failResponse: boolean;
  failModels: boolean;
  modelRequests: number;
  requests: string[];
  elements: RoomUpdate[];
}

const roomUpdateSchema = z.object({ type: z.literal("update"), elements: storedElementsSchema });

type RoomUpdate = z.infer<typeof roomUpdateSchema>;

interface WorkspaceFixtures {
  workspace: MockWorkspace;
}

const authenticated = {
  status: "authenticated",
  user: { accountId: "test-person", email: "candidate@example.com", planType: "plus" },
};

function responseStream(text: string, turn: number) {
  const id = `msg_${turn}`;

  return [
    {
      type: "response.created",
      response: { id: `resp_${turn}`, created_at: 1, model: "gpt-5.5" },
    },
    { type: "response.output_item.added", output_index: 0, item: { type: "message", id } },
    { type: "response.output_text.delta", item_id: id, output_index: 0, delta: text },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", id, content: [{ type: "output_text", text, annotations: [] }] },
    },
    { type: "response.completed", response: {} },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}

// The real React/Excalidraw and AI SDK code runs in Chromium. Only external
// account, room and model boundaries are replaced; no plan is charged in CI.
export const test = base.extend<WorkspaceFixtures>({
  workspace: async ({ browser, app }, provide) => {
    const workspace: MockWorkspace = {
      signedIn: true,
      failResponse: false,
      failModels: false,
      modelRequests: 0,
      requests: [],
      elements: [],
    };

    await browser.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: { signedIn: workspace.signedIn, authEnabled: true },
      }),
    );
    await browser.route("**/api/auth/login", (route) => {
      workspace.signedIn = true;

      return route.fulfill({ status: 302, headers: { Location: app.baseUrl ?? "/" } });
    });
    await browser.route("**/api/auth/logout", (route) => {
      workspace.signedIn = false;

      return route.fulfill({ status: 204 });
    });
    await browser.route("**/api/chatgpt/session", (route) =>
      route.fulfill({ json: workspace.signedIn ? authenticated : { status: "unauthenticated" } }),
    );
    await browser.route("**/api/chatgpt/login", (route) =>
      route.fulfill({
        json: {
          status: "pending",
          userCode: "TEST-1234",
          verificationUrl: `${app.baseUrl ?? ""}/verification`,
        },
      }),
    );
    await browser.route("**/verification", (route) =>
      route.fulfill({ body: "Test verification complete", contentType: "text/html" }),
    );
    await browser.route("**/api/chatgpt/status", (route) => {
      workspace.signedIn = true;

      return route.fulfill({ json: authenticated });
    });
    await browser.route("**/api/chatgpt/models", (route) => {
      workspace.modelRequests += 1;

      return route.fulfill(
        workspace.failModels
          ? { status: 403, json: { error: "models_request_failed" } }
          : { json: { models: ["account-model"] } },
      );
    });
    await browser.route("**/api/chatgpt/responses", (route) => {
      workspace.requests.push(route.request.postData ?? "");

      if (workspace.failResponse) {
        return route.fulfill({
          status: 503,
          json: { error: { message: "Plan unavailable", type: "server_error" } },
        });
      }

      const turn = workspace.requests.length;

      return route.fulfill({
        contentType: "text/event-stream",
        body: responseStream(`Question ${turn}: How does this design handle failure?`, turn),
      });
    });
    await browser.route("**/api/templates", (route) => route.fulfill({ json: [] }));
    await browser.route("**/api/diagrams**", (route) =>
      route.fulfill({
        json:
          route.request.method === "POST"
            ? { id: "practice", key: "edit-key", name: "Practice board" }
            : { items: [], nextCursor: null },
      }),
    );
    await browser.route("**/api/d/practice?*", (route) =>
      route.fulfill({ json: { id: "practice", name: "Practice board" } }),
    );
    await browser.route("**/api/d/practice/interview-context?*", (route) =>
      route.fulfill({
        json: {
          scene: JSON.stringify(
            graphView(new Scene(workspace.elements.flatMap((update) => update.elements))),
          ),
        },
      }),
    );
    // e2e exposes Playwright through surfaceOf for facilities outside its facade.
    await live.context().routeWebSocket("**/ws/practice?*", (socket) => {
      socket.send(JSON.stringify({ type: "init", elements: [], name: "Practice board" }));
      socket.onMessage((message) => {
        const parsed = roomUpdateSchema.safeParse(JSON.parse(String(message)));

        if (parsed.success) {
          workspace.elements.push(parsed.data);
        }
      });
    });
    await provide(workspace);
  },
});
