import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import type { ProductSearchResponse } from '../../renderer/src/common/api/responses/product.response';
import type { LocalSale, ProductResponse } from '../../shared/pos/contracts';
import { PosError } from '../../shared/pos/contracts';

/** This connection lives exclusively in the POS worker, never on the UI thread. */
export class PosDatabase {
  private readonly db: DatabaseSync;
  constructor(
    path: string,
    private readonly key: Buffer,
  ) {
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS local_sales (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, value BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS sales_session ON local_sales(session_id, sequence);
      CREATE TABLE IF NOT EXISTS products (scope TEXT NOT NULL, id TEXT NOT NULL, barcode TEXT NOT NULL, gtin TEXT, category TEXT, name TEXT NOT NULL, value BLOB NOT NULL, PRIMARY KEY(scope,id));
      CREATE INDEX IF NOT EXISTS products_barcode ON products(scope,barcode);
      CREATE INDEX IF NOT EXISTS products_gtin ON products(scope,gtin);
      CREATE INDEX IF NOT EXISTS products_category ON products(scope,category,name);
      CREATE INDEX IF NOT EXISTS products_name ON products(scope,name,id);
      CREATE INDEX IF NOT EXISTS products_scope_rowid ON products(scope);
      CREATE VIRTUAL TABLE IF NOT EXISTS product_search USING fts5(scope UNINDEXED, id UNINDEXED, name, tokenize='unicode61');
    `);
    // Align FTS row IDs once, including existing installations. Cleanup then uses
    // indexed row IDs instead of scanning the unindexed FTS scope on every batch.
    if (
      Number(this.db.prepare('PRAGMA user_version').get()?.user_version) < 1
    ) {
      this.db.exec(`BEGIN IMMEDIATE;
        DELETE FROM product_search;
        INSERT INTO product_search(rowid,scope,id,name) SELECT rowid,scope,id,name FROM products;
        PRAGMA user_version=1;
        COMMIT;`);
    }
  }
  private seal(value: unknown, context: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
  }
  private open<T>(value: Uint8Array, context: string): T {
    const b = Buffer.from(value);
    const cipher = createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(b.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString(
        'utf8',
      ),
    ) as T;
  }
  get<T>(key: string): T | null {
    const row = this.db
      .prepare('SELECT value FROM metadata WHERE key = ?')
      .get(key);
    return row ? this.open<T>(row.value as Uint8Array, key) : null;
  }
  set(key: string, value: unknown): void {
    this.db
      .prepare(
        'INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(key, this.seal(value, key));
  }
  save(sale: LocalSale): void {
    this.db
      .prepare(
        'INSERT INTO local_sales(id,session_id,sequence,value) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence,value=excluded.value',
      )
      .run(
        sale.sale.id,
        sale.sale.cashier_session_id,
        sale.sequence,
        this.seal(sale, `sale:${sale.sale.cashier_session_id}:${sale.sale.id}`),
      );
  }
  sales(sessionId: string): LocalSale[] {
    return this.db
      .prepare(
        'SELECT id,value FROM local_sales WHERE session_id = ? ORDER BY sequence',
      )
      .all(sessionId)
      .map((row) =>
        this.open<LocalSale>(
          row.value as Uint8Array,
          `sale:${sessionId}:${row.id}`,
        ),
      );
  }
  sale(sessionId: string, id: string): LocalSale | null {
    const row = this.db
      .prepare('SELECT value FROM local_sales WHERE session_id = ? AND id = ?')
      .get(sessionId, id);
    return row
      ? this.open<LocalSale>(row.value as Uint8Array, `sale:${sessionId}:${id}`)
      : null;
  }
  async replaceCatalog(
    scope: string,
    products: ProductResponse[],
  ): Promise<void> {
    const generation = `${scope}:${randomUUID()}`;
    const insert = this.db.prepare(
      'INSERT INTO products(scope,id,barcode,gtin,category,name,value) VALUES (?,?,?,?,?,?,?)',
    );
    const search = this.db.prepare(
      'INSERT INTO product_search(rowid,scope,id,name) VALUES (?,?,?,?)',
    );
    // Stage bounded batches and yield between them so scans can commit during a large refresh.
    for (let offset = 0; offset < products.length; offset += 100) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const p of products.slice(offset, offset + 100)) {
          const inserted = insert.run(
            generation,
            p.id,
            p.barcode,
            p.nkt?.gtin ?? null,
            p.category_id,
            p.name.toLocaleLowerCase('ru'),
            this.seal(p, `product:${generation}:${p.id}`),
          );
          search.run(inserted.lastInsertRowid, generation, p.id, p.name);
        }
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.set(`catalog-generation:${scope}`, generation);
      this.set(`catalog:${scope}`, new Date().toISOString());
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    // Include abandoned generations from interrupted refreshes, not just the last live one.
    const obsolete = this.db
      .prepare(
        'SELECT DISTINCT scope FROM products WHERE scope <> ? AND (scope = ? OR scope LIKE ?)',
      )
      .all(generation, scope, `${scope}:%`);
    for (const row of obsolete) {
      const previous = row.scope as string;
      // Small cleanup transactions cannot monopolize the writer lock either.
      while (true) {
        this.db.exec('BEGIN IMMEDIATE');
        let count = 0;
        try {
          this.db
            .prepare(
              'DELETE FROM product_search WHERE rowid IN (SELECT rowid FROM products WHERE scope=? LIMIT 100)',
            )
            .run(previous);
          count = Number(
            this.db
              .prepare(
                'DELETE FROM products WHERE scope=? AND id IN (SELECT id FROM products WHERE scope=? LIMIT 100)',
              )
              .run(previous, previous).changes,
          );
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
        if (!count) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }
  }
  private catalogScope(scope: string): string {
    return this.get<string>(`catalog-generation:${scope}`) ?? scope;
  }
  product(scope: string, id: string): ProductResponse | undefined {
    scope = this.catalogScope(scope);
    const row = this.db
      .prepare('SELECT value FROM products WHERE scope=? AND id=?')
      .get(scope, id);
    return row
      ? this.open<ProductResponse>(
          row.value as Uint8Array,
          `product:${scope}:${id}`,
        )
      : undefined;
  }
  barcode(scope: string, barcode: string): ProductResponse | undefined {
    scope = this.catalogScope(scope);
    const rows = this.db
      .prepare(
        'SELECT id,value FROM products WHERE scope=? AND barcode=? UNION SELECT id,value FROM products WHERE scope=? AND gtin=? LIMIT 2',
      )
      .all(scope, barcode, scope, barcode);
    if (rows.length > 1)
      throw new PosError(
        'PRODUCT_BARCODE_AMBIGUOUS',
        'Код соответствует нескольким товарам. Выберите товар по названию.',
      );
    const product = rows[0]
      ? this.open<ProductResponse>(
          rows[0].value as Uint8Array,
          `product:${scope}:${rows[0].id}`,
        )
      : undefined;
    if (product && product.barcode !== barcode && product.nkt?.gtin !== barcode)
      throw new Error('Catalog index integrity failure');
    return product;
  }
  search(
    scope: string,
    term: string,
    category: string | undefined,
    limit: number,
    offset: number,
  ): ProductSearchResponse {
    scope = this.catalogScope(scope);
    const words = term
      .match(/[\p{L}\p{N}]+/gu)
      ?.map((w) => `"${w}"*`)
      .join(' AND ');
    const categoryClause = category ? ' AND category=?' : '';
    const categoryParams = category ? [category] : [];
    let rows;
    if (!term) {
      rows = this.db
        .prepare(
          `SELECT id,value FROM products WHERE scope=?${categoryClause} ORDER BY name,id LIMIT ? OFFSET ?`,
        )
        .all(scope, ...categoryParams, limit + 1, offset);
    } else {
      // Exact identifiers first, then stable FTS row order. Alphabetically sorting
      // every text match made a common word scan/sort the entire 100k catalog.
      const exact = this.db
        .prepare(
          `SELECT id,value FROM products WHERE scope=? AND barcode=?${categoryClause}
        UNION SELECT id,value FROM products WHERE scope=? AND gtin=?${categoryClause} LIMIT ?`,
        )
        .all(
          scope,
          term,
          ...categoryParams,
          scope,
          term,
          ...categoryParams,
          offset + limit + 1,
        );
      rows = exact.slice(offset, offset + limit + 1);
      if (words && rows.length < limit + 1) {
        // Bound FTS to the live generation, including while old generations are
        // being cleaned up. Both bounds are point reads through the scope index.
        const first = this.db
          .prepare(
            'SELECT rowid FROM products INDEXED BY products_scope_rowid WHERE scope=? ORDER BY rowid LIMIT 1',
          )
          .get(scope);
        const last = this.db
          .prepare(
            'SELECT rowid FROM products INDEXED BY products_scope_rowid WHERE scope=? ORDER BY rowid DESC LIMIT 1',
          )
          .get(scope);
        if (first && last)
          rows.push(
            ...this.db
              .prepare(
                `
          SELECT p.id,p.value FROM product_search CROSS JOIN products p ON p.rowid=product_search.rowid
          WHERE product_search MATCH ? AND product_search.rowid BETWEEN ? AND ? AND p.scope=?
            AND p.barcode<>? AND (p.gtin IS NULL OR p.gtin<>?)${category ? ' AND p.category=?' : ''}
          ORDER BY product_search.rowid LIMIT ? OFFSET ?`,
              )
              .all(
                words,
                first.rowid,
                last.rowid,
                scope,
                term,
                term,
                ...categoryParams,
                limit + 1 - rows.length,
                Math.max(0, offset - exact.length),
              ),
          );
      }
    }
    const products = rows.map((r) =>
      this.open<ProductResponse>(
        r.value as Uint8Array,
        `product:${scope}:${r.id}`,
      ),
    );
    const hasMore = products.length > limit;
    return {
      products: products.slice(0, limit),
      meta: {
        limit,
        offset,
        has_more: hasMore,
        total: offset + Math.min(limit, products.length) + Number(hasMore),
      },
    };
  }
  close(): void {
    this.db.close();
  }
}
