import { z } from "zod";
import { MAX_SCENE_ELEMENTS } from "./request-limits.ts";

const coordinate = z.number().min(-1_000_000).max(1_000_000);
const id = z.string().min(1).max(128);
const element = z.looseObject({
  id,
  type: z.string().min(1).max(40),
  x: coordinate,
  y: coordinate,
  width: z.number().min(0).max(1_000_000),
  height: z.number().min(0).max(1_000_000),
  version: z.number().int().nonnegative(),
  versionNonce: z.number().int(),
  isDeleted: z.boolean(),
});

export const socketMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("update"), elements: z.array(element).max(MAX_SCENE_ELEMENTS) }),
  z.object({
    type: z.literal("presence"),
    selection: z.array(id).max(MAX_SCENE_ELEMENTS),
    viewport: z
      .object({
        x: coordinate,
        y: coordinate,
        width: z.number().nonnegative(),
        height: z.number().nonnegative(),
        zoom: z.number().positive(),
      })
      .optional(),
    focused: z.boolean(),
    username: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal("pointer"),
    pointer: z.object({ x: coordinate, y: coordinate, tool: z.enum(["pointer", "laser"]) }),
    button: z.enum(["up", "down"]),
  }),
  z
    .object({
      type: z.literal("rpc_result"),
      reqId: id,
      ok: z.boolean(),
      data: z.unknown().optional(),
      error: z.string().max(1000).optional(),
    })
    .refine((message) => message.ok || typeof message.error === "string"),
]);
