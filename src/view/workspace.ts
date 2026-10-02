import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { OpenAIExtensions } from "@openai/mcp-extensions/app";
import { embeddedCanvasUrl, isEmbeddedCanvasMessage } from "../shared/embedded-canvas.ts";

type DiagramOption = { name: string; diagram: string };
type LibraryPage = {
  diagrams: DiagramOption[];
  nextCursor: string | null;
  activeDiagram?: string;
  activeName?: string;
};
type JoinedScene = { diagram?: string };
type WorkspaceResult = { structuredContent?: unknown; isError?: boolean };

const app = new App(
  { name: "system-design-workspace", version: "1.0.0" },
  { availableDisplayModes: ["fullscreen"] },
  { autoResize: false },
);
const extensions = new OpenAIExtensions(app);
const origin = document.querySelector<HTMLMetaElement>('meta[name="canvas-origin"]')!.content;
const select = document.getElementById("diagrams") as HTMLSelectElement;
const frame = document.getElementById("canvas") as HTMLIFrameElement;
const empty = document.getElementById("empty")!;
const status = document.getElementById("status")!;
const refresh = document.getElementById("refresh") as HTMLButtonElement;
const more = document.getElementById("more") as HTMLButtonElement;
const library = document.getElementById("library") as HTMLButtonElement;
const input = document.getElementById("link") as HTMLInputElement;
let activeDiagram: string | undefined;
let activeName = "Shared diagram";
let cursor: string | null = null;
let connected = false;
let editorReady = false;
let theme: "light" | "dark" = "light";
let lastDeepLink: string | undefined;
let navigationVersion = 0;

function errorMessage(error: unknown) {
  status.textContent = error instanceof Error ? error.message : "Could not complete this action.";
}

async function publishContext(selectedElementIds: string[] = []) {
  const params = {
    content: [
      {
        type: "text" as const,
        text: activeDiagram
          ? `Active system design diagram: ${select.selectedOptions[0]?.textContent ?? "Shared diagram"}.`
          : "The system design workspace is showing the diagram library.",
      },
    ],
    structuredContent: { diagram: activeDiagram ?? null, selectedElementIds },
  };
  if (extensions.modelContext) await extensions.modelContext.update(params);
  else if (app.getHostCapabilities()?.updateModelContext) await app.updateModelContext(params);
  else return false;
  return true;
}

function openDiagram(diagram: string, name?: string) {
  const url = embeddedCanvasUrl(diagram, origin, location.origin);
  navigationVersion++;
  activeName =
    name ??
    Array.from(select.options).find((option) => option.value === diagram)?.text ??
    "Shared diagram";
  addDiagram({ diagram, name: activeName });
  activeDiagram = diagram;
  editorReady = false;
  frame.src = url;
  frame.hidden = false;
  empty.hidden = true;
  library.hidden = false;
  select.value = diagram;
  status.textContent = "Canvas open. Edits sync with your browser and ChatGPT.";
  if (connected) void publishContext().catch(errorMessage);
}

function addDiagram(option: DiagramOption) {
  if (Array.from(select.options).some((existing) => existing.value === option.diagram)) return;
  const node = document.createElement("option");
  node.value = option.diagram;
  node.textContent = option.name;
  select.append(node);
}

function receiveLibrary(result: WorkspaceResult, append = false) {
  if (result.isError) throw new Error("Could not load your diagrams.");
  const page = result.structuredContent as LibraryPage | undefined;
  if (
    !page ||
    !Array.isArray(page.diagrams) ||
    !page.diagrams.every(
      (item) => item && typeof item.name === "string" && typeof item.diagram === "string",
    ) ||
    (page.nextCursor !== null && typeof page.nextCursor !== "string") ||
    (page.activeDiagram !== undefined && typeof page.activeDiagram !== "string") ||
    (page.activeName !== undefined && typeof page.activeName !== "string")
  )
    throw new Error("The server returned an invalid diagram library.");
  if (!append) select.replaceChildren(new Option("Choose a diagram", ""));
  for (const diagram of page.diagrams) addDiagram(diagram);
  cursor = page.nextCursor;
  more.hidden = !cursor;
  if (page.activeDiagram) openDiagram(page.activeDiagram, page.activeName);
  else if (activeDiagram) {
    addDiagram({ diagram: activeDiagram, name: activeName });
    select.value = activeDiagram;
  } else
    status.textContent = page.diagrams.length
      ? "Choose a diagram to start."
      : "Your library is empty.";
}

async function loadLibrary(append = false) {
  refresh.disabled = true;
  more.disabled = true;
  try {
    const result = await app.callServerTool({
      name: "list_diagrams",
      arguments: append && cursor ? { cursor } : {},
    });
    receiveLibrary(result, append);
  } catch (error) {
    errorMessage(error);
  } finally {
    refresh.disabled = false;
    more.disabled = false;
  }
}

async function joinDiagram(diagram: string) {
  // Check the origin before any tool call or iframe navigation.
  embeddedCanvasUrl(diagram, origin, location.origin);
  const version = ++navigationVersion;
  const result = await app.callServerTool({ name: "join_session", arguments: { diagram } });
  if (version !== navigationVersion) return;
  if (result.isError)
    throw new Error(
      result.content.find((item) => item.type === "text")?.text ?? "Could not join the diagram.",
    );
  const data = result.structuredContent as JoinedScene | undefined;
  if (typeof data?.diagram !== "string") throw new Error("The server returned an invalid diagram.");
  addDiagram({ name: data.diagram, diagram });
  openDiagram(diagram);
}

function applyDeepLink() {
  const link = extensions.deepLink.getCurrent()?.url;
  if (!link || link === lastDeepLink) return;
  lastDeepLink = link;
  try {
    const diagram = new URL(link, origin).searchParams.get("diagram");
    if (diagram) void joinDiagram(diagram).catch(errorMessage);
  } catch (error) {
    errorMessage(error);
  }
}

function sendTheme() {
  if (!editorReady) return;
  frame.contentWindow?.postMessage({ type: "system-design.theme", theme }, origin);
}

function applyContext(context: McpUiHostContext) {
  if (context.theme) {
    theme = context.theme;
    applyDocumentTheme(theme);
    sendTheme();
  }
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (connected) applyDeepLink();
}

app.ontoolresult = (result) => {
  try {
    receiveLibrary(result);
  } catch (error) {
    errorMessage(error);
  }
};
app.onhostcontextchanged = applyContext;
select.addEventListener("change", () => {
  if (select.value) {
    try {
      openDiagram(select.value);
    } catch (error) {
      errorMessage(error);
    }
  }
});
refresh.addEventListener("click", () => void loadLibrary());
more.addEventListener("click", () => void loadLibrary(true));

function showLibrary() {
  navigationVersion++;
  activeDiagram = undefined;
  editorReady = false;
  frame.removeAttribute("src");
  frame.hidden = true;
  empty.hidden = false;
  library.hidden = true;
  select.value = "";
  status.textContent = "Choose a diagram or open a shared link.";
  void publishContext().catch(errorMessage);
}
library.addEventListener("click", showLibrary);
document.getElementById("join")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void joinDiagram(input.value.trim()).catch(errorMessage);
});
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (
    !activeDiagram ||
    event.source !== frame.contentWindow ||
    event.origin !== origin ||
    !isEmbeddedCanvasMessage(event.data)
  )
    return;
  if (event.data.type === "system-design.library") showLibrary();
  else if (event.data.type === "system-design.ready") {
    editorReady = true;
    sendTheme();
  } else
    void publishContext(event.data.selectedElementIds)
      .then((attached) => {
        status.textContent = attached
          ? "Selection attached to chat."
          : "Open a conversation panel to attach a selection.";
        return undefined;
      })
      .catch(errorMessage);
});
window.addEventListener("pagehide", () => void app.close());

async function start() {
  await app.connect();
  connected = true;
  const context = app.getHostContext();
  if (context) applyContext(context);
  if (
    context?.displayMode !== "fullscreen" &&
    context?.availableDisplayModes?.includes("fullscreen")
  )
    await app.requestDisplayMode({ mode: "fullscreen" });
  if (activeDiagram) await publishContext();
  applyDeepLink();
}
void start().catch(errorMessage);
