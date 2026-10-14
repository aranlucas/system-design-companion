// Standard system design components, shared by the canvas Library (human) and add_node `kind` (agent).
// Colour encodes the role so a diagram reads at a glance.

export type ComponentGeometry = "rectangle" | "ellipse" | "diamond";

export interface Component {
  kind: string;
  label: string;
  geometry: ComponentGeometry;
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
    geometry: "rectangle",
    icon: "server",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "cloud",
    label: "Cloud",
    geometry: "rectangle",
    icon: "cloud",
    fill: FILL.external,
    group: "External",
  },
  {
    kind: "user",
    label: "User",
    geometry: "ellipse",
    icon: "user",
    fill: FILL.client,
    group: "Clients",
  },
  {
    kind: "device",
    label: "Device",
    geometry: "rectangle",
    icon: "device",
    fill: FILL.client,
    group: "Clients",
  },
  {
    kind: "database",
    label: "Database",
    geometry: "ellipse",
    icon: "database",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "client",
    icon: "device",
    label: "Client",
    geometry: "ellipse",
    fill: FILL.client,
    group: "Clients",
  },
  {
    kind: "mobile",
    icon: "phone",
    label: "Mobile App",
    geometry: "ellipse",
    fill: FILL.client,
    group: "Clients",
  },
  {
    kind: "web",
    icon: "device",
    label: "Web App",
    geometry: "ellipse",
    fill: FILL.client,
    group: "Clients",
  },
  {
    kind: "dns",
    icon: "globe",
    label: "DNS",
    geometry: "rectangle",
    fill: FILL.edge,
    group: "Edge",
  },
  {
    kind: "cdn",
    icon: "globe",
    label: "CDN",
    geometry: "rectangle",
    fill: FILL.edge,
    group: "Edge",
  },
  {
    kind: "load_balancer",
    icon: "balance",
    label: "Load Balancer",
    geometry: "rectangle",
    fill: FILL.edge,
    group: "Edge",
  },
  {
    kind: "api_gateway",
    icon: "balance",
    label: "API Gateway",
    geometry: "rectangle",
    fill: FILL.edge,
    group: "Edge",
  },
  {
    kind: "rate_limiter",
    icon: "shield",
    label: "Rate Limiter",
    geometry: "rectangle",
    fill: FILL.edge,
    group: "Edge",
  },
  {
    kind: "service",
    icon: "server",
    label: "Service",
    geometry: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "worker",
    icon: "server",
    label: "Workers",
    geometry: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "auth",
    icon: "shield",
    label: "Auth Service",
    geometry: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "scheduler",
    icon: "clock",
    label: "Scheduler / Cron",
    geometry: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "websocket",
    icon: "balance",
    label: "WebSocket Gateway",
    geometry: "rectangle",
    fill: FILL.compute,
    group: "Compute",
  },
  {
    kind: "sql_db",
    icon: "database",
    label: "SQL DB",
    geometry: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "nosql_db",
    icon: "database",
    label: "NoSQL DB",
    geometry: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "object_store",
    icon: "storage",
    label: "Object Storage",
    geometry: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "search",
    icon: "search",
    label: "Search Index",
    geometry: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "timeseries",
    icon: "database",
    label: "Time-series DB",
    geometry: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "warehouse",
    icon: "database",
    label: "Data Warehouse",
    geometry: "ellipse",
    fill: FILL.data,
    group: "Data",
  },
  {
    kind: "cache",
    icon: "cache",
    label: "Cache",
    geometry: "rectangle",
    fill: FILL.cache,
    group: "Data",
  },
  {
    kind: "queue",
    icon: "queue",
    label: "Queue",
    geometry: "rectangle",
    fill: FILL.messaging,
    group: "Messaging",
  },
  {
    kind: "pubsub",
    icon: "balance",
    label: "Pub/Sub",
    geometry: "rectangle",
    fill: FILL.messaging,
    group: "Messaging",
  },
  {
    kind: "stream",
    icon: "queue",
    label: "Event Stream (Kafka)",
    geometry: "rectangle",
    fill: FILL.messaging,
    group: "Messaging",
  },
  {
    kind: "third_party",
    icon: "cloud",
    label: "3rd-party API",
    geometry: "rectangle",
    fill: FILL.external,
    group: "External",
  },
  {
    kind: "notifications",
    icon: "mail",
    label: "Push / Email / SMS",
    geometry: "rectangle",
    fill: FILL.external,
    group: "External",
  },
  {
    kind: "decision",
    label: "Decision?",
    geometry: "diamond",
    fill: "transparent",
    group: "Compute",
  },
];

/** At least one string, as zod's `z.enum` requires. */
type NonEmptyStrings = [string, ...string[]];

const [firstComponent, ...remainingComponents] = COMPONENTS;

export const COMPONENT_KINDS: NonEmptyStrings = [
  firstComponent.kind,
  ...remainingComponents.map((c) => c.kind),
];

export const componentByKind = new Map(COMPONENTS.map((c) => [c.kind, c]));
