import { COMPONENTS } from "../shared/components.ts";
import { Scene } from "../worker/scene.ts";

/** Excalidraw's library importer restores and validates the serialized scene elements. */
export function componentLibrary(): Blob {
  const libraryItems = COMPONENTS.map((component) => {
    const scene = new Scene([]);
    scene.addNode({ op: "add_node", kind: component.kind, place: { at: { x: 0, y: 0 } } }, "human");
    return {
      id: `component-${component.kind}`,
      status: "published",
      created: 0,
      name: component.label,
      elements: scene.live(),
    };
  });
  return new Blob([JSON.stringify({ type: "excalidrawlib", version: 2, libraryItems })], {
    type: "application/vnd.excalidrawlib+json",
  });
}
