import { App, type McpUiDisplayMode, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";

type ToolArguments = Record<string, unknown>;
type ToolContent = { type: string; text?: string };
export type ViewToolResult = {
  isError?: boolean;
  content?: ToolContent[];
  structuredContent?: unknown;
};
type DisplayModeRequest = { mode: McpUiDisplayMode };
type DisplayModeResult = { mode: McpUiDisplayMode };
type ExternalLink = { href: string; redirectUrl: false };
type CanvasLink = { href: string };
type PrivateWidgetContent = { diagram?: string };
type WidgetState = { privateContent?: PrivateWidgetContent };

export interface OpenAiGlobals {
  toolInput?: ToolArguments | null;
  widgetState?: WidgetState | null;
  theme?: "light" | "dark";
  displayMode?: McpUiDisplayMode;
}

/** Only the documented ChatGPT APIs used by the diagram preview. */
export interface OpenAiBridge extends OpenAiGlobals {
  callTool: (name: string, args: ToolArguments) => Promise<ViewToolResult>;
  requestDisplayMode?: (request: DisplayModeRequest) => Promise<DisplayModeResult>;
  openExternal?: (link: ExternalLink) => void;
  setWidgetState?: (state: WidgetState) => void;
  setOpenInAppUrl?: (link: CanvasLink) => void;
}

export interface ViewWindow extends EventTarget {
  openai?: OpenAiBridge;
}

declare global {
  interface Window {
    openai?: OpenAiBridge;
  }
}

type GlobalsDetail = { globals?: Partial<OpenAiGlobals> };
type GlobalsEvent = Event & { detail?: GlobalsDetail };
export type ViewHostCallbacks = {
  onDiagram: (diagram: string) => void;
  onContext: (context: McpUiHostContext) => void;
};

export interface ViewHost {
  start: (callbacks: ViewHostCallbacks) => Promise<void>;
  dispose: () => void;
  callTool: (name: string, args: ToolArguments) => Promise<ViewToolResult>;
  openLink: (url: string) => Promise<void>;
  requestDisplayMode: (mode: McpUiDisplayMode) => Promise<DisplayModeResult>;
  setCanvasUrl: (url: string) => void;
}

function createOpenAiHost(source: ViewWindow, openai: OpenAiBridge): ViewHost {
  let globals: OpenAiGlobals = {
    toolInput: openai.toolInput,
    widgetState: openai.widgetState,
    theme: openai.theme,
    displayMode: openai.displayMode,
  };
  let callbacks: ViewHostCallbacks | undefined;
  let diagram: string | undefined;

  function publish() {
    callbacks?.onContext({
      theme: globals.theme,
      displayMode: globals.displayMode,
      availableDisplayModes: openai.requestDisplayMode ? ["inline", "fullscreen"] : ["inline"],
    });
    // Approval-gated tool arguments can arrive after the widget mounts.
    const link = globals.toolInput?.diagram ?? globals.widgetState?.privateContent?.diagram;
    if (typeof link === "string" && link && link !== diagram) {
      diagram = link;
      // Keep the share key in widget-only state, outside model-visible content.
      globals.widgetState = {
        ...globals.widgetState,
        privateContent: { ...globals.widgetState?.privateContent, diagram },
      };
      openai.setWidgetState?.(globals.widgetState);
      callbacks?.onDiagram(diagram);
    }
  }

  function onGlobals(event: Event) {
    const update = (event as GlobalsEvent).detail?.globals;
    if (!update) return;
    globals = { ...globals, ...update };
    publish();
  }

  return {
    async start(next) {
      callbacks = next;
      source.addEventListener("openai:set_globals", onGlobals);
      publish();
    },
    dispose() {
      source.removeEventListener("openai:set_globals", onGlobals);
      callbacks = undefined;
    },
    callTool: (name, args) => openai.callTool(name, args),
    async openLink(url) {
      if (!openai.openExternal) throw new Error("This host cannot open the canvas link.");
      openai.openExternal({ href: url, redirectUrl: false });
    },
    async requestDisplayMode(mode) {
      if (!openai.requestDisplayMode) throw new Error("This host does not support full screen.");
      return openai.requestDisplayMode({ mode });
    },
    setCanvasUrl(url) {
      openai.setOpenInAppUrl?.({ href: url });
    },
  };
}

function createMcpAppsHost(): ViewHost {
  const app = new App({ name: "diagram-view", version: "1.1.0" });
  return {
    async start(callbacks) {
      app.ontoolinput = ({ arguments: args }) => {
        if (typeof args?.diagram === "string") callbacks.onDiagram(args.diagram);
      };
      app.onhostcontextchanged = callbacks.onContext;
      await app.connect();
      const context = app.getHostContext();
      if (context) callbacks.onContext(context);
    },
    dispose() {
      void app.close();
    },
    callTool: (name, args) => app.callServerTool({ name, arguments: args }),
    async openLink(url) {
      await app.openLink({ url });
    },
    requestDisplayMode: (mode) => app.requestDisplayMode({ mode }),
    setCanvasUrl() {},
  };
}

/** This branch deliberately tries the ChatGPT bridge wherever it is available. */
export function createViewHost(source: ViewWindow): ViewHost {
  return typeof source.openai?.callTool === "function"
    ? createOpenAiHost(source, source.openai)
    : createMcpAppsHost();
}
