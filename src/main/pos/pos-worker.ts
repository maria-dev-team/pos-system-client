import { parentPort, workerData } from 'node:worker_threads';

import type { PosReply, PosRequest } from '../../shared/pos/contracts';
import { PosError } from '../../shared/pos/contracts';
import { PosDatabase } from './pos-database';
import { PosService } from './pos-service';

const config = workerData as {
  databasePath: string;
  key: Uint8Array;
  apiUrl: string;
};
const db = new PosDatabase(config.databasePath, Buffer.from(config.key));
const service = new PosService(db, config.apiUrl, () =>
  parentPort!.postMessage({ changed: true }),
);
parentPort!.on(
  'message',
  async ({ id, request }: { id: number; request: PosRequest }) => {
    let reply: PosReply;
    try {
      reply = { ok: true, value: await service.handle(request) };
    } catch (error) {
      reply = {
        ok: false,
        code: error instanceof PosError ? error.code : 'LOCAL_STORAGE_ERROR',
        message:
          error instanceof PosError || error instanceof RangeError
            ? error.message
            : 'Операция не сохранена. Проверьте локальное хранилище кассы.',
      };
    }
    parentPort!.postMessage({ id, reply });
  },
);
