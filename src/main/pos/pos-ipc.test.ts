// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { posRequestSchema } from '../../shared/pos/contracts';
import { isPosSenderTrusted } from './pos-ipc';

vi.mock('electron', () => ({ app: {}, ipcMain: {}, safeStorage: {} }));

afterEach(() => vi.unstubAllEnvs());
describe('POS IPC trust boundary', () => {
  it('allows only the main frame of the registered window and the local app origin', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '');
    const frame = { url: 'maria://app/' };
    const contents = { mainFrame: frame };
    const window = { webContents: contents };
    expect(
      isPosSenderTrusted(
        window as never,
        { sender: contents, senderFrame: frame } as never,
      ),
    ).toBe(true);
    expect(
      isPosSenderTrusted(
        window as never,
        { sender: {}, senderFrame: frame } as never,
      ),
    ).toBe(false);
    expect(
      isPosSenderTrusted(
        window as never,
        { sender: contents, senderFrame: { url: frame.url } } as never,
      ),
    ).toBe(false);
    frame.url = 'https://untrusted.example/';
    expect(
      isPosSenderTrusted(
        window as never,
        { sender: contents, senderFrame: frame } as never,
      ),
    ).toBe(false);
  });
  it('rejects arbitrary SQL, paths, forged permission fields and oversized scanner payloads', () => {
    expect(
      posRequestSchema.safeParse({ type: 'sql', sql: 'DELETE FROM products' })
        .success,
    ).toBe(false);
    expect(
      posRequestSchema.safeParse({
        type: 'execute',
        permissions: ['*'],
        command: { type: 'scan', barcode: '123' },
      }).success,
    ).toBe(false);
    expect(
      posRequestSchema.safeParse({
        type: 'execute',
        command: { type: 'scan', barcode: 'a'.repeat(513) },
      }).success,
    ).toBe(false);
  });
});
