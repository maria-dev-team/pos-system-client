// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

import { printDeadline, queuePrint } from './print-job';

afterEach(() => vi.useRealTimers());
it('bounds a stuck preparation and releases its queue for the next receipt', async () => {
  vi.useFakeTimers();
  const pending = queuePrint(() =>
    printDeadline(new Promise(() => undefined), 20_000),
  );
  const failed = expect(pending).rejects.toThrow('не завершилась вовремя');
  const next = vi.fn(async () => 'printed');
  const second = queuePrint(next);
  expect(next).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(20_000);
  await failed;
  await expect(second).resolves.toBe('printed');
  expect(vi.getTimerCount()).toBe(0);
});
it('allows only one active and three queued print jobs', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queuePrint(() => gate);
  const waiting = Array.from({ length: 3 }, () =>
    queuePrint(async () => undefined),
  );
  await expect(queuePrint(async () => undefined)).rejects.toThrow(
    'Очередь печати заполнена',
  );
  release();
  await Promise.all([first, ...waiting]);
  await expect(queuePrint(async () => 'ready')).resolves.toBe('ready');
});
