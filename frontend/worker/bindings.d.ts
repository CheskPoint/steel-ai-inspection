// This optional binding is injected only by a configured Cloudflare deployment.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}
