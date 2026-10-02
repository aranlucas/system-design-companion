import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { createViewHost, type ViewHost } from "../src/view/host.ts";

type ToolInput = { arguments?: Record<string, unknown> };
type ToolInputHandler = (input: ToolInput) => void;
type ContextHandler = (context: McpUiHostContext) => void;

const mcpApp = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  getHostContext: vi.fn(),
  callServerTool: vi.fn(),
  openLink: vi.fn(),
  requestDisplayMode: vi.fn(),
  ontoolinput: undefined as ToolInputHandler | undefined,
  onhostcontextchanged: undefined as ContextHandler | undefined,
}));
vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: vi.fn(function MockApp() {
    return mcpApp;
  }),
}));

const LINK = "https://design.example/d/board123?k=share-key";
let host: ViewHost | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  mcpApp.getHostContext.mockReturnValue({ theme: "dark", availableDisplayModes: ["inline"] });
});
afterEach(() => {
  host?.dispose();
  host = undefined;
});

describe("MCP Apps with OpenAI Extensions", () => {
  it("receives initial tool input during connection and subsequent delayed input", async () => {
    const onDiagram = vi.fn();
    const onContext = vi.fn();
    mcpApp.connect.mockImplementation(async () => {
      mcpApp.ontoolinput?.({ arguments: { diagram: LINK } });
    });
    host = createViewHost();
    await host.start({ onDiagram, onContext });
    expect(onDiagram).toHaveBeenCalledWith(LINK);
    expect(onContext).toHaveBeenCalledWith({ theme: "dark", availableDisplayModes: ["inline"] });
    mcpApp.ontoolinput?.({});
    expect(onDiagram).toHaveBeenCalledTimes(1);
    mcpApp.ontoolinput?.({ arguments: { diagram: "next-link" } });
    expect(onDiagram).toHaveBeenLastCalledWith("next-link");
  });

  it("uses the released Extensions SDK to receive a deep link", async () => {
    mcpApp.getHostContext.mockReturnValue({
      "openai/deepLink": { url: `/?diagram=${encodeURIComponent(LINK)}` },
    });
    const onDiagram = vi.fn();
    host = createViewHost();
    await host.start({ onDiagram, onContext: vi.fn() });
    expect(onDiagram).toHaveBeenCalledWith(LINK);
    mcpApp.onhostcontextchanged?.({ theme: "light" });
    expect(onDiagram).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed deep links without interrupting host updates", async () => {
    mcpApp.getHostContext.mockReturnValue({ "openai/deepLink": { url: "http://[" } });
    const onDiagram = vi.fn();
    const onContext = vi.fn();
    host = createViewHost();
    await host.start({ onDiagram, onContext });
    expect(onDiagram).not.toHaveBeenCalled();
    mcpApp.onhostcontextchanged?.({ theme: "dark" });
    expect(onContext).toHaveBeenLastCalledWith({ theme: "dark" });
  });

  it("accepts the SDK's legacy deep-link payload on later host updates", async () => {
    const onDiagram = vi.fn();
    host = createViewHost();
    await host.start({ onDiagram, onContext: vi.fn() });
    mcpApp.getHostContext.mockReturnValue({
      "openai/deepLink": { path: [], query: [["diagram", LINK]] },
    });
    mcpApp.onhostcontextchanged?.({ theme: "light" });
    expect(onDiagram).toHaveBeenLastCalledWith(LINK);
  });

  it("keeps shared tool, display, and navigation APIs working without OpenAI host capabilities", async () => {
    host = createViewHost();
    await host.start({ onDiagram: vi.fn(), onContext: vi.fn() });
    await host.callTool("render_scene", { diagram: LINK });
    expect(mcpApp.callServerTool).toHaveBeenCalledWith({
      name: "render_scene",
      arguments: { diagram: LINK },
    });
    await host.openLink(LINK);
    expect(mcpApp.openLink).toHaveBeenCalledWith({ url: LINK });
    await host.requestDisplayMode("fullscreen");
    expect(mcpApp.requestDisplayMode).toHaveBeenCalledWith({ mode: "fullscreen" });
    host.dispose();
    expect(mcpApp.close).toHaveBeenCalled();
  });

  it("preserves tool and connection failures for the view to display", async () => {
    host = createViewHost();
    mcpApp.connect.mockRejectedValue(new Error("Disconnected"));
    await expect(host.start({ onDiagram: vi.fn(), onContext: vi.fn() })).rejects.toThrow(
      "Disconnected",
    );
    mcpApp.callServerTool.mockRejectedValue(new Error("Revoked link"));
    await expect(host.callTool("render_scene", { diagram: LINK })).rejects.toThrow("Revoked link");
  });
});
