import type { Op } from "./scene.ts";

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  ops: Op[];
}

const frameGrid = (names: string[], cols = 3, w = 900, h = 560): Op[] =>
  names.map((name, i) => ({
    op: "add_frame" as const,
    ref: `f${i}`,
    name,
    width: w,
    height: h,
    place: { at: { x: (i % cols) * (w + 80), y: Math.floor(i / cols) * (h + 80) } },
  }));

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "builtin:interview",
    name: "Interview framework",
    description:
      "Six frames: requirements, estimates, API, data model, high-level design, deep dives.",
    ops: [
      ...frameGrid([
        "1. Requirements",
        "2. Estimates",
        "3. API",
        "4. Data model",
        "5. High-level design",
        "6. Deep dives",
      ]),
      {
        op: "add_note",
        text: "Functional:\n- \n- \n\nNon-functional:\n- scale:\n- latency:\n- consistency:\n- availability:",
        frame: "f0",
        size: "m",
      },
      {
        op: "add_note",
        text: "DAU:\nreads/s:\nwrites/s:\nstorage / yr:\nbandwidth:",
        frame: "f1",
        size: "m",
      },
      { op: "add_note", text: "POST /...\nGET /...", frame: "f2", size: "m" },
      { op: "add_note", text: "Entities, keys, access patterns", frame: "f3", size: "m" },
      {
        op: "add_note",
        text: "Bottlenecks · SPOFs · caching · sharding · failure modes",
        frame: "f5",
        size: "m",
      },
    ],
  },
  {
    id: "builtin:web-baseline",
    name: "Web service baseline",
    description: "Client, CDN, LB, stateless API, cache, DB, queue and async workers.",
    ops: [
      {
        op: "add_node",
        ref: "client",
        label: "Client",
        shape: "ellipse",
        place: { at: { x: 0, y: 200 } },
      },
      {
        op: "add_node",
        ref: "cdn",
        label: "CDN",
        place: { above: "client", gap: 60 },
        color: "gray",
      },
      { op: "add_node", ref: "lb", label: "Load Balancer", place: { right_of: "client" } },
      {
        op: "add_node",
        ref: "api",
        label: "API Service",
        place: { right_of: "lb" },
        color: "blue",
      },
      {
        op: "add_node",
        ref: "cache",
        label: "Cache (Redis)",
        place: { above: "api", gap: 80 },
        color: "red",
      },
      {
        op: "add_node",
        ref: "db",
        label: "Primary DB",
        shape: "ellipse",
        place: { right_of: "api" },
        color: "green",
      },
      {
        op: "add_node",
        ref: "q",
        label: "Queue",
        place: { below: "api", gap: 80 },
        color: "yellow",
      },
      { op: "add_node", ref: "worker", label: "Workers", place: { right_of: "q" }, color: "blue" },
      {
        op: "add_node",
        ref: "blob",
        label: "Object Storage",
        shape: "ellipse",
        place: { right_of: "worker" },
        color: "green",
      },
      { op: "connect", from: "client", to: "cdn", label: "static" },
      { op: "connect", from: "client", to: "lb", label: "HTTPS" },
      { op: "connect", from: "lb", to: "api" },
      { op: "connect", from: "api", to: "cache", dashed: true },
      { op: "connect", from: "api", to: "db" },
      { op: "connect", from: "api", to: "q", label: "enqueue" },
      { op: "connect", from: "q", to: "worker" },
      { op: "connect", from: "worker", to: "blob" },
    ],
  },
  {
    id: "builtin:read-heavy",
    name: "Read-heavy (URL shortener shape)",
    description: "Write path with ID generator; read path through cache and replicas.",
    ops: [
      {
        op: "add_node",
        ref: "client",
        label: "Client",
        shape: "ellipse",
        place: { at: { x: 0, y: 200 } },
      },
      { op: "add_node", ref: "api", label: "API", place: { right_of: "client" }, color: "blue" },
      {
        op: "add_node",
        ref: "ids",
        label: "ID Generator",
        place: { above: "api", gap: 80 },
        color: "violet",
      },
      { op: "add_node", ref: "cache", label: "Cache", place: { right_of: "api" }, color: "red" },
      {
        op: "add_node",
        ref: "db",
        label: "DB (primary)",
        shape: "ellipse",
        place: { right_of: "cache" },
        color: "green",
      },
      {
        op: "add_node",
        ref: "rep",
        label: "Read replicas",
        shape: "ellipse",
        place: { below: "db", gap: 80 },
        color: "green",
      },
      { op: "connect", from: "client", to: "api" },
      { op: "connect", from: "api", to: "ids", label: "write" },
      { op: "connect", from: "api", to: "cache", label: "read" },
      { op: "connect", from: "cache", to: "db", label: "miss", dashed: true },
      { op: "connect", from: "db", to: "rep", label: "replicate", dashed: true },
    ],
  },
  {
    id: "builtin:realtime",
    name: "Realtime fan-out (chat / feed shape)",
    description: "WebSocket gateways, pub/sub, message store and push notifications.",
    ops: [
      {
        op: "add_node",
        ref: "client",
        label: "Clients",
        shape: "ellipse",
        place: { at: { x: 0, y: 200 } },
      },
      {
        op: "add_node",
        ref: "gw",
        label: "WS Gateway",
        place: { right_of: "client" },
        color: "blue",
      },
      {
        op: "add_node",
        ref: "svc",
        label: "Message Service",
        place: { right_of: "gw" },
        color: "blue",
      },
      {
        op: "add_node",
        ref: "pubsub",
        label: "Pub/Sub",
        place: { below: "gw", gap: 80 },
        color: "yellow",
      },
      {
        op: "add_node",
        ref: "store",
        label: "Message Store",
        shape: "ellipse",
        place: { right_of: "svc" },
        color: "green",
      },
      {
        op: "add_node",
        ref: "push",
        label: "Push Notifications",
        place: { below: "svc", gap: 80 },
        color: "orange",
      },
      { op: "connect", from: "client", to: "gw", label: "WebSocket", bidirectional: true },
      { op: "connect", from: "gw", to: "svc" },
      { op: "connect", from: "svc", to: "store" },
      { op: "connect", from: "svc", to: "pubsub", label: "publish" },
      { op: "connect", from: "pubsub", to: "gw", label: "fan-out", dashed: true },
      { op: "connect", from: "svc", to: "push", label: "offline users", dashed: true },
    ],
  },
];
