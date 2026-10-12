import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { DiagnosticEvent, PosDiagnostic } from '../../shared/diagnostics';

type Entry = {
  owner: string | null;
  key: string;
  event: DiagnosticEvent;
  sent: boolean;
  retry: boolean;
};
/** Separate from the POS database so storage/worker failures can also be reported. */
export class ErrorJournal {
  private entries: Entry[] = [];
  owner: string | null = null;
  page?: string;
  constructor(
    private readonly file: string,
    private readonly version?: string,
  ) {
    try {
      if (existsSync(file))
        this.entries = JSON.parse(readFileSync(file, 'utf8')) as Entry[];
      if (!Array.isArray(this.entries)) this.entries = [];
      this.entries = this.entries.filter(
        (entry) =>
          entry &&
          typeof entry.key === 'string' &&
          (entry.owner === null || typeof entry.owner === 'string') &&
          typeof entry.sent === 'boolean' &&
          typeof entry.retry === 'boolean' &&
          entry.event &&
          typeof entry.event.id === 'string' &&
          Number.isFinite(Date.parse(entry.event.timestamp)) &&
          typeof entry.event.code === 'string' &&
          typeof entry.event.source === 'string' &&
          typeof entry.event.operation === 'string',
      );
    } catch {
      /* The original file stays intact until the next successful write. */
    }
  }
  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(this.file + '.tmp', JSON.stringify(this.entries), {
        mode: 0o600,
      });
      renameSync(this.file + '.tmp', this.file);
    } catch {
      /* Retain the memory queue if the disk is full/unavailable. */
    }
  }
  report(diagnostic: PosDiagnostic, owner = this.owner): void {
    if (diagnostic.source === 'local')
      diagnostic = { ...diagnostic, page: diagnostic.page ?? this.page };
    const key = JSON.stringify([
      diagnostic.source,
      diagnostic.operation,
      diagnostic.operation_id,
      diagnostic.code,
      // Typed errors already have a stable code. Stack identifies otherwise untyped JS failures.
      /^(Error|TypeError|RangeError|UNKNOWN_ERROR)$/.test(diagnostic.code)
        ? diagnostic.stack
        : undefined,
    ]);
    const previous = this.entries.findLast(
      (entry) => entry.owner === owner && entry.key === key,
    );
    if (previous && !previous.retry) return;
    this.entries.push({
      owner,
      key,
      sent: false,
      retry: false,
      event: {
        ...diagnostic,
        client_version: this.version,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        manual_retry: !!previous?.retry,
      },
    });
    // Never evict undelivered errors to make room for activity events.
    // Keep delivered fingerprints for 30 days, matching the analytics retention window.
    this.entries = this.entries.filter(
      (entry) =>
        !entry.sent ||
        Date.parse(entry.event.timestamp) > Date.now() - 30 * 86400000,
    );
    this.save();
  }
  pending(owner: string): DiagnosticEvent[] {
    // Startup errors have no cashier context. Mark them explicitly instead of attributing to a different cashier.
    return this.entries
      .filter(
        (entry) =>
          !entry.sent && (entry.owner === owner || entry.owner === null),
      )
      .slice(0, 50)
      .map((entry) => ({ ...entry.event, unassigned: entry.owner === null }));
  }
  acknowledge(owner: string, ids: string[]): void {
    for (const entry of this.entries)
      if (
        (entry.owner === owner || entry.owner === null) &&
        ids.includes(entry.event.id)
      )
        entry.sent = true;
    this.save();
  }
  retry(filter: {
    page?: string;
    source?: string;
    operation_id?: string;
  }): void {
    if (!filter.page && !filter.source && !filter.operation_id) return;
    for (const entry of this.entries) {
      if (entry.owner !== this.owner && entry.owner !== null) continue;
      if (filter.page && entry.event.page !== filter.page) continue;
      if (filter.source && entry.event.source !== filter.source) continue;
      if (
        filter.operation_id &&
        entry.event.operation_id !== filter.operation_id
      )
        continue;
      entry.retry = true;
    }
    this.save();
  }
}
