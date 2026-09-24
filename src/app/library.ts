import type { LibraryItems } from "@excalidraw/excalidraw/types";
import { COMPONENTS } from "../shared/components.ts";
import { Scene } from "../worker/scene.ts";

/** Use the same pure scene builder as add_node so humans and agents get identical artwork. */
export function componentLibrary(): LibraryItems {
  return COMPONENTS.map((component) => {
    const scene = new Scene([]);
    scene.addNode({ op: "add_node", kind: component.kind, place: { at: { x: 0, y: 0 } } }, "human");
    return {
      id: `component-${component.kind}`,
      status: "published" as const,
      created: 0,
      name: component.label,
      elements: scene.live() as unknown as LibraryItems[number]["elements"],
    };
  });
}
