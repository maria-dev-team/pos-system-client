// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { describeError } from '../../shared/diagnostics';
import { ErrorJournal } from './journal';

describe('durable POS errors', () => {
  let directory: string;
  let path: string;
  const failure = {
    code: 'ENOSPC',
    source: 'worker',
    operation: 'sync/draft',
    operation_id: '6f88032f-b184-483b-a37e-7aa3bd15ebaa',
  };
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'pos-diagnostics-'));
    path = join(directory, 'errors.json');
  });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));
  it('persists an unsent local failure and replays exactly the same ID after restart/lost acknowledgement', () => {
    const first = new ErrorJournal(path);
    first.owner = 'cashier-a';
    first.report(failure);
    first.report({ ...failure });
    const [event] = first.pending('cashier-a');
    expect(event).toBeDefined();
    const restarted = new ErrorJournal(path);
    restarted.owner = 'cashier-a';
    restarted.report(failure);
    expect(restarted.pending('cashier-a')).toEqual([event]);
    restarted.acknowledge('cashier-a', [event!.id]);
    const again = new ErrorJournal(path);
    again.owner = 'cashier-a';
    again.report(failure);
    expect(again.pending('cashier-a')).toEqual([]);
  });
  it('only explicit retry re-arms the matching receipt and produces one new occurrence', () => {
    const journal = new ErrorJournal(path);
    journal.owner = 'a';
    const other = {
      ...failure,
      operation_id: '04d818fe-9b5b-4fca-8856-2ea604f74609',
    };
    journal.report(failure);
    journal.report(other);
    journal.acknowledge(
      'a',
      journal.pending('a').map((event) => event.id),
    );
    journal.retry({ source: 'worker', operation_id: failure.operation_id });
    journal.report(other);
    journal.report(failure);
    journal.report(failure);
    expect(journal.pending('a')).toHaveLength(1);
    expect(journal.pending('a')[0]).toMatchObject({
      manual_retry: true,
      operation_id: failure.operation_id,
    });
  });
  it('does not deliver or acknowledge another cashier/store queue', () => {
    const journal = new ErrorJournal(path);
    journal.owner = 'cashier-a/store-a';
    journal.report(failure);
    const [event] = journal.pending('cashier-a/store-a');
    expect(journal.pending('cashier-b/store-b')).toEqual([]);
    journal.acknowledge('cashier-b/store-b', [event!.id]);
    expect(journal.pending('cashier-a/store-a')).toHaveLength(1);
    journal.owner = 'cashier-b/store-b';
    journal.retry({ source: 'worker' });
    journal.owner = 'cashier-a/store-a';
    journal.report(failure);
    expect(journal.pending('cashier-a/store-a')).toHaveLength(1);
  });
  it('delivers startup errors without inventing a cashier identity', () => {
    const journal = new ErrorJournal(path);
    journal.report(failure);
    expect(journal.pending('a')[0]).toMatchObject({ unassigned: true });
  });
  it('retains errors older than a day until acknowledged', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
      const journal = new ErrorJournal(path);
      journal.report(failure);
      vi.setSystemTime(new Date('2026-10-12T00:00:00Z'));
      expect(new ErrorJournal(path).pending('a')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps memory diagnostics when disk persistence is unavailable', () => {
    const journal = new ErrorJournal(directory);
    journal.owner = 'a';
    journal.report(failure);
    expect(journal.pending('a')).toHaveLength(1);
  });
  it('never serializes exception messages, credentials, URLs or request bodies', () => {
    const error = Object.assign(new Error('password=secret'), {
      code: 'ENOSPC',
      body: { token: 'secret' },
    });
    error.stack =
      'Error: password=secret\n    at save (/Users/private-name/secret.ts:10:20)\n    at https://secret:password@camera/path?token=private:1:2';
    const safe = describeError(error, 'worker', '/v1/sales/123?token=secret');
    expect(safe.operation).toBe('/v1/sales/:id');
    expect(safe.stack).toBe('save:10:20\nanonymous:1:2');
    expect(JSON.stringify(safe)).not.toMatch(
      /secret|password|private-name|camera/,
    );
  });
});

it('coalesces renderer and main status deadlines into one occurrence', () => {
  const error = { code: 'LOCAL_POS_STATUS_TIMEOUT' };
  expect(describeError(error, 'renderer', 'query')).toEqual(
    describeError(error, 'local', 'status'),
  );
});
