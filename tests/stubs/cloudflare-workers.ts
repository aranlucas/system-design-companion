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
