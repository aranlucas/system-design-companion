// Minimal "cloudflare:workers" stub so DiagramRoom can be instantiated under vitest.
// Maps to the real module on Cloudflare via vitest.config.ts alias (runtime only;
// typechecking still uses the real worker types).
export class DurableObject<Ctx = unknown, Env = unknown> {
  ctx: Ctx;
  env: Env;
  constructor(ctx: Ctx, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}

// @cloudflare/workers-oauth-provider imports this at module scope. Tests never
// construct a WorkerEntrypoint (the OAuth handlers are plain objects), so an
// inert base class is enough to let the module load under node.
export class WorkerEntrypoint<Env = unknown> {
  ctx: ExecutionContext;
  env: Env;
  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }
}
