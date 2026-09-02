// Scratch headless RFS server for LCOS G0 smoke. NOT part of Huabu upstream.
// Registers Huabu's real rfsRoutes on a Fastify server, provisions a temp
// workspace + canvas, and gates /api/rfs by the same Bearer scheme as app.ts.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fastify from 'fastify';
import { setWorkspacePath } from '../../src/modules/workspace.js';
import { createCanvas } from '../../src/modules/storage/compatibility/canvas.js';
import { initStorage, getStorage } from '../../src/modules/storage/storage.js';
import { resetStorageCache } from '../../src/modules/storage/backends/disk/legacy/canvas-store-cache.js';
import { getConnectionToken } from '../../src/connection-token.js';
import rfsRoutes from '../../src/modules/remote_fs/rfs.route.js';

const TOKEN = process.env.HUABU_CONNECTION_TOKEN ?? 'lcos-g0-smoke-token';
process.env.HUABU_CONNECTION_TOKEN = TOKEN;

const PORT = Number(process.env.PORT ?? 3001);
const canvasId =
  process.env.CANVAS_ID ?? `canvas-lcos-g0-smoke-${Date.now().toString(36)}`;

const ws = mkdtempSync(join(tmpdir(), 'huabu-lcos-g0-'));
setWorkspacePath(ws);
resetStorageCache();
await initStorage();
createCanvas(canvasId, 'LCOS G0 smoke');

const storage = getStorage();
console.error(
  `[bootstrap] storage structured=${storage.structured.kind} blobs=${storage.blobs.kind} canvas=${canvasId} workspace=${ws}`,
);

const app = fastify();
app.addHook('onRequest', async (request, reply) => {
  if (request.method === 'OPTIONS') return;
  if (!request.url.startsWith('/api/rfs/')) return;
  const auth = request.headers.authorization ?? '';
  if (auth === `Bearer ${TOKEN}`) return;
  reply.code(401).send({ message: 'Authentication required' });
});
await app.register(rfsRoutes, { prefix: '/api/rfs' });
await app.ready();
await app.listen({ port: PORT, host: '127.0.0.1' });

console.log(`LCOS_G0_RFS_URL=http://127.0.0.1:${PORT}/api/rfs/${canvasId}`);
console.log(`LCOS_G0_TOKEN=${TOKEN}`);
console.log(`LCOS_G0_WORKSPACE=${ws}`);
console.log(`[bootstrap] RFS server listening on :${PORT}`);

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, async () => {
    console.log(`[bootstrap] ${sig} shutting down`);
    await app.close();
    process.exit(0);
  });
}
