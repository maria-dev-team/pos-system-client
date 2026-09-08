// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import type { LocalSale } from '../../shared/pos/contracts';
import { newSale } from '../../shared/pos/sale';
import {
  ids,
  productFixture,
  profileFixture,
} from '../../shared/pos/test-fixtures';
import { PosDatabase } from './pos-database';

const databases: PosDatabase[] = [];
const directories: string[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true }));
});
const open = (path = ':memory:', key = randomBytes(32)): PosDatabase => {
  const db = new PosDatabase(path, key);
  databases.push(db);
  return db;
};
const receipt = (): LocalSale => ({
  sale: newSale(profileFixture(), ids.product, new Date().toISOString()),
  sequence: 1,
  revision: 1,
  syncedRevision: 0,
  serverVersion: 0,
  inFlight: null,
  payment: null,
  error: null,
});
describe('durable local database', () => {
  it('commits the receipt and clock together and never rolls the clock back', () => {
    const db = open();
    const record = receipt();
    db.saveSaleWithClock(record, 200);
    db.saveSaleWithClock({ ...record, sequence: 2 }, 100);
    expect(db.get('clock')).toBe(200);
    expect(db.sale(ids.session, record.sale.id)?.sequence).toBe(2);
  });
  it('rolls back the clock and preserves the previous receipt when a write fails', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-atomic-sale-'));
    directories.push(dir);
    const path = join(dir, 'pos.sqlite');
    const db = open(path);
    const record = receipt();
    db.saveSaleWithClock(record, 100);
    const connection = new DatabaseSync(path);
    try {
      connection.exec(
        "CREATE TRIGGER fail_sale_write BEFORE UPDATE ON local_sales BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END",
      );
    } finally {
      connection.close();
    }
    expect(() => db.saveSaleWithClock({ ...record, sequence: 2 }, 200)).toThrow(
      'simulated storage failure',
    );
    expect(db.get('clock')).toBe(100);
    expect(db.sale(ids.session, record.sale.id)?.sequence).toBe(1);
  });
  it('cannot overwrite and corrupt a receipt belonging to another cashier session', () => {
    const db = open();
    const record = receipt();
    db.save(record);
    expect(() =>
      db.save({
        ...record,
        sale: { ...record.sale, cashier_session_id: ids.shift },
      }),
    ).toThrow('другой смене');
    expect(db.sale(ids.session, record.sale.id)).toEqual(record);
    expect(db.sale(ids.shift, record.sale.id)).toBeNull();
  });
  it('isolates store catalogs, indexes barcode and supports Cyrillic prefix search', async () => {
    const db = open();
    await db.replaceCatalog('store-a', [productFixture()]);
    expect(db.barcode('store-a', productFixture().barcode)?.name).toBe(
      'Молоко цельное',
    );
    expect(db.barcode('store-b', productFixture().barcode)).toBeUndefined();
    expect(
      db.search('store-a', 'моло цел', undefined, 20, 0).products,
    ).toHaveLength(1);
    expect(() =>
      db.search('store-a', '" OR 1=1 --', undefined, 20, 0),
    ).not.toThrow();
  });
  it('atomically keeps the previous complete catalog if refresh fails', async () => {
    const db = open();
    const product = productFixture();
    await db.replaceCatalog('store', [product]);
    await expect(
      db.replaceCatalog('store', [product, product]),
    ).rejects.toThrow();
    expect(db.barcode('store', product.barcode)?.retail_price).toBe('650.00');
  });
  it('combines category and text filters, handles punctuation, and retains FTS after repeated refreshes', async () => {
    const db = open();
    const milk = { ...productFixture(), category_id: 'milk' };
    const bread = {
      ...milk,
      id: 'bread',
      name: 'Хлеб ржаной',
      barcode: 'bread',
      category_id: 'bread',
    };
    for (let i = 0; i < 3; i++) await db.replaceCatalog('store', [milk, bread]);
    expect(db.search('store', 'мол', 'bread', 20, 0).products).toHaveLength(0);
    expect(db.search('store', 'мол', 'milk', 20, 0).products).toHaveLength(1);
    expect(db.search('store', '!!!', undefined, 20, 0).products).toHaveLength(
      0,
    );
    expect(db.search('store', '', undefined, 20, 0).meta.total).toBe(2);
  });
  it('rejects ambiguous barcode/GTIN matches instead of selecting an arbitrary product', async () => {
    const db = open();
    const milk = productFixture();
    await db.replaceCatalog('store', [milk, { ...milk, id: 'other' }]);
    expect(() => db.barcode('store', milk.barcode)).toThrow(
      'нескольким товарам',
    );
  });
  it('restores encrypted records after restart and refuses a wrong key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-db-test-'));
    directories.push(dir);
    const path = join(dir, 'pos.sqlite');
    const key = randomBytes(32);
    const db = new PosDatabase(path, key);
    db.set('intent', { commandId: 'same-id', amount: '650.00' });
    db.close();
    expect(open(path, key).get('intent')).toEqual({
      commandId: 'same-id',
      amount: '650.00',
    });
    expect(() => open(path).get('intent')).toThrow();
  });
  it('paginates exact matches and text results without duplicates or missing rows', async () => {
    const db = open();
    const products = Array.from({ length: 6 }, (_, i) => ({
      ...productFixture(),
      id: `item-${i}`,
      barcode: i === 5 ? 'мол' : `code-${i}`,
    }));
    await db.replaceCatalog('store', products);
    const pages = [0, 2, 4].flatMap(
      (offset) => db.search('store', 'мол', undefined, 2, offset).products,
    );
    expect(pages[0].id).toBe('item-5');
    expect(new Set(pages.map((p) => p.id)).size).toBe(6);
    expect(db.search('store', 'мол', undefined, 2, 4).meta.has_more).toBe(
      false,
    );
  });
  it('migrates existing FTS row IDs without losing the encrypted catalog', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pos-index-upgrade-'));
    directories.push(dir);
    const path = join(dir, 'pos.sqlite');
    const key = randomBytes(32);
    const initial = new PosDatabase(path, key);
    await initial.replaceCatalog('store', [productFixture()]);
    initial.close();
    const legacy = new DatabaseSync(path);
    legacy.exec(
      'UPDATE product_search SET rowid=rowid+1000; PRAGMA user_version=0',
    );
    legacy.close();
    const upgraded = open(path, key);
    expect(
      upgraded.search('store', 'мол', undefined, 20, 0).products,
    ).toHaveLength(1);
    await upgraded.replaceCatalog('store', [productFixture()]);
    expect(
      upgraded.search('store', 'мол', undefined, 20, 0).products,
    ).toHaveLength(1);
  });
});
