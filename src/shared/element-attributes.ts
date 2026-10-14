import { z } from "zod/mini";
import type { El } from "./protocol.ts";

const point = z.tuple([z.number(), z.number()]);

const metadataContract = z.looseObject({
  author: z.optional(z.string()),
  editedBy: z.optional(z.string()),
  icon: z.optional(z.string()),
  iconFill: z.optional(z.string()),
  kind: z.optional(z.string()),
  componentPart: z.optional(z.boolean()),
  componentLabel: z.optional(z.boolean()),
});

type ElementMetadata = z.infer<typeof metadataContract>;

// Validate only the named fields and return the original metadata object. Unknown
// extension keys, identity, and own keys such as __proto__ remain untouched.
const metadata = z.custom<ElementMetadata>((value) => metadataContract.safeParse(value).success);

const bindingContract = z.looseObject({
  elementId: z.string(),
  focus: z.optional(z.number()),
  gap: z.optional(z.number()),
  fixedPoint: z.optional(z.nullable(point)),
  mode: z.optional(z.string()),
});

type ElementBinding = z.infer<typeof bindingContract>;

const binding = z.custom<ElementBinding>((value) => bindingContract.safeParse(value).success);

const boundContract = z.looseObject({ id: z.string(), type: z.string() });

type BoundElement = z.infer<typeof boundContract>;

const bound = z.custom<BoundElement>((value) => boundContract.safeParse(value).success);

const attributesContract = z.object({
  roundness: z.optional(
    z.nullable(z.looseObject({ type: z.number(), value: z.optional(z.number()) })),
  ),
  name: z.optional(z.nullable(z.string())),
  text: z.optional(z.string()),
  originalText: z.optional(z.string()),
  strokeColor: z.optional(z.string()),
  backgroundColor: z.optional(z.string()),
  fillStyle: z.optional(z.string()),
  strokeStyle: z.optional(z.string()),
  strokeWidth: z.optional(z.number()),
  fontSize: z.optional(z.number()),
  fontFamily: z.optional(z.number()),
  textAlign: z.optional(z.string()),
  verticalAlign: z.optional(z.string()),
  lineHeight: z.optional(z.number()),
  roughness: z.optional(z.number()),
  opacity: z.optional(z.number()),
  seed: z.optional(z.number()),
  angle: z.optional(z.number()),
  baseHeight: z.optional(z.number()),
  labelPosition: z.optional(z.nullable(z.number())),
  frameId: z.optional(z.nullable(z.string())),
  containerId: z.optional(z.nullable(z.string())),
  groupIds: z.optional(z.array(z.string())),
  points: z.optional(z.array(point)),
  boundElements: z.optional(z.nullable(z.array(bound))),
  startBinding: z.optional(z.nullable(binding)),
  endBinding: z.optional(z.nullable(binding)),
  startArrowhead: z.optional(z.nullable(z.string())),
  endArrowhead: z.optional(z.nullable(z.string())),
  elbowed: z.optional(z.boolean()),
  customData: z.optional(z.nullable(metadata)),
});

export type ElementAttributes = z.infer<typeof attributesContract>;

type AttributeContracts = {
  [Key in keyof ElementAttributes]-?: z.ZodMiniType<ElementAttributes[Key]>;
};

const attributes: AttributeContracts = attributesContract.shape;

export type ElementAttributeValue<Key extends keyof AttributeContracts> = z.core.output<
  AttributeContracts[Key]
>;

/** Read one used library field without narrowing the opaque stored wire payload. */
export function elementAttribute<Key extends keyof ElementAttributes>(
  element: El | null | undefined,
  key: Key,
): ElementAttributeValue<Key> {
  // SAFETY: AttributeContracts pairs each key with its exact output schema; parsing
  // validates that field before TypeScript recovers the key-correlated return type.
  return attributes[key].parse(element?.[key]) as ElementAttributeValue<Key>;
}

/** Require a field only in operations whose existing preconditions need it. */
export function requiredElementAttribute<Key extends keyof ElementAttributes>(
  element: El | null | undefined,
  key: Key,
): NonNullable<ElementAttributeValue<Key>> {
  const value = elementAttribute(element, key);

  if (value === null || value === undefined) {
    throw new Error(`Missing ${key} on element ${element?.id ?? "unknown"}`);
  }

  return value;
}
