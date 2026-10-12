import type { PosProfile, PosRequest, SaleResponse } from './contracts';
import { PosError } from './contracts';
import { D, money } from './pricing';

type Checkout = Extract<PosRequest, { type: 'checkout' }>;

export function nonFiscalAllowed(
  profile: PosProfile,
  request: Checkout,
): boolean {
  const settings = profile.register.fiscalization;
  if (!settings.enabled) return true;
  if (settings.policy === 'SELECTIVE')
    return request.fiscalizationMode === 'NON_FISCAL';
  return (
    settings.policy === 'CASHLESS_ONLY' &&
    request.payments.some((p) => p.method === 'CASH')
  );
}

export function nonFiscalSignature(sale: SaleResponse): string {
  return JSON.stringify([
    money(sale.total),
    sale.discount_percentage ? money(sale.discount_percentage) : null,
    sale.items.map((i) => [
      i.product_id,
      new D(i.quantity).toFixed(3),
      money(i.unit_price),
      money(i.line_total),
      i.vat_rate,
      i.marking_code,
    ]),
  ]);
}

/** Called before any network work. The persisted completed sale is immutable. */
export function completeNonFiscalSale(
  sale: SaleResponse,
  request: Checkout,
  now: string,
  paymentId: () => string,
): SaleResponse {
  if (sale.total !== request.total || new D(sale.total).lte(0))
    throw new PosError(
      'PRICE_CHANGED',
      'Проверьте сумму чека и подтвердите оплату ещё раз.',
    );
  const methods = new Set<string>();
  const payments = request.payments.map((p) => {
    if (methods.has(p.method) || !new D(p.amount).gt(0))
      throw new PosError(
        'PAYMENT_DETAILS_INVALID',
        'Проверьте суммы и способы оплаты.',
      );
    methods.add(p.method);
    if (
      (p.method === 'CASH' &&
        (p.received === undefined || new D(p.received).lt(p.amount))) ||
      (p.method === 'CASHLESS' && p.received !== undefined)
    )
      throw new PosError(
        'PAYMENT_DETAILS_INVALID',
        'Проверьте полученную сумму.',
      );
    return {
      id: paymentId(),
      amount: money(p.amount),
      method: p.method,
      received: p.received === undefined ? null : money(p.received),
      change:
        p.received === undefined
          ? null
          : money(new D(p.received).minus(p.amount)),
      status: 'COMPLETED' as const,
      direction: 'INCOMING' as const,
      created_at: now,
      updated_at: now,
      completed_at: now,
    };
  });
  if (
    !payments.length ||
    !payments.reduce((sum, p) => sum.plus(p.amount), new D(0)).eq(sale.total)
  )
    throw new PosError(
      'PAYMENT_DETAILS_INVALID',
      'Сумма оплат должна совпадать с итогом чека.',
    );
  return {
    ...sale,
    status: 'COMPLETED',
    fiscalization_mode: 'NON_FISCAL',
    fiscal_receipt: null,
    receipt_number: `НФ-${sale.id}`,
    completed_at: now,
    updated_at: now,
    payments,
  };
}
