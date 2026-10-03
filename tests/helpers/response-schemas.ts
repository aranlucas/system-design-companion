import { z } from "zod";
import { storedElementsSchema } from "../../src/shared/schemas.ts";

export const apiFailureSchema = z.looseObject({
  error: z.union([z.string(), z.looseObject({ message: z.string() })]).optional(),
});

export const jsonObjectSchema = z.record(z.string(), z.json());

export const stringRecordSchema = z.record(z.string(), z.string());

export const createdSchema = z.looseObject({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  link: z.string(),
});

export const librarySchema = z.looseObject({
  items: z.array(z.looseObject({ id: z.string(), key: z.string() })),
});

export const diagramPageSchema = z.looseObject({
  items: z.array(z.looseObject({ id: z.string(), key: z.string(), name: z.string() })),
  nextCursor: z.string().nullable(),
});

export const withIdSchema = z.looseObject({ id: z.string() });

export const errorBodySchema = z.looseObject({ error: z.string() });

export const templateInfoSchema = z.looseObject({ id: z.string(), name: z.string() });

export const snapshotInfoSchema = templateInfoSchema;

export const protectedResourceSchema = z.looseObject({
  resource: z.string(),
  authorization_servers: z.array(z.string()),
});

export const tokensSchema = z.looseObject({ access_token: z.string(), refresh_token: z.string() });

export const libraryDataSchema = z.looseObject({
  type: z.string(),
  version: z.number(),
  libraryItems: z.array(
    z.looseObject({ id: z.string(), name: z.string(), elements: storedElementsSchema }),
  ),
});

export const eventBodySchema = z.looseObject({
  eventId: z.string().optional(),
  name: z.string().optional(),
  timestamp: z.string().optional(),
  cursor: z.null().optional(),
  type: z.string().optional(),
  challenge: z.string().optional(),
  data: z
    .looseObject({
      diagram_id: z.string().optional(),
      name: z.string().optional(),
      snapshot_id: z.string().optional(),
    })
    .optional(),
});

export const rpcResultSchema = z.looseObject({
  result: z
    .looseObject({
      events: z.array(z.json()).optional(),
      capabilities: jsonObjectSchema.optional(),
    })
    .optional(),
  error: z.json().optional(),
});

export const rpcReplySchema = z.looseObject({
  result: jsonObjectSchema.optional(),
  error: z.looseObject({ code: z.number(), data: z.json().optional() }).optional(),
});

export const grantSchema = z.looseObject({
  id: z.string(),
  refreshBefore: z.string(),
  cursor: z.null(),
});

export const toolsListSchema = z.looseObject({
  tools: z.array(
    z.looseObject({
      name: z.string(),
      annotations: z
        .looseObject({
          readOnlyHint: z.boolean().optional(),
          destructiveHint: z.boolean().optional(),
          openWorldHint: z.boolean().optional(),
        })
        .optional(),
    }),
  ),
});

export const eventsListSchema = z.looseObject({
  events: z.array(
    z.looseObject({
      name: z.string(),
      description: z.string(),
      delivery: z.array(z.string()),
      inputSchema: z.looseObject({ required: z.array(z.string()), properties: jsonObjectSchema }),
      payloadSchema: z.looseObject({ type: z.string() }),
    }),
  ),
});

/** Values deliberately serialized by test requests; undefined follows JSON omission/null rules. */
export type JsonInput =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly JsonInput[]
  | JsonInputObject;

export interface JsonInputObject {
  readonly [key: string]: JsonInput;
}
