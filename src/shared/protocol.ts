// Wire protocol between canvas tabs and the DiagramRoom Durable Object.

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

export type TabRpcMethod = "screenshot" | "mermaid";

export type ClientMessage =
  | { type: "update"; elements: El[] }
  | {
      type: "presence";
      selection: string[];
      viewport?: Viewport;
      focused: boolean;
    }
  | { type: "rpc_result"; reqId: string; ok: true; data: unknown }
  | { type: "rpc_result"; reqId: string; ok: false; error: string };

export type ServerMessage =
  | { type: "init"; elements: El[]; name: string }
  | { type: "update"; elements: El[]; origin: "human" | "agent" | "system" }
  | { type: "rpc"; reqId: string; method: TabRpcMethod; params: any }
  | { type: "peers"; count: number };

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
