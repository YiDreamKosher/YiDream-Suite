import { handler } from './handler.ts';
Deno.serve((request, info) => {
  let peer: string | null = null;
  try { peer = info?.remoteAddr?.hostname ?? null; } catch { /* A hosted gateway may omit peer information. */ }
  return handler(request, peer);
});
