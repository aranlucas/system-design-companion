import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import {
  createViewHost,
  type OpenAiBridge,
  type OpenAiGlobals,
  type ViewHost,
  type ViewWindow,
} from "../src/view/host.ts";

type ToolInput = { arguments?: Record<string, unknown> };
type ToolInputHandler = (input: ToolInput) => void;
type ContextHandler = (context: McpUiHostContext) => void;
type GlobalsDetail = { globals: Partial<OpenAiGlobals> };

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
const appConstructor = vi.hoisted(() => vi.fn());
vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: vi.fn(function MockApp() {
    appConstructor();
    return mcpApp;
  }),
}));

class HostWindow extends EventTarget implements ViewWindow {
  openai?: OpenAiBridge;
}

class GlobalsEvent extends Event {
  detail: GlobalsDetail;

  constructor(globals: Partial<OpenAiGlobals>) {
    super("openai:set_globals");
    this.detail = { globals };
  }
}

const LINK = "https://design.example/d/board?k=share-key";
let host: ViewHost | undefined;

function chatGptWindow(overrides: Partial<OpenAiBridge> = {}) {
  const source = new HostWindow();
  const openai: OpenAiBridge = {
    callTool: vi.fn().mockResolvedValue({ structuredContent: { elements: [] } }),
    setWidgetState: vi.fn(),
    openExternal: vi.fn(),
    setOpenInAppUrl: vi.fn(),
    requestDisplayMode: vi.fn().mockResolvedValue({ mode: "fullscreen" }),
    ...overrides,
  };
  source.openai = openai;
  return { source, openai };
}

beforeEach(() => {
  vi.clearAllMocks();
  mcpApp.getHostContext.mockReturnValue({ theme: "dark", availableDisplayModes: ["inline"] });
});

afterEach(() => {
  host?.dispose();
  host = undefined;
});

describe("ChatGPT preview host", () => {
  it("uses initial input and keeps the share link in private widget state", async () => {
    const { source, openai } = chatGptWindow({ toolInput: { diagram: LINK }, theme: "dark" });
    const onDiagram = vi.fn();
    const onContext = vi.fn();
    host = createViewHost(source);
    await host.start({ onDiagram, onContext });

    expect(appConstructor).not.toHaveBeenCalled();
    expect(onDiagram).toHaveBeenCalledWith(LINK);
    expect(onContext).toHaveBeenCalledWith({
      theme: "dark",
      displayMode: undefined,
      availableDisplayModes: ["inline", "fullscreen"],
    });
    expect(openai.setWidgetState).toHaveBeenCalledWith({ privateContent: { diagram: LINK } });
  });

  it("waits for delayed input and receives theme and display updates without reloading", async () => {
    const { source } = chatGptWindow({ toolInput: null });
    const onDiagram = vi.fn();
    const onContext = vi.fn();
    host = createViewHost(source);
    await host.start({ onDiagram, onContext });
    expect(onDiagram).not.toHaveBeenCalled();

    source.dispatchEvent(new GlobalsEvent({ toolInput: { diagram: LINK } }));
    source.dispatchEvent(new GlobalsEvent({ theme: "light", displayMode: "fullscreen" }));
    expect(onDiagram).toHaveBeenCalledExactlyOnceWith(LINK);
    expect(onContext).toHaveBeenLastCalledWith({
      theme: "light",
      displayMode: "fullscreen",
      availableDisplayModes: ["inline", "fullscreen"],
    });
    host.dispose();
    source.dispatchEvent(new GlobalsEvent({ toolInput: { diagram: "another" } }));
    expect(onDiagram).toHaveBeenCalledTimes(1);
  });

  it("restores a remounted widget but gives new tool input precedence", async () => {
    const { source } = chatGptWindow({ widgetState: { privateContent: { diagram: LINK } } });
    const onDiagram = vi.fn();
    host = createViewHost(source);
    await host.start({ onDiagram, onContext: vi.fn() });
    expect(onDiagram).toHaveBeenCalledWith(LINK);
    source.dispatchEvent(new GlobalsEvent({ toolInput: { diagram: "new-link" } }));
    expect(onDiagram).toHaveBeenLastCalledWith("new-link");
    source.dispatchEvent(new GlobalsEvent({ toolInput: null }));
    expect(onDiagram).toHaveBeenCalledTimes(2);
  });

  it("routes refresh, fullscreen, and canvas navigation through the native APIs", async () => {
    const { source, openai } = chatGptWindow();
    host = createViewHost(source);
    await host.callTool("render_scene", { diagram: LINK });
    expect(openai.callTool).toHaveBeenCalledWith("render_scene", { diagram: LINK });
    expect(await host.requestDisplayMode("fullscreen")).toEqual({ mode: "fullscreen" });
    expect(openai.requestDisplayMode).toHaveBeenCalledWith({ mode: "fullscreen" });
    await host.openLink(LINK);
    expect(openai.openExternal).toHaveBeenCalledWith({ href: LINK, redirectUrl: false });
    host.setCanvasUrl(LINK);
    expect(openai.setOpenInAppUrl).toHaveBeenCalledWith({ href: LINK });
  });

  it("handles missing optional APIs and preserves tool errors", async () => {
    const { source, openai } = chatGptWindow({
      requestDisplayMode: undefined,
      openExternal: undefined,
      setOpenInAppUrl: undefined,
      setWidgetState: undefined,
    });
    const onContext = vi.fn();
    host = createViewHost(source);
    await host.start({ onDiagram: vi.fn(), onContext });
    expect(onContext.mock.calls[0][0].availableDisplayModes).toEqual(["inline"]);
    await expect(host.requestDisplayMode("fullscreen")).rejects.toThrow("does not support");
    await expect(host.openLink(LINK)).rejects.toThrow("cannot open");
    expect(() => host!.setCanvasUrl(LINK)).not.toThrow();
    vi.mocked(openai.callTool).mockRejectedValue(new Error("Disconnected"));
    await expect(host.callTool("render_scene", { diagram: LINK })).rejects.toThrow("Disconnected");
  });
});

describe("MCP Apps fallback", () => {
  it("connects and forwards input, context, and actions when ChatGPT APIs are absent", async () => {
    const onDiagram = vi.fn();
    const onContext = vi.fn();
    host = createViewHost(new HostWindow());
    await host.start({ onDiagram, onContext });
    expect(mcpApp.connect).toHaveBeenCalledTimes(1);
    expect(onContext).toHaveBeenCalledWith({ theme: "dark", availableDisplayModes: ["inline"] });
    mcpApp.ontoolinput?.({ arguments: { diagram: LINK } });
    expect(onDiagram).toHaveBeenCalledWith(LINK);
    mcpApp.onhostcontextchanged?.({ theme: "light" });
    expect(onContext).toHaveBeenLastCalledWith({ theme: "light" });
    await host.callTool("render_scene", { diagram: LINK });
    expect(mcpApp.callServerTool).toHaveBeenCalledWith({
      name: "render_scene",
      arguments: { diagram: LINK },
    });
    await host.openLink(LINK);
    expect(mcpApp.openLink).toHaveBeenCalledWith({ url: LINK });
    await host.requestDisplayMode("inline");
    expect(mcpApp.requestDisplayMode).toHaveBeenCalledWith({ mode: "inline" });
    host.dispose();
    expect(mcpApp.close).toHaveBeenCalled();
  });
});
