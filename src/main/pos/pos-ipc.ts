import { type BrowserWindow, app, ipcMain, safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { type PosReply, posRequestSchema } from '../../shared/pos/contracts';

export function isPosSenderTrusted(
  window: BrowserWindow,
  event: Electron.IpcMainInvokeEvent,
): boolean {
  const frame = event.senderFrame;
  if (
    event.sender !== window.webContents ||
    frame !== window.webContents.mainFrame
  )
    return false;
  try {
    const url = new URL(frame.url);
    const dev = process.env.ELECTRON_RENDERER_URL;
    return dev
      ? url.origin === new URL(dev).origin
      : url.protocol === 'maria:' && url.host === 'app';
  } catch {
    return false;
  }
}

async function deviceKey(directory: string): Promise<Buffer> {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error('Secure OS storage is unavailable');
  }
  const path = join(directory, 'device-key');
  try {
    const key = Buffer.from(
      safeStorage.decryptString(await readFile(path)),
      'base64',
    );
    if (key.length !== 32) throw new Error('Invalid device key');
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const databaseExists = await stat(join(directory, 'pos.sqlite')).then(
      () => true,
      (e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') return false;
        throw e;
      },
    );
    if (databaseExists)
      throw new Error('A database exists but its encryption key is missing');
    const key = randomBytes(32);
    const file = await open(path, 'wx', 0o600);
    try {
      await file.writeFile(safeStorage.encryptString(key.toString('base64')));
      await file.sync();
    } finally {
      await file.close();
    }
    return key;
  }
}

export function registerPosIpc(window: BrowserWindow, apiUrl: string): void {
  let nextId = 0;
  const pending = new Map<number, (reply: PosReply) => void>();
  const unavailable: PosReply = {
    ok: false,
    code: 'LOCAL_STORAGE_ERROR',
    message:
      'Локальное хранилище кассы недоступно. Перезапустите приложение; не удаляйте данные кассы.',
  };
  let failed = false;
  const workerReady = (async () => {
    const directory = join(app.getPath('userData'), 'pos');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const key = await deviceKey(directory);
    const worker = new Worker(join(__dirname, 'pos-worker.js'), {
      workerData: { databasePath: join(directory, 'pos.sqlite'), key, apiUrl },
    });
    const fail = (): void => {
      failed = true;
      for (const resolve of pending.values()) resolve(unavailable);
      pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', fail);
    worker.on(
      'message',
      (message: { changed?: boolean; id: number; reply: PosReply }) => {
        if (message.changed) {
          if (!window.isDestroyed()) window.webContents.send('pos:changed');
        } else {
          pending.get(message.id)?.(message.reply);
          pending.delete(message.id);
        }
      },
    );
    window.once('closed', () => {
      fail();
      void worker.terminate();
    });
    return worker;
  })();
  void workerReady.catch(() => {
    failed = true;
  });
  ipcMain.handle(
    'pos:request',
    async (event, input: unknown): Promise<PosReply> => {
      if (!isPosSenderTrusted(window, event))
        return {
          ok: false,
          code: 'FORBIDDEN',
          message: 'Недопустимый источник запроса.',
        };
      const parsed = posRequestSchema.safeParse(input);
      if (!parsed.success)
        return {
          ok: false,
          code: 'INVALID_REQUEST',
          message: 'Некорректные параметры операции.',
        };
      try {
        const worker = await workerReady;
        if (failed || pending.size >= 512) return unavailable;
        return await new Promise<PosReply>((resolve) => {
          const id = ++nextId;
          pending.set(id, resolve);
          worker.postMessage({ id, request: parsed.data });
        });
      } catch {
        return unavailable;
      }
    },
  );
  window.once('closed', () => ipcMain.removeHandler('pos:request'));
}
