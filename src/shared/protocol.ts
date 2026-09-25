// Wire protocol between canvas tabs and the DiagramRoom Durable Object.

/** A point of a linear element, relative to the element's x/y. */
export type Point = [number, number];

/** Minimal structural view of an Excalidraw element; everything else is passed through untouched. */
export interface El {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  index?: string | null;
  [key: string]: any;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

/** Live cursor, in scene coordinates (Excalidraw's CollaboratorPointer). */
export interface Pointer {
  x: number;
  y: number;
  tool: "pointer" | "laser";
}

export type TabRpcMethod = "screenshot" | "mermaid" | "focus_view";

export interface FocusViewParams {
  elementIds: string[];
  mode: "focus" | "point";
  gesture?: "dot" | "heart";
}

export type ClientMessage =
  | { type: "update"; elements: El[] }
  | {
      type: "presence";
      selection: string[];
      viewport?: Viewport;
      focused: boolean;
      username?: string;
    }
  | { type: "pointer"; pointer: Pointer; button: "up" | "down" }
  | { type: "rpc_result"; reqId: string; ok: true; data: unknown }
  | { type: "rpc_result"; reqId: string; ok: false; error: string };

export type ServerMessage =
  | { type: "init"; elements: El[]; name: string }
  | { type: "rename"; name: string }
  | { type: "update"; elements: El[]; origin: "human" | "agent" | "system" }
  | { type: "rpc"; reqId: string; method: TabRpcMethod; params: any }
  | { type: "peers"; count: number }
  /** Another tab's presence; relayed so Excalidraw can draw its cursor and selection. */
  | {
      type: "collaborator";
      id: string;
      username?: string;
      selection?: string[];
      pointer?: Pointer;
      button?: "up" | "down";
    }
  | { type: "collaborator_left"; id: string };

export interface ScreenshotParams {
  elementIds?: string[];
}
export interface ScreenshotResult {
  base64: string;
  mimeType: string;
}
export interface MermaidParams {
  source: string;
}
export interface MermaidResult {
  elements: El[];
}

export const AGENT_STROKE = "#6741d9";
