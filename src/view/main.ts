// MCP App view shown for get_scene: a live-ish picture of the shared canvas inside the chat.
import {
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { El } from "../shared/protocol.ts";
import { renderScene } from "./render.ts";
import { createViewHost } from "./host.ts";

interface SceneData {
  name: string;
  url: string;
  elements: El[];
}

const POLL_MS = 4000;

const byId = (id: string) => document.getElementById(id)!;
const title = byId("title");
const status = byId("status");
const svg = byId("scene") as unknown as SVGSVGElement;
const refreshBtn = byId("refresh") as HTMLButtonElement;
const openBtn = byId("open") as HTMLButtonElement;
const fullBtn = byId("full") as HTMLButtonElement;

const host = createViewHost(window);

let diagram: string | undefined;
let data: SceneData | undefined;
let signature = "";
let displayMode = "inline";
let poll: ReturnType<typeof setInterval> | undefined;
let requestVersion = 0;
let pendingDiagram: string | undefined;

async function load() {
  if (!diagram || pendingDiagram === diagram) return;
  const request = ++requestVersion;
  const requestedDiagram = diagram;
  pendingDiagram = diagram;
  refreshBtn.disabled = true;
  try {
    const res = await host.callTool("render_scene", { diagram: requestedDiagram });
    if (request !== requestVersion) return;
    if (res.isError) throw new Error(res.content?.find((c) => c.type === "text")?.text ?? "error");
    const next = res.structuredContent as SceneData | undefined;
    if (
      !next ||
      typeof next.name !== "string" ||
      typeof next.url !== "string" ||
      !Array.isArray(next.elements)
    )
      throw new Error("The host returned an invalid scene.");
    data = next;
    const sig = data.elements.map((e) => `${e.id}:${e.version}`).join(",");
    if (sig !== signature) {
      signature = sig;
      renderScene(svg, data.elements);
    }
    title.textContent = data.name;
    host.setCanvasUrl(data.url);
    openBtn.hidden = false;
    const nodes = data.elements.filter((e) => e.type !== "text" && e.type !== "arrow").length;
    status.textContent = data.elements.length
      ? `${nodes} shapes · updated ${new Date().toLocaleTimeString([], { timeStyle: "short" })}`
      : "The canvas is empty.";
  } catch (e) {
    if (request === requestVersion)
      status.textContent = `Couldn't load the diagram: ${(e as Error).message}`;
  } finally {
    if (request === requestVersion) {
      pendingDiagram = undefined;
      refreshBtn.disabled = false;
    }
  }
}

function setDisplayMode(mode: string) {
  displayMode = mode;
  document.body.dataset.mode = mode;
  fullBtn.textContent = mode === "fullscreen" ? "Exit full screen" : "Full screen";
  // Follow the canvas live only while it has the user's full attention.
  clearInterval(poll);
  if (mode === "fullscreen") poll = setInterval(() => void load(), POLL_MS);
}

function setDiagram(link: string) {
  if (link !== diagram) {
    diagram = link;
    data = undefined;
    signature = "";
    svg.replaceChildren();
    title.textContent = "Diagram";
    status.textContent = "Loading…";
    openBtn.hidden = true;
    void load();
  }
}

function applyContext(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    document.body.dataset.theme = ctx.theme;
  }
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.displayMode) setDisplayMode(ctx.displayMode);
  if (ctx.availableDisplayModes) fullBtn.hidden = !ctx.availableDisplayModes.includes("fullscreen");
}

refreshBtn.addEventListener("click", () => void load());
openBtn.addEventListener("click", async () => {
  try {
    if (data) await host.openLink(data.url);
  } catch (error) {
    status.textContent = (error as Error).message;
  }
});
fullBtn.addEventListener("click", async () => {
  const want = displayMode === "fullscreen" ? "inline" : "fullscreen";
  try {
    const { mode } = await host.requestDisplayMode(want);
    setDisplayMode(mode);
  } catch (error) {
    status.textContent = (error as Error).message;
  }
});

window.addEventListener("pagehide", () => {
  clearInterval(poll);
  host.dispose();
});
void host.start({ onDiagram: setDiagram, onContext: applyContext }).catch((error: Error) => {
  status.textContent = `Couldn't connect to the host: ${error.message}`;
});
