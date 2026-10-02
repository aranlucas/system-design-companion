import { describe, expect, it } from "vitest";
import {
  embeddedCanvasUrl,
  embeddedHostOrigin,
  isEmbeddedCanvasMessage,
  isEmbeddedHostMessage,
} from "../src/shared/embedded-canvas.ts";

const ORIGIN = "https://design.example";
const HOST = "https://widget.example";
const LINK = `${ORIGIN}/d/board123?k=share-key`;

describe("Extensions canvas embedding boundary", () => {
  it("embeds only a capability URL on the configured deployment and fixes the host origin", () => {
    const url = new URL(
      embeddedCanvasUrl(`${LINK}&host_origin=https://wrong.example#fragment`, ORIGIN, HOST),
    );
    expect(url.origin).toBe(ORIGIN);
    expect(url.searchParams.get("k")).toBe("share-key");
    expect(url.searchParams.get("host_origin")).toBe(HOST);
    expect(url.hash).toBe("");
    for (const link of [
      "https://other.example/d/board123?k=key",
      `${ORIGIN}/api/diagrams`,
      `${ORIGIN}/d/board123`,
      `https://user:pass@design.example/d/board123?k=key`,
    ])
      expect(() => embeddedCanvasUrl(link, ORIGIN, HOST)).toThrow("share link");
  });

  it("accepts exact HTTP(S) parent origins and rejects paths, credentials, and opaque origins", () => {
    expect(embeddedHostOrigin(`?host_origin=${encodeURIComponent(HOST)}`)).toBe(HOST);
    expect(embeddedHostOrigin("?host_origin=http://localhost:5173")).toBe("http://localhost:5173");
    for (const origin of [
      "null",
      "javascript:alert(1)",
      "https://widget.example/path",
      "https://user@widget.example",
    ])
      expect(embeddedHostOrigin(`?host_origin=${encodeURIComponent(origin)}`)).toBeUndefined();
    expect(embeddedHostOrigin("")).toBeUndefined();
  });

  it("accepts bounded selection context and known navigation and theme messages", () => {
    expect(
      isEmbeddedCanvasMessage({ type: "system-design.context", selectedElementIds: ["node-1"] }),
    ).toBe(true);
    expect(isEmbeddedCanvasMessage({ type: "system-design.ready" })).toBe(true);
    expect(isEmbeddedCanvasMessage({ type: "system-design.library" })).toBe(true);
    expect(
      isEmbeddedCanvasMessage({ type: "system-design.context", selectedElementIds: [123] }),
    ).toBe(false);
    expect(
      isEmbeddedCanvasMessage({
        type: "system-design.context",
        selectedElementIds: Array(501).fill("node"),
      }),
    ).toBe(false);
    expect(isEmbeddedCanvasMessage({ type: "unknown" })).toBe(false);
    expect(isEmbeddedHostMessage({ type: "system-design.theme", theme: "dark" })).toBe(true);
    expect(isEmbeddedHostMessage({ type: "system-design.theme", theme: "system" })).toBe(false);
  });
});
