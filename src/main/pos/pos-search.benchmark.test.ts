// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';

import { productFixture } from '../../shared/pos/test-fixtures';
import { PosDatabase } from './pos-database';

// Opt-in hardware measurement, not an asserted timing SLA or a network benchmark.
it.skipIf(process.env.POS_BENCHMARK !== '1')(
  'measures encrypted disk-backed lookups with 100,000 products',
  async () => {
    const directory = mkdtempSync(join(tmpdir(), 'pos-search-benchmark-'));
    const db = new PosDatabase(join(directory, 'pos.sqlite'), randomBytes(32));
    try {
      const product = productFixture();
      const products = Array.from({ length: 100000 }, (_, i) => ({
        ...product,
        id: `product-${i}`,
        barcode: String(4870000000000 + i),
        name: `Молоко группа${i % 100} товар${i}`,
      }));
      const started = performance.now();
      await db.replaceCatalog('store', products);
      const seedMs = performance.now() - started;
      const measure = (
        count: number,
        operation: (i: number) => void,
      ): { p50: number; p95: number; max: number } => {
        const samples: number[] = [];
        for (let i = 0; i < count; i++) {
          const start = performance.now();
          operation(i);
          samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        return {
          p50: samples[Math.floor(count * 0.5)],
          p95: samples[Math.floor(count * 0.95)],
          max: samples[count - 1],
        };
      };
      const barcode = measure(1000, (i) =>
        expect(
          db.barcode('store', products[(i * 7919) % products.length].barcode),
        ).toBeDefined(),
      );
      const text = measure(100, (i) =>
        expect(
          db.search('store', `группа${i}`, undefined, 20, 0).products.length,
        ).toBeGreaterThan(0),
      );
      const broad = measure(50, () =>
        expect(
          db.search('store', 'молоко', undefined, 20, 0).products,
        ).toHaveLength(20),
      );
      console.log(
        JSON.stringify(
          {
            products: products.length,
            seedMs,
            barcodeMs: barcode,
            textMs: text,
            broadTextMs: broad,
          },
          null,
          2,
        ),
      );
    } finally {
      db.close();
      rmSync(directory, { recursive: true });
    }
  },
  60000,
);
