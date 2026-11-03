import { elementAttribute } from "@/shared/element-attributes.ts";
import { z } from "zod";
import { libraryDataSchema } from "@test/helpers/response-schemas.ts";
import { describe, expect, it } from "vitest";
import { componentLibrary } from "@/app/library.ts";
import { COMPONENTS } from "@/shared/components.ts";
import type { El } from "@/shared/protocol.ts";

interface LibraryData {
  type: string;
  version: number;
  libraryItems: LibraryItem[];
}

interface LibraryItem {
  id: string;
  name: string;
  elements: El[];
}

describe("component library import", () => {
  it("serializes an Excalidraw v2 library with every catalog component", async () => {
    const blob = componentLibrary();
    expect(blob.type).toBe("application/vnd.excalidrawlib+json");
    const data = libraryDataSchema.parse(JSON.parse(await blob.text())) satisfies LibraryData;
    expect(data.type).toBe("excalidrawlib");
    expect(data.version).toBe(2);
    const items = data.libraryItems;
    expect(items).toHaveLength(COMPONENTS.length);
  });

  it("keeps all element references inside their library item", async () => {
    const { libraryItems: items } = libraryDataSchema.parse(
      JSON.parse(await componentLibrary().text()),
    ) satisfies LibraryData;

    const allIds = items.flatMap((item) => item.elements.map((e) => e.id));
    expect(new Set(allIds).size).toBe(allIds.length);

    for (const item of items) {
      const ids = new Set(item.elements.map((e) => e.id));

      for (const element of item.elements) {
        for (const bound of z
          .array(z.object({ id: z.string() }))
          .parse(elementAttribute(element, "boundElements") ?? [])) {
          expect(ids.has(bound.id)).toBe(true);
        }
      }

      const containers = item.elements
        .filter((element) => element.type === "text")
        .map((element) => elementAttribute(element, "containerId"))
        .filter(Boolean);

      for (const container of containers) {
        expect(ids.has(z.string().parse(container))).toBe(true);
      }
    }
  });
});
