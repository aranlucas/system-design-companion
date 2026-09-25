import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer, type McpRequestContext } from "@modelcontextprotocol/server";
import { z } from "zod";
import { COMPONENT_KINDS, COMPONENTS } from "../shared/components.ts";
import { SHAPES, type Op } from "./scene.ts";
import { RUBRIC } from "./rubric.ts";
import {
  createDiagram,
  listTemplates,
  parseLink,
  room,
  saveAsTemplate,
  shareLink,
  verifyKey,
} from "./store.ts";
import { VIEW_URI, viewHtml } from "./view.ts";

/** Tool and prompt arguments, as their input schemas validate them. */
type DiagramArgs = { diagram: string };
type CreateDiagramArgs = { name: string; template?: string };
type GetSceneArgs = DiagramArgs & { format?: "graph" | "raw" };
type ScreenshotArgs = DiagramArgs & { element_ids?: string[] };
type PatchArgs = DiagramArgs & { ops: Op[]; summary?: string };
type FrameArgs = DiagramArgs & { frame?: string };
type LayoutArgs = FrameArgs & { direction?: "LR" | "TB" };
type MermaidArgs = DiagramArgs & { source: string };
type NameArgs = DiagramArgs & { name: string };
type RestoreArgs = DiagramArgs & { snapshot_id: string };
type TemplateArgs = NameArgs & { description?: string };
type FocusArgs = DiagramArgs & {
  targets: string[];
  mode: "focus" | "point";
  gesture: "dot" | "heart";
};
type ReviewArgs = { focus?: string };
type EstimateArgs = { dau?: string; notes?: string };

const INSTRUCTIONS = `Collaborative Excalidraw canvas for system design. A human (and possibly an interviewer) edits the same canvas live in a browser tab.
Workflow:
1. Every diagram tool takes \`diagram\`: the canvas share link (…/d/<id>?k=<key>). If you don't have one, ask the user for it, or call create_diagram. Call join_session once to validate it and get an overview, then keep passing the same link.
2. Read before you write: get_scene (semantic graph) and get_selection ("this"/"these" means the user's selection). Use get_screenshot when layout, freehand sketches, or visual clarity matter.
3. Edit with apply_patch: batch related ops in one call. Address nodes by id, unique label, or a ref defined earlier in the same batch. Use placement hints instead of coordinates. Prefer add_node with a standard \`kind\` (sql_db, cache, queue, load_balancer, …) so the agent uses the same icons as the human library. An explicit shape overrides the icon. Include a short summary of the user’s requested change in apply_patch so version names reflect their feedback. Every batch also nudges all open subscribers to the changed components. Every batch is auto-snapshotted and tinted violet, so the user can undo with restore.
4. Structure: put content inside frames (pass \`frame\`, or place relative to something already in the frame). Keep labels short; notes are sticky notes that wrap and grow to fit. Use tidy when things look cluttered; use layout only when asked to re-arrange.
5. Use focus_view to bring a frame or component into the current subscriber’s view, or mode=point for a temporary laser-style marker without panning. Neither changes the diagram.
6. When asked for feedback, reply in chat. Only annotate the canvas (add_note) when asked. Keep labels short; put detail in notes.`;

const target = z
  .string()
  .describe("element id, unique label (case-insensitive), or a ref from this batch");
const placement = z
  .object({
    right_of: target.optional(),
    left_of: target.optional(),
    below: target.optional(),
    above: target.optional(),
    near: target.optional().describe("first free side of this element"),
    at: z.object({ x: z.number(), y: z.number() }).optional(),
    gap: z.number().optional().describe("px, default 100"),
  })
  .describe("where to put it; overlaps are nudged away automatically");
const color = z
  .string()
  .describe("fill: white gray red pink violet blue cyan green yellow orange, or a hex color");
const textColor = z
  .string()
  .describe(
    "color of the label or note text: black gray red pink violet blue cyan green yellow orange, or a hex color",
  );

const opSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add_node"),
    ref: z.string().optional().describe("name to refer to this node later in the same batch"),
    kind: z
      .enum(COMPONENT_KINDS)
      .optional()
      .describe(
        "standard component: draws its editable system design icon with a label and role colour (see components://catalog)",
      ),
    label: z
      .string()
      .optional()
      .describe("required unless kind is given; e.g. kind=sql_db, label='Orders DB'"),
    shape: z
      .enum(SHAPES)
      .optional()
      .describe("rectangle (default: services), ellipse (datastores/clients), diamond (decisions)"),
    color: color.optional(),
    text_color: textColor.optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    place: placement.optional(),
    frame: target.optional().describe("frame to put the node in"),
  }),
  z.object({
    op: z.literal("connect"),
    from: target,
    to: target,
    label: z.string().optional(),
    text_color: textColor.optional(),
    dashed: z.boolean().optional().describe("async / optional / replication flows"),
    bidirectional: z.boolean().optional(),
  }),
  z.object({ op: z.literal("disconnect"), from: target, to: target }),
  z.object({
    op: z.literal("update"),
    target,
    label: z.string().optional().describe("new label (frame name / note text for those types)"),
    color: color.optional(),
    text_color: textColor.optional(),
    shape: z.enum(SHAPES).optional(),
    dashed: z.boolean().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    move: placement.optional(),
    frame: target.nullable().optional().describe("move into this frame; null removes from frame"),
  }),
  z.object({ op: z.literal("remove"), target }),
  z.object({
    op: z.literal("add_frame"),
    ref: z.string().optional(),
    name: z.string(),
    contains: z.array(target).optional().describe("wrap these existing elements"),
    place: placement.optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }),
  z.object({
    op: z.literal("add_note"),
    ref: z.string().optional(),
    text: z.string().describe("a sticky note's text; it wraps inside the note, which grows to fit"),
    place: placement.optional(),
    frame: target.optional(),
    size: z.enum(["s", "m", "l"]).optional(),
    text_color: textColor.optional(),
  }),
]);

const diagramArg = z
  .string()
  .describe("the diagram's share link (…/d/<id>?k=<key>) as given by the user or create_diagram");

const text = (v: unknown) => ({
  content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v) }],
});
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: msg }], isError: true });

const guard =
  <A>(fn: (a: A) => Promise<unknown>) =>
  async (a: A) => {
    try {
      const out = await fn(a);
      return out && typeof out === "object" && "content" in out
        ? (out as ReturnType<typeof text>)
        : text(out);
    } catch (e) {
      return fail((e as Error).message);
    }
  };

const userMsg = (t: string) => ({
  messages: [{ role: "user" as const, content: { type: "text" as const, text: t } }],
});

export function buildServer(env: Env, ctx: McpRequestContext) {
  const url = new URL(ctx.requestInfo?.url ?? "http://localhost/mcp");
  const origin = url.origin;

  const server = new McpServer(
    {
      name: "system-design",
      title: "System Design",
      version: "0.2.0",
      websiteUrl: origin,
      icons: [
        {
          src: `${origin}/icons/system-design-128.png`,
          mimeType: "image/png",
          sizes: ["128x128"],
        },
        {
          src: `${origin}/icons/system-design-512.png`,
          mimeType: "image/png",
          sizes: ["512x512"],
        },
      ],
    },
    { instructions: INSTRUCTIONS, capabilities: { tools: {}, prompts: {}, resources: {} } },
  );

  /** Resolve a share link to a verified diagram. The link is the client-held handle; nothing is stored server-side. */
  async function pick(link: string) {
    const parsed = parseLink(link);
    if (!parsed) throw new Error("`diagram` must be the share link, e.g. https://…/d/<id>?k=<key>");
    const row = await verifyKey(env, parsed.id, parsed.key);
    if (!row) throw new Error("invalid or revoked diagram link");
    return row;
  }

  // ---------- sessions ----------

  server.registerTool(
    "join_session",
    {
      description:
        "Validate a diagram share link and get an overview. Pass the same link as `diagram` to every other tool.",
      inputSchema: z.object({ diagram: diagramArg }),
      annotations: { readOnlyHint: true },
    },
    guard(async ({ diagram }: DiagramArgs) => {
      const row = await pick(diagram);
      const info = await room(env, row.id).info();
      return {
        diagram: row.name,
        elements: info.elements,
        tabsOpen: info.tabs,
        note: info.tabs
          ? "The user has the canvas open."
          : "No canvas tab is open; screenshots and mermaid import need one.",
      };
    }),
  );

  server.registerTool(
    "create_diagram",
    {
      description:
        "Create a new diagram (optionally from a template), join it, and return its share link for the user to open.",
      inputSchema: z.object({
        name: z.string(),
        template: z.string().optional().describe("template id from list_templates"),
      }),
    },
    guard(async ({ name, template }: CreateDiagramArgs) => {
      const d = await createDiagram(env, name, template);
      const link = shareLink(origin, d.id, d.key);
      return {
        name: d.name,
        diagram: link,
        note: "Pass this link as `diagram` to other tools, and give it to the user to open.",
      };
    }),
  );

  // ---------- perception ----------

  // Hosts that support MCP Apps (Claude Desktop/web, ChatGPT, VS Code…) render VIEW_URI next to
  // this tool's result; others just get the text. The view fetches pixels via render_scene.
  registerAppTool(
    server,
    "get_scene",
    {
      _meta: { ui: { resourceUri: VIEW_URI } },
      description:
        "Read the canvas. format=graph (default): frames, nodes, edges (arrows resolved to node labels; inferred=true if the arrow only touches a node), standalone notes, and unstructured sketches. selected=true marks the user's current selection. format=raw: Excalidraw elements.",
      inputSchema: z.object({ diagram: diagramArg, format: z.enum(["graph", "raw"]).optional() }),
      annotations: { readOnlyHint: true },
    },
    guard(async ({ diagram, format }: GetSceneArgs) => {
      const d = await pick(diagram);
      return format === "raw" ? room(env, d.id).getRaw() : room(env, d.id).getGraph();
    }),
  );

  registerAppTool(
    server,
    "render_scene",
    {
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["app"] } },
      description: "Elements to draw in the diagram view (called by the view, not the model).",
      inputSchema: z.object({ diagram: diagramArg }),
      annotations: { readOnlyHint: true },
    },
    guard(async ({ diagram }: DiagramArgs) => {
      const d = await pick(diagram);
      const elements = await room(env, d.id).getRaw();
      return {
        content: [{ type: "text" as const, text: `${elements.length} elements` }],
        structuredContent: { name: d.name, url: diagram, elements },
      };
    }),
  );

  registerAppResource(
    server,
    "Diagram view",
    VIEW_URI,
    { description: "Hand-drawn picture of the shared canvas" },
    async () => ({
      contents: [
        {
          uri: VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await viewHtml(env, origin),
          _meta: { ui: { prefersBorder: true, csp: { resourceDomains: [origin] } } },
        },
      ],
    }),
  );

  server.registerTool(
    "get_selection",
    {
      description:
        "What the user currently has selected in their canvas tab (and their viewport). Use this to resolve 'this', 'these', 'here'.",
      inputSchema: z.object({ diagram: diagramArg }),
      annotations: { readOnlyHint: true },
    },
    guard(async ({ diagram }: DiagramArgs) => room(env, (await pick(diagram)).id).getSelection()),
  );

  server.registerTool(
    "get_screenshot",
    {
      description:
        "PNG of the canvas rendered by the user's open tab. Use for visual review, freehand sketches, or checking layout after edits.",
      inputSchema: z.object({
        diagram: diagramArg,
        element_ids: z
          .array(z.string())
          .optional()
          .describe(
            "limit to these elements (e.g. a frame and its contents); default whole canvas",
          ),
      }),
      annotations: { readOnlyHint: true },
    },
    guard(async ({ diagram, element_ids }: ScreenshotArgs) => {
      const shot = await room(env, (await pick(diagram)).id).screenshot(element_ids);
      return { content: [{ type: "image" as const, data: shot.base64, mimeType: shot.mimeType }] };
    }),
  );

  // ---------- editing ----------

  server.registerTool(
    "apply_patch",
    {
      description:
        "Apply a batch of semantic edits. Ops run in order; later ops can use refs from earlier ones. A snapshot is taken first (undo with restore). Returns per-op results; failed ops don't abort the batch.",
      inputSchema: z.object({
        diagram: diagramArg,
        ops: z.array(opSchema).min(1),
        summary: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .optional()
          .describe(
            "Short description of the user's requested change, e.g. 'Separate device ingestion from analytics'. Use the user's feedback and intent, not tool names. Used to name the pre-edit version; omit the 'Before:' prefix.",
          ),
      }),
    },
    guard(async ({ diagram, ops, summary }: PatchArgs) =>
      room(env, (await pick(diagram)).id).applyPatch(ops, "agent", summary),
    ),
  );

  server.registerTool(
    "tidy",
    {
      description:
        "Non-destructive cleanup: attach loose items to the frame they sit in, wrap over-long notes, snap nearly-aligned boxes and even out their gaps, push apart overlaps with minimal moves (groups move whole), fit frames and separate overlapping frames. Never changes connections, labels or relative order. Snapshotted first when anything changes; returns counts of what it did. (apply_patch already tidies the frames it touches.)",
      inputSchema: z.object({
        diagram: diagramArg,
        frame: z.string().optional().describe("only tidy this frame; default: whole diagram"),
      }),
    },
    guard(async ({ diagram, frame }: FrameArgs) => room(env, (await pick(diagram)).id).tidy(frame)),
  );

  server.registerTool(
    "layout",
    {
      description:
        "Full re-layout (layered graph) that moves every node in scope. Only when the user explicitly asks to re-arrange; prefer tidy for cleanup.",
      inputSchema: z.object({
        diagram: diagramArg,
        direction: z.enum(["LR", "TB"]).optional(),
        frame: z
          .string()
          .optional()
          .describe("only lay out this frame's nodes; default: all nodes not in a frame"),
      }),
    },
    guard(async ({ diagram, direction, frame }: LayoutArgs) =>
      room(env, (await pick(diagram)).id).layout(direction ?? "LR", frame),
    ),
  );

  server.registerTool(
    "import_mermaid",
    {
      description:
        "Draw a Mermaid flowchart/sequence diagram onto free canvas space (rendered by the user's tab). Good for sketching many nodes at once.",
      inputSchema: z.object({ diagram: diagramArg, source: z.string() }),
    },
    guard(async ({ diagram, source }: MermaidArgs) =>
      room(env, (await pick(diagram)).id).importMermaid(source),
    ),
  );

  // ---------- versions & templates ----------

  server.registerTool(
    "snapshot",
    {
      description: "Save a named version of the diagram.",
      inputSchema: z.object({ diagram: diagramArg, name: z.string() }),
    },
    guard(async ({ diagram, name }: NameArgs) =>
      room(env, (await pick(diagram)).id).snapshot(name, "named"),
    ),
  );

  server.registerTool(
    "list_snapshots",
    {
      description: "Versions, newest first (auto = taken before each agent edit).",
      inputSchema: z.object({ diagram: diagramArg }),
      annotations: { readOnlyHint: true },
    },
    guard(async ({ diagram }: DiagramArgs) => room(env, (await pick(diagram)).id).listSnapshots()),
  );

  server.registerTool(
    "restore",
    {
      description:
        "Restore the diagram to a snapshot (itself snapshotted first, so restore is undoable).",
      inputSchema: z.object({ diagram: diagramArg, snapshot_id: z.string() }),
    },
    guard(async ({ diagram, snapshot_id }: RestoreArgs) =>
      room(env, (await pick(diagram)).id).restore(snapshot_id),
    ),
  );

  server.registerTool(
    "list_templates",
    {
      description: "Starter layouts usable with create_diagram.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    guard(async () => listTemplates(env)),
  );

  server.registerTool(
    "save_as_template",
    {
      description: "Save the current diagram as a reusable template.",
      inputSchema: z.object({
        diagram: diagramArg,
        name: z.string(),
        description: z.string().optional(),
      }),
    },
    guard(async ({ diagram, name, description }: TemplateArgs) =>
      saveAsTemplate(env, (await pick(diagram)).id, name, description),
    ),
  );

  server.registerTool(
    "focus_view",
    {
      description:
        "Direct the most recently active subscriber's open diagram tab to components or a frame. mode=focus pans/zooms and briefly highlights the target; mode=point shows a temporary laser-style marker without moving the viewport. Returns visible=false if a point target is offscreen (use focus to bring it into view). Does not change the diagram, selection, or history. Requires an open tab.",
      inputSchema: z.object({
        diagram: diagramArg,
        targets: z.array(target).min(1),
        mode: z.enum(["focus", "point"]).default("focus"),
        gesture: z
          .enum(["dot", "heart"])
          .default("dot")
          .describe(
            "Temporary pointer gesture; heart draws a fading heart without editing the diagram.",
          ),
      }),
    },
    guard(async ({ diagram, targets, mode, gesture }: FocusArgs) =>
      room(env, (await pick(diagram)).id).focusView(targets, mode, gesture),
    ),
  );

  // ---------- review support ----------

  server.registerResource(
    "components",
    "components://catalog",
    { title: "Standard system design components", mimeType: "application/json" },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            COMPONENTS.map(({ kind, label, shape, group, icon }) => ({
              kind,
              label,
              shape,
              group,
              icon,
            })),
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "rubric",
    "rubric://system-design",
    { title: "System design interview rubric", mimeType: "text/markdown" },
    async (uri: URL) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: RUBRIC }],
    }),
  );

  server.registerPrompt(
    "review_design",
    {
      description: "Critique the current diagram against the system design rubric.",
      argsSchema: z.object({
        focus: z.string().optional().describe("e.g. 'scaling the write path'"),
      }),
    },
    ({ focus }: ReviewArgs) =>
      userMsg(`Review my system design on the shared canvas${focus ? `, focusing on: ${focus}` : ""}.
1. Call get_scene, and get_screenshot if there are sketches or the layout matters.
2. Judge it against this rubric:\n\n${RUBRIC}
3. Reply with: the 3 most important gaps or risks (with a concrete fix each), then quick wins, then questions an interviewer is likely to ask next. Be terse; I am mid-interview.
Do not edit the canvas unless I ask.`),
  );

  server.registerPrompt(
    "suggest_next_step",
    {
      description: "What to draw or discuss next, given the diagram so far.",
      argsSchema: z.object({}),
    },
    () =>
      userMsg(
        `Look at the canvas (get_scene; include my selection) and tell me the single most valuable next step in this system design interview, in 2-3 sentences, plus the one-line talking point I should say out loud. Offer (don't apply) a concrete apply_patch if it involves drawing.`,
      ),
  );

  server.registerPrompt(
    "estimate_capacity",
    {
      description: "Back-of-envelope capacity estimates, optionally written onto the canvas.",
      argsSchema: z.object({
        dau: z.string().optional().describe("daily active users, e.g. '100M'"),
        notes: z.string().optional().describe("read/write ratio, payload sizes, retention, …"),
      }),
    },
    ({ dau, notes }: EstimateArgs) =>
      userMsg(`Do back-of-envelope estimates for the system on the canvas (read it with get_scene first).
Inputs: DAU=${dau ?? "infer a reasonable number and say so"}; ${notes ?? "infer other inputs and state assumptions"}.
Compute: read QPS and write QPS (avg and peak ~2-3x), storage per year, bandwidth, cache size (hot 20%), and the number of servers/shards implied. Use round numbers and show the arithmetic in one line each.
Then ask whether to add the results as a note in the "Estimates" frame (or near the diagram) via apply_patch add_note.`),
  );

  return server;
}
