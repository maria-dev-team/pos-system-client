import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { SaleResponse } from './contracts';
import { D, priceSale } from './pricing';
import { applyCommand, newSale } from './sale';
import { ids, productFixture, profileFixture } from './test-fixtures';

describe('local sale domain', () => {
  const profile = profileFixture();
  const now = new Date().toISOString();
  const empty = (): SaleResponse => newSale(profile, randomUUID(), now);
  const add = (): SaleResponse =>
    applyCommand(
      empty(),
      { type: 'add', productId: ids.product },
      profile,
      productFixture(),
      randomUUID(),
      now,
    );

  it('adds and accumulates scans without mutating the previous state', () => {
    const first = add();
    const next = applyCommand(
      first,
      { type: 'add', productId: ids.product },
      profile,
      productFixture(),
      randomUUID(),
      now,
    );
    expect(first.items[0]!.quantity).toBe('1.000');
    expect(next.items[0]!.quantity).toBe('2.000');
    expect(next.total).toBe('1300.00');
    expect(next.items[0]!.vat_amount).toBe('179.31');
  });
  it('checks permissions in the domain even if the UI enables a button', () => {
    const unauthorized = profileFixture();
    unauthorized.context.isSystemPosition = false;
    expect(() =>
      applyCommand(
        empty(),
        { type: 'add', productId: ids.product },
        unauthorized,
        productFixture(),
        randomUUID(),
        now,
      ),
    ).toThrow('Недостаточно прав');
  });
  it('rejects duplicate marking codes and fractional pieces', () => {
    const product = productFixture();
    product.nkt!.is_marked = true;
    const command = {
      type: 'add' as const,
      productId: product.id,
      markingCode: 'unique-mark',
    };
    const first = applyCommand(
      empty(),
      command,
      profile,
      product,
      randomUUID(),
      now,
    );
    expect(() =>
      applyCommand(first, command, profile, product, randomUUID(), now),
    ).toThrow('уже добавлена');
    const unmarked = add();
    expect(() =>
      applyCommand(
        unmarked,
        { type: 'setQuantity', itemId: unmarked.items[0]!.id, quantity: '0.5' },
        profile,
        undefined,
        '',
        now,
      ),
    ).toThrow('Проверьте количество');
  });
  it('distributes discount pennies deterministically and never loses money', () => {
    for (let count = 1; count <= 100; count++) {
      const sale = add();
      sale.items = Array.from({ length: count }, (_, i) => ({
        ...sale.items[0]!,
        id: `item-${i}`,
        line_number: i + 1,
        quantity: '1.000',
        unit_price: `${i + 1}.03`,
      }));
      sale.discount_percentage = '17.35';
      const result = priceSale(sale);
      expect(new D(result.total).plus(result.discount_amount).toFixed(2)).toBe(
        result.subtotal,
      );
      expect(
        result.items
          .reduce((sum, i) => sum.plus(i.line_total), new D(0))
          .toFixed(2),
      ).toBe(result.total);
      expect(
        result.items
          .reduce((sum, i) => sum.plus(i.discount_amount), new D(0))
          .toFixed(2),
      ).toBe(result.discount_amount);
      expect(priceSale(result)).toEqual(result);
    }
  });
  it('rejects amount overflow instead of producing an imprecise total', () => {
    const product = productFixture();
    product.retail_price = '9999999999999999.99';
    expect(() =>
      applyCommand(
        empty(),
        { type: 'add', productId: product.id, quantity: '2' },
        profile,
        product,
        randomUUID(),
        now,
      ),
    ).toThrow('слишком велика');
  });
});
