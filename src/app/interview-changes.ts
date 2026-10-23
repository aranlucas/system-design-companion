import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

interface InterviewElement extends Pick<
  ExcalidrawElement,
  "id" | "type" | "x" | "y" | "width" | "height" | "version" | "versionNonce" | "isDeleted"
> {
  text?: string;
}

interface ObservedElement {
  id: string;
  type: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  versionNonce: number;
}

export type CanvasObservation = Map<string, ObservedElement>;

interface ElementChange {
  before: ObservedElement;
  after: ObservedElement;
}

export interface CanvasChanges {
  added: ObservedElement[];
  updated: ElementChange[];
  removed: ObservedElement[];
}

/** Observe document elements only: pointer, selection, zoom and sidebar changes are excluded. */
export function observeCanvas(elements: readonly InterviewElement[]): CanvasObservation {
  const observed: CanvasObservation = new Map();

  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }

    const item: ObservedElement = {
      id: element.id,
      type: element.type,
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
      version: element.version,
      versionNonce: element.versionNonce,
    };

    if (element.text !== undefined) {
      item.text = element.text.slice(0, 2000);
    }

    observed.set(element.id, item);
  }

  return observed;
}

export function canvasChanges(before: CanvasObservation, after: CanvasObservation): CanvasChanges {
  const added: ObservedElement[] = [];
  const updated: ElementChange[] = [];
  const removed: ObservedElement[] = [];

  for (const [id, element] of after) {
    const previous = before.get(id);

    if (!previous) {
      added.push(element);
    } else if (
      element.version !== previous.version ||
      element.versionNonce !== previous.versionNonce
    ) {
      updated.push({ before: previous, after: element });
    }
  }

  for (const [id, element] of before) {
    if (!after.has(id)) {
      removed.push(element);
    }
  }

  return { added, updated, removed };
}

export function hasCanvasChanges(changes: CanvasChanges): boolean {
  return changes.added.length + changes.updated.length + changes.removed.length > 0;
}
