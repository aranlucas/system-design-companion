// MCP App view shown for get_scene: a live-ish picture of the shared canvas inside the chat.
import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import type { El } from "../shared/protocol.ts";
import { renderScene } from "./render.ts";

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

const app = new App({ name: "diagram-view", version: "1.0.0" });

let diagram: string | undefined;
let data: SceneData | undefined;
let signature = "";
let displayMode = "inline";
let poll: ReturnType<typeof setInterval> | undefined;

async function load() {
  if (!diagram) return;
  refreshBtn.disabled = true;
  try {
    const res = await app.callServerTool({ name: "render_scene", arguments: { diagram } });
    if (res.isError) throw new Error(res.content.find((c) => c.type === "text")?.text ?? "error");
    data = res.structuredContent as unknown as SceneData;
    const sig = data.elements.map((e) => `${e.id}:${e.version}`).join(",");
    if (sig !== signature) {
      signature = sig;
      renderScene(svg, data.elements);
    }
    title.textContent = data.name;
    openBtn.hidden = false;
    const nodes = data.elements.filter((e) => e.type !== "text" && e.type !== "arrow").length;
    status.textContent = data.elements.length
      ? `${nodes} shapes · updated ${new Date().toLocaleTimeString([], { timeStyle: "short" })}`
      : "The canvas is empty.";
  } catch (e) {
    status.textContent = `Couldn't load the diagram: ${(e as Error).message}`;
  } finally {
    refreshBtn.disabled = false;
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

app.ontoolinput = ({ arguments: args }) => {
  const link = args?.diagram;
  if (typeof link === "string" && link !== diagram) {
    diagram = link;
    void load();
  }
};

function applyContext(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
    document.body.dataset.theme = ctx.theme;
  }
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.displayMode) setDisplayMode(ctx.displayMode);
}
app.onhostcontextchanged = applyContext;

refreshBtn.addEventListener("click", () => void load());
openBtn.addEventListener("click", () => {
  if (data) void app.openLink({ url: data.url });
});
fullBtn.addEventListener("click", async () => {
  const want = displayMode === "fullscreen" ? "inline" : "fullscreen";
  const { mode } = await app.requestDisplayMode({ mode: want });
  setDisplayMode(mode);
});

async function start() {
  await app.connect();
  const ctx = app.getHostContext();
  if (ctx) applyContext(ctx);
  fullBtn.hidden = !ctx?.availableDisplayModes?.includes("fullscreen");
}
void start();
