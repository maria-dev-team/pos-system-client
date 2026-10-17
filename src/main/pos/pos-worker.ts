import { AsyncLocalStorage } from 'node:async_hooks';
import { parentPort, workerData } from 'node:worker_threads';

import {
  reportError,
  setDiagnosticRetrySink,
  setDiagnosticSink,
} from '../../shared/diagnostics';
import type { PosReply, PosRequest } from '../../shared/pos/contracts';
import { PosError } from '../../shared/pos/contracts';
import { PosDatabase } from './pos-database';
import { PosService } from './pos-service';

const config = workerData as {
  databasePath: string;
  key: Uint8Array;
  apiUrl: string;
};
type DiagnosticContext = { owner: string | null; page?: string };
const execution = new AsyncLocalStorage<DiagnosticContext>();
let connectedContext: DiagnosticContext = { owner: null };
setDiagnosticSink((diagnostic) => {
  const context = execution.getStore() ?? connectedContext;
  parentPort!.postMessage({
    diagnostic: {
      ...diagnostic,
      page: diagnostic.page ?? context.page,
    },
    owner: context.owner,
  });
});
setDiagnosticRetrySink((retry) => parentPort!.postMessage({ retry }));
const db = new PosDatabase(config.databasePath, Buffer.from(config.key));
const service = new PosService(
  db,
  config.apiUrl,
  () => parentPort!.postMessage({ changed: true }),
  fetch,
  (task) => execution.run({ owner: connectedContext.owner }, task),
);
parentPort!.on(
  'message',
  async ({
    id,
    request,
    diagnosticContext = { owner: null },
  }: {
    id: number;
    request: PosRequest;
    diagnosticContext?: DiagnosticContext;
  }) =>
    execution.run(diagnosticContext, async () => {
      if (['connect', 'restore', 'disconnect'].includes(request.type))
        connectedContext = diagnosticContext;
      let reply: PosReply;
      try {
        reply = { ok: true, value: await service.handle(request) };
      } catch (error) {
        reportError(
          error,
          'local',
          request.type,
          'saleId' in request ? request.saleId : undefined,
        );
        reply = {
          ok: false,
          reported: true,
          code: error instanceof PosError ? error.code : 'LOCAL_STORAGE_ERROR',
          ...(error instanceof PosError &&
          error.code === 'PRODUCT_BARCODE_AMBIGUOUS'
            ? { details: error.details }
            : {}),
          message:
            error instanceof PosError || error instanceof RangeError
              ? error.message
              : 'Операция не сохранена. Проверьте локальное хранилище кассы.',
        };
      }
      parentPort!.postMessage({ id, reply });
    }),
);
