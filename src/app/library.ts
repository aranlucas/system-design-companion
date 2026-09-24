import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { LibraryItems } from "@excalidraw/excalidraw/types";
import { COMPONENTS } from "../shared/components.ts";

/** Standard components as Excalidraw library items (tagged with customData.kind for the agent). */
export function componentLibrary(): LibraryItems {
  return COMPONENTS.map((c) => {
    const width = Math.max(160, c.label.length * 12 + 40);
    const elements = convertToExcalidrawElements([
      {
        type: c.shape,
        x: 0,
        y: 0,
        width,
        height: 70,
        backgroundColor: c.fill,
        strokeColor: "#1e1e1e",
        fillStyle: "solid",
        roundness: c.shape === "ellipse" ? null : { type: c.shape === "diamond" ? 2 : 3 },
        customData: { kind: c.kind },
        label: { text: c.label, fontSize: 20 },
      },
    ]);
    return {
      id: `component-${c.kind}`,
      status: "published" as const,
      created: 0,
      name: c.label,
      elements,
    };
  });
}
