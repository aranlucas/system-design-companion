import { App, type McpUiDisplayMode, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";

type ToolArguments = Record<string, unknown>;
type ToolContent = { type: string; text?: string };
export type ViewToolResult = {
  isError?: boolean;
  content?: ToolContent[];
  structuredContent?: unknown;
};
type DisplayModeResult = { mode: McpUiDisplayMode };
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
}

/** MCP Apps handles shared UI; the Extensions SDK supplies OpenAI deep links. */
export function createViewHost(): ViewHost {
  const app = new App(
    { name: "diagram-view", version: "1.2.0" },
    { availableDisplayModes: ["inline", "fullscreen"] },
  );
  const extensions = new OpenAIExtensions(app);
  let lastDeepLink: string | undefined;

  function applyDeepLink(callbacks: ViewHostCallbacks) {
    const deepLink = extensions.deepLink.getCurrent();
    if (!deepLink || deepLink.url === lastDeepLink) return;
    lastDeepLink = deepLink.url;
    try {
      const diagram = new URL(deepLink.url, "https://system-design.invalid").searchParams.get(
        "diagram",
      );
      if (diagram) callbacks.onDiagram(diagram);
    } catch {
      // Ignore malformed host navigation without interrupting the shared bridge.
    }
  }

  return {
    async start(callbacks) {
      app.ontoolinput = ({ arguments: args }) => {
        if (typeof args?.diagram === "string") callbacks.onDiagram(args.diagram);
      };
      app.onhostcontextchanged = (context) => {
        callbacks.onContext(context);
        applyDeepLink(callbacks);
      };
      await app.connect();
      const context = app.getHostContext();
      if (context) callbacks.onContext(context);
      applyDeepLink(callbacks);
    },
    dispose() {
      void app.close();
    },
    callTool: (name, args) => app.callServerTool({ name, arguments: args }),
    async openLink(url) {
      await app.openLink({ url });
    },
    requestDisplayMode: (mode) => app.requestDisplayMode({ mode }),
  };
}
