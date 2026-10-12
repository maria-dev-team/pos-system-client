import { type BrowserWindow, app, ipcMain } from 'electron';
import { join } from 'node:path';
import { z } from 'zod';

import {
  reportError,
  setDiagnosticContextReader,
  setDiagnosticRetrySink,
  setDiagnosticSink,
} from '../../shared/diagnostics';
import { isPosSenderTrusted } from '../pos/pos-ipc';
import { ErrorJournal } from './journal';

let journal: ErrorJournal | undefined;
let activeWindow: BrowserWindow | undefined;
let registered = false;
const ownerSchema = z.string().max(1000).nullable();
const tag = z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/);
const diagnosticSchema = z
  .object({
    code: tag,
    source: tag,
    operation: z.string().regex(/^[a-zA-Z0-9_/:.-]{1,300}$/),
    operation_id: z.uuid().optional(),
    trace_id: z.uuid().optional(),
    page: z
      .string()
      .regex(/^[a-zA-Z0-9_/:.-]{0,300}$/)
      .optional(),
    stack: z
      .string()
      .max(2000)
      .regex(/^[a-zA-Z0-9_$.:[\] \n-]*$/)
      .optional(),
  })
  .strict();
export function registerDiagnostics(window: BrowserWindow): void {
  if (activeWindow === window) return;
  activeWindow = window;
  journal ??= new ErrorJournal(
    join(app.getPath('userData'), 'diagnostics', 'errors.json'),
    app.getVersion(),
  );
  setDiagnosticSink((diagnostic, owner) => journal!.report(diagnostic, owner));
  setDiagnosticContextReader(() => ({
    owner: journal!.owner,
    page: journal!.page,
  }));
  setDiagnosticRetrySink((filter) => journal!.retry(filter));
  const handlers: Record<string, (data: unknown) => unknown> = {
    'diagnostics:context': (data) => {
      const input = z
        .object({ owner: ownerSchema, page: z.string().max(300).optional() })
        .strict()
        .parse(data);
      journal!.owner = input.owner;
      journal!.page = input.page;
    },
    'diagnostics:report': (data) => {
      const input = z
        .object({ error: diagnosticSchema, owner: ownerSchema })
        .strict()
        .parse(data);
      journal!.report(input.error, input.owner);
    },
    'diagnostics:pending': (data) =>
      journal!.pending(z.string().max(1000).parse(data)),
    'diagnostics:ack': (data) => {
      const input = z
        .object({ owner: z.string().max(1000), ids: z.array(z.uuid()).max(50) })
        .strict()
        .parse(data);
      journal!.acknowledge(input.owner, input.ids);
    },
    'diagnostics:retry': (data) =>
      journal!.retry(
        z
          .object({
            page: z.string().max(300).optional(),
            source: tag.optional(),
            operation_id: z.uuid().optional(),
            trace_id: z.uuid().optional(),
          })
          .strict()
          .parse(data),
      ),
  };
  if (!registered) {
    for (const [channel, handle] of Object.entries(handlers)) {
      ipcMain.handle(channel, (event, data: unknown) => {
        if (!activeWindow || !isPosSenderTrusted(activeWindow, event))
          throw new Error('Untrusted diagnostics sender');
        return handle(data);
      });
    }
    ipcMain.on('diagnostics:connect', (event, id: unknown) => {
      if (
        activeWindow &&
        isPosSenderTrusted(activeWindow, event) &&
        Number.isSafeInteger(id)
      )
        event.reply('diagnostics:ready', id);
    });
    registered = true;
  }
  // IPC handlers belong to the process, not a closing/reloading window. A late
  // close from the previous window must not remove the new window's handlers.
  window.once('closed', () => {
    if (activeWindow !== window) return;
    activeWindow = undefined;
    journal!.owner = null;
    journal!.page = undefined;
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit')
      reportError({ code: details.reason }, 'renderer', 'crash');
  });
}
