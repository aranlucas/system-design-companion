// Standard system design components, shared by the canvas Library (human) and add_node `kind` (agent).
// Colour encodes the role so a diagram reads at a glance.

export type ComponentShape = "rectangle" | "ellipse" | "diamond";

export interface Component {
  kind: string;
  label: string;
  shape: ComponentShape;
  fill: string;
  icon?:
    | "database"
    | "user"
    | "device"
    | "phone"
    | "server"
    | "cache"
    | "queue"
    | "balance"
    | "cloud"
    | "storage"
    | "search"
    | "shield"
    | "globe"
    | "mail"
    | "clock";
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
  {
    kind: "server",
    label: "Server",
    shape: "rectangle",
    icon: "server",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "cloud",
    label: "Cloud",
    shape: "rectangle",
    icon: "cloud",
    fill: FILL.external,
    group: "External",
  },
  {
    kind: "user",
    label: "User",
    shape: "ellipse",
    icon: "user",
    fill: FILL.client,
    group: "Clients",
  },
  {
    kind: "device",
    label: "Device",
    shape: "rectangle",
    icon: "device",
    fill: FILL.client,
    group: "Clients",
  },
  {
    kind: "database",
    label: "Database",
    shape: "ellipse",
    icon: "database",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "client",
    icon: "device",
    label: "Client",
    shape: "ellipse",
    fill: FILL.client,
    group: "Clients",
  },
  {
    kind: "mobile",
    icon: "phone",
    label: "Mobile App",
    shape: "ellipse",
    fill: FILL.client,
    group: "Clients",
  },
  {
    kind: "web",
    icon: "device",
    label: "Web App",
    shape: "ellipse",
    fill: FILL.client,
    group: "Clients",
  },
  { kind: "dns", icon: "globe", label: "DNS", shape: "rectangle", fill: FILL.edge, group: "Edge" },
  { kind: "cdn", icon: "globe", label: "CDN", shape: "rectangle", fill: FILL.edge, group: "Edge" },
  {
    kind: "load_balancer",
    icon: "balance",
    label: "Load Balancer",
    shape: "rectangle",
    fill: FILL.edge,
    group: "Edge",
  },
  {
    kind: "api_gateway",
    icon: "balance",
    label: "API Gateway",
    shape: "rectangle",
    fill: FILL.edge,
    group: "Edge",
  },
  {
    kind: "rate_limiter",
    icon: "shield",
    label: "Rate Limiter",
    shape: "rectangle",
    fill: FILL.edge,
    group: "Edge",
  },
  {
    kind: "service",
    icon: "server",
    label: "Service",
    shape: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "worker",
    icon: "server",
    label: "Workers",
    shape: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "auth",
    icon: "shield",
    label: "Auth Service",
    shape: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "scheduler",
    icon: "clock",
    label: "Scheduler / Cron",
    shape: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "websocket",
    icon: "balance",
    label: "WebSocket Gateway",
    shape: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "sql_db",
    icon: "database",
    label: "SQL DB",
    shape: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "nosql_db",
    icon: "database",
    label: "NoSQL DB",
    shape: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "object_store",
    icon: "storage",
    label: "Object Storage",
    shape: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "search",
    icon: "search",
    label: "Search Index",
    shape: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "timeseries",
    icon: "database",
    label: "Time-series DB",
    shape: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "warehouse",
    icon: "database",
    label: "Data Warehouse",
    shape: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "cache",
    icon: "cache",
    label: "Cache",
    shape: "rectangle",
    fill: FILL.cache,
    group: "Data",
  },
  {
    kind: "queue",
    icon: "queue",
    label: "Queue",
    shape: "rectangle",
    fill: FILL.messaging,
    group: "Messaging",
  },
  {
    kind: "pubsub",
    icon: "balance",
    label: "Pub/Sub",
    shape: "rectangle",
    fill: FILL.messaging,
    group: "Messaging",
  },
  {
    kind: "stream",
    icon: "queue",
    label: "Event Stream (Kafka)",
    shape: "rectangle",
    fill: FILL.messaging,
    group: "Messaging",
  },
  {
    kind: "third_party",
    icon: "cloud",
    label: "3rd-party API",
    shape: "rectangle",
    fill: FILL.external,
    group: "External",
  },
  {
    kind: "notifications",
    icon: "mail",
    label: "Push / Email / SMS",
    shape: "rectangle",
    fill: FILL.external,
    group: "External",
  },
  { kind: "decision", label: "Decision?", shape: "diamond", fill: "transparent", group: "Compute" },
];

/** At least one string, as zod's `z.enum` requires. */
type NonEmptyStrings = [string, ...string[]];

export const COMPONENT_KINDS = COMPONENTS.map((c) => c.kind) as NonEmptyStrings;
export const componentByKind = new Map(COMPONENTS.map((c) => [c.kind, c]));
