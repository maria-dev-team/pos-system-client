// Isolated Electron network check: no user profile, credentials or application backend.
// Run with: node_modules/.bin/electron scripts/smoke-pos-network.cjs
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Electron executes this standalone CommonJS script without a TypeScript build. */
const { app, net } = require('electron');
const { createServer } = require('node:http');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Worker } = require('node:worker_threads');
const { randomBytes, randomUUID } = require('node:crypto');
const directory = mkdtempSync(join(tmpdir(), 'pos-network-smoke-'));
app.setPath('userData', directory);
app.disableHardwareAcceleration();

async function main() {
  await app.whenReady();
  const register = randomUUID(),
    shift = randomUUID(),
    session = randomUUID(),
    organization = randomUUID(),
    store = randomUUID(),
    membership = randomUUID();
  const routes = {
    '/v1/auth/context': {
      context: {
        organizationId: organization,
        storeId: store,
        userOrganizationId: membership,
        isSystemPosition: true,
        permissions: [],
      },
    },
    [`/v1/registers/${register}/cashier-sessions/current`]: {
      cashier_session: {
        id: session,
        organization_id: organization,
        store_id: store,
        register_id: register,
        register_shift_id: shift,
        membership_id: membership,
        status: 'ACTIVE',
      },
    },
    [`/v1/register-shifts/current?register_id=${register}`]: {
      register_shift: {
        id: shift,
        register_id: register,
        organization_id: organization,
        store_id: store,
        status: 'OPEN',
        opened_at: new Date(
          Date.now() - Number(process.env.POS_SMOKE_SHIFT_HOURS || 0) * 3600000,
        ).toISOString(),
      },
    },
    '/v1/sales/current': { sale: null },
    '/v1/sales/held': { sales: [] },
    '/v1/pos/catalog/page?limit=250': { products: [], next_cursor: null },
    '/v1/pos/catalog/sync-start': { cursor: 'baseline' },
    '/v1/pos/catalog/changes?cursor=baseline&limit=250': {
      products: [],
      deleted_ids: [],
      categories_changed: false,
      cursor: 'next',
      has_more: false,
    },
    '/v1/categories?limit=100&offset=0': {
      categories: [],
      meta: { has_more: false },
    },
  };
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const send = () =>
      response.end(
        JSON.stringify({ data: routes[request.url] ?? { healthy: true } }),
      );
    if (request.url === '/v1/auth/context')
      setTimeout(send, Number(process.env.POS_SMOKE_AUTH_DELAY_MS || 0));
    else send();
  });
  let worker;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/health`;
    const chromium = await net.fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    console.log('Chromium HTTP status:', chromium.status);
    worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      fetch(workerData, { signal: AbortSignal.timeout(5000) })
        .then(r => parentPort.postMessage({ status: r.status }))
        .catch(e => parentPort.postMessage({ error: e.name, message: e.message, cause: e.cause?.message, code: e.cause?.code }));
    `,
      { eval: true, workerData: url, execArgv: [] },
    );
    const result = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    console.log('Worker Node fetch:', result);
    if (result.status !== 200) throw new Error('Worker network unavailable');
    await worker.terminate();
    worker = new Worker(join(__dirname, '../out/main/pos-worker.js'), {
      workerData: {
        databasePath: join(directory, 'pos.sqlite'),
        key: randomBytes(32),
        apiUrl: new URL(url).origin,
      },
    });
    const connected = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('POS connection timed out')),
        15000,
      );
      worker.on('message', (message) => {
        if (message.id === 1) {
          clearTimeout(timeout);
          resolve(message.reply);
        }
      });
      worker.once('error', reject);
      worker.postMessage({
        id: 1,
        request: {
          type: 'connect',
          accessToken: 'smoke-token',
          registerId: register,
        },
      });
    });
    console.log(
      'POS connection:',
      connected.ok
        ? { ok: true, status: connected.value.session.status }
        : connected,
    );
    if (!connected.ok) throw new Error('Active POS session did not connect');
    if (connected.value.expiresAt <= Date.now())
      throw new Error('Verified cashier access already expired');
  } finally {
    if (worker) await worker.terminate();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().then(
  () => app.exit(0),
  (error) => {
    console.error(error.message);
    app.exit(1);
  },
);
app.on('quit', () => rmSync(directory, { recursive: true, force: true }));
