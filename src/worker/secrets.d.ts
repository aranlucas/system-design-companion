// Worker secrets, declared here because `wrangler types` only emits bindings.
//
// Set with `wrangler secret put GITHUB_CLIENT_ID` and the same for
// GITHUB_CLIENT_SECRET; they come from an OAuth app on GitHub and are how
// /authorize completes a sign-in. oauthConfigured() reports whether a deployment
// has them, so an unconfigured one answers 503 instead of failing mid-flow.
//
// This is a global script, not a module, so its interface merges with the Env
// that wrangler types generates in worker-configuration.d.ts.
interface Env {
  /** Comma-separated exact callback hostnames controlled by trusted MCP receivers. */
  MCP_EVENT_CALLBACK_HOSTS?: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
}
