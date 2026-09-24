import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { LibraryItems } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import { COMPONENTS, type Component } from "../shared/components.ts";

/** Native primitives keep icons editable and portable in exported diagrams. */
function iconElements(c: Component, width: number): ExcalidrawElementSkeleton[] {
  const x = (width - 80) / 2;
  switch (c.icon) {
    case "database":
      return [
        { type: "ellipse", x, y: 48, width: 80, height: 24 },
        { type: "rectangle", x, y: 12, width: 80, height: 48, strokeColor: "transparent" },
        {
          type: "line",
          x,
          y: 12,
          points: [
            [0, 0],
            [0, 48],
          ],
        },
        {
          type: "line",
          x: x + 80,
          y: 12,
          points: [
            [0, 0],
            [0, 48],
          ],
        },
        { type: "ellipse", x, y: 0, width: 80, height: 24 },
      ];
    case "user":
      return [
        { type: "ellipse", x: x + 25, y: 0, width: 30, height: 30 },
        {
          type: "line",
          x: x + 40,
          y: 30,
          points: [
            [0, 0],
            [0, 26],
          ],
        },
        {
          type: "line",
          x: x + 10,
          y: 44,
          points: [
            [0, 0],
            [60, 0],
          ],
        },
        {
          type: "line",
          x: x + 16,
          y: 76,
          points: [
            [0, 0],
            [24, -20],
            [48, 0],
          ],
        },
      ];
    case "device":
      return [
        { type: "rectangle", x, y: 0, width: 80, height: 54, roundness: { type: 3 } },
        {
          type: "line",
          x: x + 40,
          y: 54,
          points: [
            [0, 0],
            [0, 18],
          ],
        },
        {
          type: "line",
          x: x + 18,
          y: 72,
          points: [
            [0, 0],
            [44, 0],
          ],
        },
      ];
    case "phone":
      return [
        { type: "rectangle", x: x + 18, y: 0, width: 44, height: 76, roundness: { type: 3 } },
        {
          type: "line",
          x: x + 30,
          y: 8,
          points: [
            [0, 0],
            [20, 0],
          ],
        },
        {
          type: "line",
          x: x + 30,
          y: 68,
          points: [
            [0, 0],
            [20, 0],
          ],
        },
      ];
    default:
      return [];
  }
}

/** Standard components as Excalidraw library items (tagged with customData.kind for the agent). */
export function componentLibrary(): LibraryItems {
  return COMPONENTS.map((c) => {
    const width = Math.max(160, c.label.length * 12 + 40);
    const skeleton: ExcalidrawElementSkeleton[] = c.icon
      ? [
          ...iconElements(c, width).map((element) => ({
            backgroundColor: c.fill,
            strokeColor: "#1e1e1e",
            fillStyle: "solid" as const,
            ...element,
          })),
          { type: "text", x: 0, y: 90, text: c.label, fontSize: 20, textAlign: "center", width },
        ]
      : [
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
        ];
    const groupId = crypto.randomUUID();
    const elements = convertToExcalidrawElements(skeleton).map((element) =>
      c.icon
        ? {
            ...element,
            groupIds: [groupId],
            customData: { kind: c.kind },
            x: element.type === "text" ? (width - element.width) / 2 : element.x,
          }
        : element,
    );
    return {
      id: `component-${c.kind}`,
      status: "published" as const,
      created: 0,
      name: c.label,
      elements,
    };
  });
}
