// Standard system design components, shared by the canvas Library (human) and add_node `kind` (agent).
// Colour encodes the role so a diagram reads at a glance.

export type ComponentShape = "rectangle" | "ellipse" | "diamond";

export interface Component {
  kind: string;
  label: string;
  shape: ComponentShape;
  fill: string;
  group: "Clients" | "Edge" | "Compute" | "Data" | "Messaging" | "External";
}

const FILL = {
  client: "#a5d8ff", // blue
  edge: "#e9ecef", // gray
  compute: "#d0bfff", // violet
  data: "#b2f2bb", // green
  cache: "#ffc9c9", // red
  messaging: "#ffec99", // yellow
  external: "#ffd8a8", // orange
};

export const COMPONENTS: Component[] = [
  { kind: "client", label: "Client", shape: "ellipse", fill: FILL.client, group: "Clients" },
  { kind: "mobile", label: "Mobile App", shape: "ellipse", fill: FILL.client, group: "Clients" },
  { kind: "web", label: "Web App", shape: "ellipse", fill: FILL.client, group: "Clients" },
  { kind: "dns", label: "DNS", shape: "rectangle", fill: FILL.edge, group: "Edge" },
  { kind: "cdn", label: "CDN", shape: "rectangle", fill: FILL.edge, group: "Edge" },
  {
    kind: "load_balancer",
    label: "Load Balancer",
    shape: "rectangle",
    fill: FILL.edge,
    group: "Edge",
  },
  { kind: "api_gateway", label: "API Gateway", shape: "rectangle", fill: FILL.edge, group: "Edge" },
  {
    kind: "rate_limiter",
    label: "Rate Limiter",
    shape: "rectangle",
    fill: FILL.edge,
    group: "Edge",
  },
  { kind: "service", label: "Service", shape: "rectangle", fill: FILL.compute, group: "Compute" },
  { kind: "worker", label: "Workers", shape: "rectangle", fill: FILL.compute, group: "Compute" },
  { kind: "auth", label: "Auth Service", shape: "rectangle", fill: FILL.compute, group: "Compute" },
  {
    kind: "scheduler",
    label: "Scheduler / Cron",
    shape: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "websocket",
    label: "WebSocket Gateway",
    shape: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  { kind: "sql_db", label: "SQL DB", shape: "ellipse", fill: FILL.data, group: "Data" },
  { kind: "nosql_db", label: "NoSQL DB", shape: "ellipse", fill: FILL.data, group: "Data" },
  {
    kind: "object_store",
    label: "Object Storage",
    shape: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  { kind: "search", label: "Search Index", shape: "ellipse", fill: FILL.data, group: "Data" },
  { kind: "timeseries", label: "Time-series DB", shape: "ellipse", fill: FILL.data, group: "Data" },
  { kind: "warehouse", label: "Data Warehouse", shape: "ellipse", fill: FILL.data, group: "Data" },
  { kind: "cache", label: "Cache", shape: "rectangle", fill: FILL.cache, group: "Data" },
  { kind: "queue", label: "Queue", shape: "rectangle", fill: FILL.messaging, group: "Messaging" },
  {
    kind: "pubsub",
    label: "Pub/Sub",
    shape: "rectangle",
    fill: FILL.messaging,
    group: "Messaging",
  },
  {
    kind: "stream",
    label: "Event Stream (Kafka)",
    shape: "rectangle",
    fill: FILL.messaging,
    group: "Messaging",
  },
  {
    kind: "third_party",
    label: "3rd-party API",
    shape: "rectangle",
    fill: FILL.external,
    group: "External",
  },
  {
    kind: "notifications",
    label: "Push / Email / SMS",
    shape: "rectangle",
    fill: FILL.external,
    group: "External",
  },
  { kind: "decision", label: "Decision?", shape: "diamond", fill: "transparent", group: "Compute" },
];

export const COMPONENT_KINDS = COMPONENTS.map((c) => c.kind) as [string, ...string[]];
export const componentByKind = new Map(COMPONENTS.map((c) => [c.kind, c]));
