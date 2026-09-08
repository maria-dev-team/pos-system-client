import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

const directory = await mkdtemp(join(tmpdir(), 'pos-worker-smoke-'));
const worker = new Worker(
  new URL('../out/main/pos-worker.js', import.meta.url),
  {
    workerData: {
      databasePath: join(directory, 'pos.sqlite'),
      key: randomBytes(32),
      apiUrl: 'https://unused.invalid',
    },
  },
);
try {
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Worker startup timed out')),
      10000,
    );
    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.on('message', (message) => {
      if (message.id === 1) {
        clearTimeout(timeout);
        resolve(message.reply);
      }
    });
    worker.postMessage({ id: 1, request: { type: 'status' } });
  });
  if (!result.ok || result.value.pending !== 0)
    throw new Error('Invalid worker response');
  console.log('Packaged POS worker, SQLite and message transport: OK');
} finally {
  await worker.terminate();
  await rm(directory, { recursive: true });
}
