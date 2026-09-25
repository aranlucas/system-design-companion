import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { parseDiagramCursor } from "./store.ts";

/** Keep validation failures in the API's { error: string } response format. */
export function validate<T extends z.ZodType, Target extends "json" | "query">(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result, c) => {
    // Hono skips JSON parsing for other media types; do not treat an ignored body as {}.
    const mediaType = c.req.header("Content-Type")?.split(";")[0].trim().toLowerCase();
    if (
      target === "json" &&
      c.req.raw.body !== null &&
      !/^application\/(?:[a-z.-]+\+)?json$/.test(mediaType ?? "")
    ) {
      throw new HTTPException(415, { message: "Expected an application/json request body" });
    }
    if (!result.success)
      throw new HTTPException(400, {
        message: result.error.issues[0]?.message ?? "Invalid request",
      });
  });
}

const nameError = "Use a name between 1 and 120 characters.";
const name = z.string({ error: nameError }).trim().min(1, nameError).max(120, nameError);
const optionalName = z.string().trim().max(120, nameError).optional();
const limitError = "limit must be an integer between 1 and 100";

export const paginationQuery = z.object({
  limit: z
    .string({ error: limitError })
    .regex(/^[1-9][0-9]{0,2}$/, limitError)
    .refine((value) => Number(value) <= 100, limitError)
    .default("50")
    .transform(Number),
  cursor: z
    .string()
    .transform((value, ctx) => {
      const cursor = parseDiagramCursor(value);
      if (cursor !== null) return cursor;
      ctx.addIssue({ code: "custom", message: "invalid cursor" });
      return z.NEVER;
    })
    .optional(),
});

export const createBody = z.object({
  name: optionalName.transform((value) => value || "Untitled"),
  template: z.string().optional(),
});
export const renameBody = z.object({ name });
export const snapshotBody = z.object({
  name: optionalName.transform((value) => value || "manual"),
});
export const restoreBody = z.object({ snapshotId: z.string().min(1) });
// Omitted/empty frames means the whole diagram; null selects the top-level canvas.
export const tidyBody = z.object({ frames: z.array(z.string().min(1).nullable()).optional() });
export const templateBody = z.object({ name, description: z.string().optional() });
