import type { Component } from "./components.ts";

export interface IconPart {
  type: "rectangle" | "ellipse" | "line";
  x: number;
  y: number;
  width?: number;
  height?: number;
  strokeColor?: string;
  backgroundColor?: string;
  roundness?: { type: number };
  points?: [number, number][];
}

/** Native primitives keep icons editable and portable in exported diagrams. */
export function iconElements(c: Component, width: number): IconPart[] {
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
    case "server":
      return [0, 26, 52].flatMap((y) => [
        { type: "rectangle" as const, x, y, width: 80, height: 20, roundness: { type: 3 } },
        { type: "ellipse" as const, x: x + 8, y: y + 7, width: 6, height: 6 },
        {
          type: "line" as const,
          x: x + 30,
          y: y + 10,
          points: [
            [0, 0],
            [38, 0],
          ] as [number, number][],
        },
      ]);
    case "cache":
      return [
        { type: "rectangle", x: x + 15, y: 12, width: 50, height: 50, roundness: { type: 3 } },
        ...[24, 38, 52].flatMap((v) => [
          {
            type: "line" as const,
            x: x + v,
            y: 2,
            points: [
              [0, 0],
              [0, 10],
            ] as [number, number][],
          },
          {
            type: "line" as const,
            x: x + v,
            y: 62,
            points: [
              [0, 0],
              [0, 10],
            ] as [number, number][],
          },
          {
            type: "line" as const,
            x: x + 5,
            y: v - 2,
            points: [
              [0, 0],
              [10, 0],
            ] as [number, number][],
          },
          {
            type: "line" as const,
            x: x + 65,
            y: v - 2,
            points: [
              [0, 0],
              [10, 0],
            ] as [number, number][],
          },
        ]),
      ];
    case "queue":
      return [
        {
          type: "line",
          x: x - 6,
          y: 36,
          points: [
            [0, 0],
            [92, 0],
          ],
        },
        ...[0, 28, 56].map((offset) => ({
          type: "rectangle" as const,
          x: x + offset,
          y: 18,
          width: 24,
          height: 36,
        })),
      ];
    case "balance":
      return [
        {
          type: "line",
          x: x + 40,
          y: 20,
          points: [
            [0, 0],
            [0, 18],
            [-28, 18],
            [-28, 34],
          ],
        },
        {
          type: "line",
          x: x + 40,
          y: 38,
          points: [
            [0, 0],
            [28, 0],
            [28, 16],
          ],
        },
        {
          type: "line",
          x: x + 40,
          y: 38,
          points: [
            [0, 0],
            [0, 16],
          ],
        },
        { type: "rectangle", x: x + 24, y: 0, width: 32, height: 20, roundness: { type: 3 } },
        ...[0, 28, 56].map((offset) => ({
          type: "rectangle" as const,
          x: x + offset,
          y: 54,
          width: 24,
          height: 20,
          roundness: { type: 3 },
        })),
      ];
    case "cloud":
      return [
        {
          type: "line",
          x,
          y: 0,
          roundness: { type: 2 },
          points: [
            [12, 64],
            [0, 48],
            [8, 30],
            [24, 28],
            [32, 6],
            [54, 2],
            [70, 16],
            [70, 30],
            [84, 40],
            [80, 60],
            [64, 64],
            [12, 64],
          ],
        },
      ];
    case "storage":
      return [
        {
          type: "line",
          x,
          y: 12,
          points: [
            [0, 0],
            [10, 58],
            [70, 58],
            [80, 0],
            [0, 0],
          ],
        },
        { type: "ellipse", x, y: 0, width: 80, height: 24 },
      ];
    case "search":
      return [
        { type: "ellipse", x: x + 5, y: 0, width: 52, height: 52 },
        {
          type: "line",
          x: x + 49,
          y: 44,
          points: [
            [0, 0],
            [28, 28],
          ],
        },
      ];
    case "shield":
      return [
        {
          type: "line",
          x: x + 10,
          y: 0,
          points: [
            [0, 12],
            [30, 0],
            [60, 12],
            [54, 48],
            [30, 74],
            [6, 48],
            [0, 12],
          ],
        },
        {
          type: "line",
          x: x + 26,
          y: 34,
          points: [
            [0, 0],
            [10, 12],
            [30, -10],
          ],
          backgroundColor: "transparent",
        },
      ];
    case "globe":
      return [
        { type: "ellipse", x: x + 4, y: 0, width: 72, height: 72 },
        { type: "ellipse", x: x + 24, y: 0, width: 32, height: 72, backgroundColor: "transparent" },
        {
          type: "line",
          x: x + 4,
          y: 36,
          points: [
            [0, 0],
            [72, 0],
          ],
        },
      ];
    case "mail":
      return [
        { type: "rectangle", x, y: 12, width: 80, height: 52, roundness: { type: 3 } },
        {
          type: "line",
          x,
          y: 12,
          points: [
            [0, 0],
            [40, 30],
            [80, 0],
          ],
          backgroundColor: "transparent",
        },
      ];
    case "clock":
      return [
        { type: "ellipse", x: x + 4, y: 0, width: 72, height: 72 },
        {
          type: "line",
          x: x + 40,
          y: 12,
          points: [
            [0, 0],
            [0, 24],
            [20, 24],
          ],
          backgroundColor: "transparent",
        },
      ];
    default:
      return [];
  }
}
