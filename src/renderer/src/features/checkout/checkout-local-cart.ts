import Decimal from 'decimal.js';

import type {
  ProductResponse,
  ProductUnit,
  SalePaymentPayload,
} from '@renderer/common/api';
import { quantitySchema } from '@renderer/common/lib/quantity';
import { cashAmountSchema } from '@renderer/common/schemas/cash-amount.schema';

export type CartItem = {
  barcode: string;
  catalogUnitPrice: string;
  name: string;
  priceOverride?: { reason: string; unitPrice: string };
  productId: string;
  productUpdatedAt: string;
  quantity: string;
  sku: string;
  unit: ProductUnit;
};

const parseCashAmount = (value: string) => {
  const parsed = cashAmountSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const decimal = (value: string) => new Decimal(value);

export function cartItemFromProduct(product: ProductResponse): CartItem | null {
  if (!product.is_active || product.retail_price === null) return null;

  return {
    barcode: product.barcode,
    catalogUnitPrice: product.retail_price,
    name: product.name,
    productId: product.id,
    productUpdatedAt: product.updated_at,
    quantity: '1',
    sku: product.sku,
    unit: product.unit,
  };
}

export function findProductByExactBarcode(
  products: readonly ProductResponse[],
  scannerInput: string,
): ProductResponse | null {
  const barcode = scannerInput.trim();
  return (
    products.find(
      (product) =>
        product.barcode === barcode &&
        product.is_active &&
        product.retail_price !== null,
    ) ?? null
  );
}

export function getCartLineTotal(item: CartItem) {
  return decimal(item.priceOverride?.unitPrice ?? item.catalogUnitPrice)
    .mul(decimal(item.quantity))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

export function getCartTotal(items: readonly CartItem[]) {
  return items
    .reduce(
      (total, item) => total.plus(decimal(getCartLineTotal(item))),
      decimal('0'),
    )
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

export function adjustCartItemQuantity(
  item: CartItem,
  delta: -1 | 1,
): CartItem | null {
  const parsed = quantitySchema(item.unit).safeParse(item.quantity);
  if (!parsed.success) return null;

  const quantity = decimal(parsed.data).plus(delta === 1 ? '1' : '-1');
  if (quantity.lte(0)) return null;

  const nextQuantity = quantity.toString();
  if (!quantitySchema(item.unit).safeParse(nextQuantity).success) return null;
  return { ...item, quantity: nextQuantity };
}

export function getCashChange(received: string, cashAmount: string) {
  const parsedReceived = parseCashAmount(received);
  const parsedCashAmount = parseCashAmount(cashAmount);
  if (parsedReceived === null || parsedCashAmount === null) return null;

  const change = decimal(parsedReceived).minus(decimal(parsedCashAmount));
  return change.isNegative() ? null : change.toFixed(2);
}

export function createCashPayment(
  serverTotal: string,
  received: string,
): SalePaymentPayload[] | null {
  const total = parseCashAmount(serverTotal);
  const parsedReceived = parseCashAmount(received);
  if (total === null || parsedReceived === null) return null;
  if (decimal(total).lte(0)) return null;
  if (decimal(parsedReceived).lt(decimal(total))) return null;

  return [{ amount: total, method: 'CASH', received: parsedReceived }];
}

export function createCashlessPayment(
  serverTotal: string,
): SalePaymentPayload[] | null {
  const total = parseCashAmount(serverTotal);
  if (total === null || decimal(total).lte(0)) return null;
  return [{ amount: total, method: 'CASHLESS' }];
}

export function createMixedPayments(
  serverTotal: string,
  cashAmount: string,
  cashReceived: string,
): SalePaymentPayload[] | null {
  const total = parseCashAmount(serverTotal);
  const cash = parseCashAmount(cashAmount);
  const received = parseCashAmount(cashReceived);
  if (total === null || cash === null || received === null) return null;

  const cashDecimal = decimal(cash);
  if (
    !cashDecimal.gt(0) ||
    !cashDecimal.lt(decimal(total)) ||
    decimal(received).lt(cashDecimal)
  ) {
    return null;
  }

  return [
    { amount: cash, method: 'CASH', received },
    {
      amount: decimal(total).minus(cashDecimal).toFixed(2),
      method: 'CASHLESS',
    },
  ];
}
