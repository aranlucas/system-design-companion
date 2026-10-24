// Worker secrets, declared here because `wrangler types` only emits bindings.
//
// This is a global script, not a module, so its interface merges with the Env
// that wrangler types generates in worker-configuration.d.ts.
interface Env {
  /** Stable SDK secret for signing ChatGPT cookies and encrypting plan tokens at rest. */
  LWC_SECRET?: string;
  /** Exact plain-text token supplied by the OpenAI submission portal. */
  OPENAI_APPS_CHALLENGE?: string;
  /** Comma-separated exact callback hostnames controlled by trusted MCP receivers. */
  MCP_EVENT_CALLBACK_HOSTS?: string;
  /** Confidential OIDC client registered at auth.aranlucas.workers.dev. */
  AUTH_CLIENT_ID?: string;
  AUTH_CLIENT_SECRET?: string;
}
