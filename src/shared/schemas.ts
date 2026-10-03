import type { El, Point } from "./protocol.ts";
import { z } from "zod/mini";

/** Core Excalidraw wire fields; library-owned extension fields are preserved. */
const elementCoreSchema = z.object({
  id: z.string(),
  type: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  version: z.number(),
  versionNonce: z.number(),
  isDeleted: z.boolean(),
  index: z.optional(z.nullable(z.string())),
});

/** Validate the named core without cloning or dropping library-owned extension keys. */
export const storedElementSchema = z.custom<El>(
  (value) => elementCoreSchema.safeParse(value).success,
);

export const storedElementsSchema = z.array(storedElementSchema);

export const sceneDataSchema = z.object({
  name: z.string(),
  url: z.string(),
  elements: storedElementsSchema,
});

export const screenshotResultSchema = z.object({ base64: z.string(), mimeType: z.string() });

export const mermaidResultSchema = z.object({ elements: storedElementsSchema });

export const focusResultSchema = z.object({
  mode: z.string(),
  visible: z.boolean(),
  elementIds: z.array(z.string()),
});

export type JsonValue = z.infer<ReturnType<typeof z.json>>;

const rpcBase = z.object({ type: z.literal("rpc"), reqId: z.string() });

const rpcMessageSchema = z.discriminatedUnion("method", [
  z.extend(rpcBase, {
    method: z.literal("screenshot"),
    params: z.object({ elementIds: z.optional(z.array(z.string())) }),
  }),
  z.extend(rpcBase, { method: z.literal("mermaid"), params: z.object({ source: z.string() }) }),
  z.extend(rpcBase, {
    method: z.literal("focus_view"),
    params: z.object({
      elementIds: z.array(z.string()),
      mode: z.enum(["focus", "point"]),
      gesture: z.optional(z.enum(["dot", "heart"])),
    }),
  }),
]);

export const serverMessageSchema = z.union([
  z.object({ type: z.literal("init"), elements: storedElementsSchema, name: z.string() }),
  z.object({ type: z.literal("rename"), name: z.string() }),
  z.object({
    type: z.literal("update"),
    elements: storedElementsSchema,
    origin: z.enum(["human", "agent", "system"]),
  }),
  rpcMessageSchema,
  z.object({ type: z.literal("peers"), count: z.number() }),
  z.object({
    type: z.literal("collaborator"),
    id: z.string(),
    username: z.optional(z.string()),
    selection: z.optional(z.array(z.string())),
    pointer: z.optional(
      z.object({ x: z.number(), y: z.number(), tool: z.enum(["pointer", "laser"]) }),
    ),
    button: z.optional(z.enum(["up", "down"])),
  }),
  z.object({ type: z.literal("collaborator_left"), id: z.string() }),
]);

export const pointListSchema = z.array(z.tuple([z.number(), z.number()]));

/** Read one concrete library extension only when geometry needs its point contract. */
export function elementPoints(element: El): Point[] {
  return pointListSchema.parse(element.points);
}
