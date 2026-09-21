import Decimal from 'decimal.js';

import type { SaleResponse } from './contracts';

export const D = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
});
export const money = (value: Decimal.Value): string => {
  const amount = new D(value).toDecimalPlaces(2);
  if (!amount.isFinite() || amount.abs().gt('9999999999999999.99'))
    throw new RangeError('Сумма чека слишком велика.');
  return amount.toFixed(2);
};

/** Mirrors the server's largest-remainder allocation, with deterministic line ordering. */
export function priceSale(sale: SaleResponse): SaleResponse {
  const lines = sale.items.map((item) => ({
    ...item,
    line_subtotal: money(new D(item.unit_price).times(item.quantity)),
  }));
  const subtotal = money(
    lines.reduce((sum, item) => sum.plus(item.line_subtotal), new D(0)),
  );
  const rate = new D(sale.discount_percentage ?? 0);
  if (rate.lt(0) || rate.gte(100))
    throw new RangeError('Скидка должна быть меньше 100%.');
  const discount = money(new D(subtotal).times(rate).div(100));
  const allocations = lines.map((line) => {
    const exact = new D(subtotal).isZero()
      ? new D(0)
      : new D(line.line_subtotal).times(discount).times(100).div(subtotal);
    return {
      line,
      cents: exact.floor(),
      remainder: exact.minus(exact.floor()),
    };
  });
  const remaining = new D(discount)
    .times(100)
    .minus(allocations.reduce((sum, a) => sum.plus(a.cents), new D(0)))
    .toNumber();
  const ranked = [...allocations].sort(
    (a, b) =>
      b.remainder.comparedTo(a.remainder) ||
      a.line.line_number - b.line.line_number ||
      a.line.id.localeCompare(b.line.id),
  );
  for (let i = 0; i < remaining; i++)
    ranked[i]!.cents = ranked[i]!.cents.plus(1);
  const items = allocations.map(({ line, cents }) => {
    const lineTotal = money(new D(line.line_subtotal).minus(cents.div(100)));
    const vat = line.vat_rate === 'NONE' ? new D(0) : new D(line.vat_rate);
    return {
      ...line,
      discount_amount: cents.div(100).toFixed(2),
      line_total: lineTotal,
      vat_amount: money(new D(lineTotal).times(vat).div(vat.plus(100))),
    };
  });
  const total = money(new D(subtotal).minus(discount));
  if (sale.discount_percentage && (discount === '0.00' || total === '0.00'))
    throw new RangeError('Эту скидку нельзя применить к текущей сумме чека.');
  return { ...sale, subtotal, discount_amount: discount, total, items };
}
