import type { UIMessageChunk } from "ai";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasChanges, hasCanvasChanges, observeCanvas } from "@/app/interview-changes.ts";
import { interviewerTransport, type InterviewMessage } from "@/app/interviewer-transport.ts";

const QUESTION = "You added a cache. How will you invalidate it after a write?";

function responseStream() {
  const item = {
    type: "message",
    id: "message-test",
    content: [{ type: "output_text", text: QUESTION, annotations: [] }],
  };

  const events = [
    {
      type: "response.created",
      response: { id: "response-test", created_at: 1, model: "account-model" },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "message-test" },
    },
    {
      type: "response.output_text.delta",
      item_id: "message-test",
      output_index: 0,
      delta: QUESTION,
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: {} },
  ];

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("interviewer context and streaming", () => {
  it("tracks additions, label edits and removals without treating view changes as edits", () => {
    const original = [
      {
        id: "label",
        type: "text" as const,
        isDeleted: false,
        text: "Database",
        x: 20,
        y: 30,
        width: 100,
        height: 40,
        version: 1,
        versionNonce: 1,
      },
    ];

    const before = observeCanvas(original);
    expect(hasCanvasChanges(canvasChanges(before, observeCanvas(original)))).toBe(false);

    const edited = [
      {
        id: "label",
        type: "text" as const,
        isDeleted: false,
        text: "Cache",
        x: 20,
        y: 30,
        width: 100,
        height: 40,
        version: 2,
        versionNonce: 2,
      },
      {
        id: "node",
        type: "rectangle" as const,
        isDeleted: false,
        x: 20,
        y: 40,
        width: 120,
        height: 80,
        version: 1,
        versionNonce: 1,
      },
    ];

    const changes = canvasChanges(before, observeCanvas(edited));
    expect(changes.added.map((element) => element.id)).toEqual(["node"]);
    expect(changes.updated[0].before.text).toBe("Database");
    expect(changes.updated[0].after.text).toBe("Cache");
    expect(
      canvasChanges(
        observeCanvas(edited),
        observeCanvas(
          edited.map((element) => ({ ...element, versionNonce: element.versionNonce + 1 })),
        ),
      ).updated,
    ).toHaveLength(2);
    expect(canvasChanges(observeCanvas(edited), new Map()).removed).toHaveLength(2);
  });

  it("sends the current scene, previous conversation and exact changes through the ChatGPT proxy", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(responseStream()));
    vi.stubGlobal("fetch", fetcher);

    const transport = interviewerTransport({
      getScene: () => Promise.resolve('{"nodes":[{"label":"Cache"}]}'),
      getScreenshot: () => Promise.resolve("data:image/jpeg;base64,/9j/2Q=="),
    });

    const messages: InterviewMessage[] = [
      { id: "answer", role: "user", parts: [{ type: "text", text: "I want reads under 100 ms." }] },
    ];

    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "interview",
      messageId: undefined,
      messages,
      abortSignal: undefined,
      body: { model: "account-model", changes: "Added a cache before the database." },
    });

    const chunks: UIMessageChunk[] = [];
    const reader = stream.getReader();

    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- consume the SDK stream in delivery order
      const chunk = await reader.read();

      if (chunk.done) {
        break;
      }

      chunks.push(chunk.value);
    }

    expect(
      chunks.flatMap((chunk) => (chunk.type === "text-delta" ? [chunk.delta] : [])).join(""),
    ).toBe(QUESTION);
    expect(chunks.some((chunk) => chunk.type === "finish")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      new URL(
        fetcher.mock.calls[0][0] instanceof Request
          ? fetcher.mock.calls[0][0].url
          : String(fetcher.mock.calls[0][0]),
        "https://design.example",
      ).pathname,
    ).toBe("/api/chatgpt/responses");
    const body = z.string().parse(fetcher.mock.calls[0][1]?.body);
    expect(body).toContain("account-model");
    expect(body).toContain("reads under 100 ms");
    expect(body).toContain("Added a cache before the database");
    expect(body).toContain("Cache");
    expect(body).toContain("ONE concise question");
    expect(body).toContain("input_image");
  });

  it("rejects oversized context before consuming ChatGPT usage", async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);

    const transport = interviewerTransport({
      getScene: () => Promise.resolve("x".repeat(100_001)),
    });

    await expect(
      transport.sendMessages({
        trigger: "submit-message",
        chatId: "interview",
        messageId: undefined,
        messages: [],
        abortSignal: undefined,
        body: { model: "account-model", changes: "Updated." },
      }),
    ).rejects.toThrow("too large");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
