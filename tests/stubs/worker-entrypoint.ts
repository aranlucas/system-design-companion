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
