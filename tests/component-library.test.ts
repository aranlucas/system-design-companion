import { describe, expect, it } from "vitest";
import { componentLibrary } from "../src/app/library.ts";
import { COMPONENTS } from "../src/shared/components.ts";
import type { El } from "../src/shared/protocol.ts";
import { Scene } from "../src/worker/scene.ts";

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

const artwork = (e: El) => ({
  type: e.type,
  x: e.x,
  y: e.y,
  width: e.width,
  height: e.height,
  points: e.points,
  text: e.text,
  strokeColor: e.strokeColor,
  backgroundColor: e.backgroundColor,
  customData: e.customData,
});

describe("component library import", () => {
  it("serializes an Excalidraw library with the same artwork as the server", async () => {
    const blob = componentLibrary();
    expect(blob.type).toBe("application/vnd.excalidrawlib+json");
    const data = JSON.parse(await blob.text()) as LibraryData;
    expect(data.type).toBe("excalidrawlib");
    expect(data.version).toBe(2);
    const items = data.libraryItems;
    expect(items).toHaveLength(COMPONENTS.length);
    for (const [index, component] of COMPONENTS.entries()) {
      const scene = new Scene([]);
      scene.addNode(
        { op: "add_node", kind: component.kind, place: { at: { x: 0, y: 0 } } },
        "human",
      );
      expect(items[index].elements.map(artwork)).toEqual(scene.live().map(artwork));
    }
  });

  it("keeps all element references inside their library item", async () => {
    const { libraryItems: items } = JSON.parse(await componentLibrary().text()) as LibraryData;
    const allIds = items.flatMap((item) => item.elements.map((e) => e.id));
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const item of items) {
      const ids = new Set(item.elements.map((e) => e.id));
      for (const element of item.elements) {
        for (const bound of element.boundElements ?? []) expect(ids.has(bound.id)).toBe(true);
        if (element.type === "text" && element.containerId) {
          expect(ids.has(element.containerId)).toBe(true);
        }
      }
    }
  });
});
