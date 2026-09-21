import type {
  PosProfile,
  ProductResponse,
  SaleCommand,
  SaleResponse,
} from './contracts';
import { PosError } from './contracts';
import { D, money, priceSale } from './pricing';
import { assertProductSellable } from './product-policy';

export function requirePermission(
  profile: PosProfile,
  ...permissions: string[]
): void {
  if (
    !profile.context.isSystemPosition &&
    permissions.some((p) => !profile.context.permissions.includes(p))
  ) {
    throw new PosError(
      'INSUFFICIENT_PERMISSIONS',
      'Недостаточно прав для этой операции.',
    );
  }
}

function quantity(value: string, unit: string): string {
  const n = new D(value);
  if (
    !/^\d{1,6}(?:\.\d{1,3})?$/.test(value) ||
    n.lte(0) ||
    (unit === 'pcs' && !n.isInteger())
  ) {
    throw new PosError(
      'INVALID_PRODUCT_QUANTITY',
      'Проверьте количество товара.',
    );
  }
  return n.toFixed(3);
}

export function newSale(
  profile: PosProfile,
  id: string,
  now: string,
): SaleResponse {
  const s = profile.session;
  return {
    id,
    cashier_session_id: s.id,
    cashier_membership_id: s.membership_id,
    organization_id: s.organization_id,
    store_id: s.store_id,
    register_id: s.register_id,
    register_shift_id: s.register_shift_id,
    currency: 'KZT',
    status: 'DRAFT',
    version: 0,
    transaction_type: 'SALE',
    receipt_number: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    cancelled_at: null,
    held_at: null,
    cancelled_by_membership_id: null,
    cancellation_reason: null,
    original_sale_id: null,
    return_reason: null,
    discount_applied_by_membership_id: null,
    discount_percentage: null,
    discount_reason: null,
    discount_amount: '0.00',
    items: [],
    payments: [],
    fiscal_receipt: null,
    fiscalization_mode: 'FISCAL',
    subtotal: '0.00',
    total: '0.00',
  };
}

/** Pure cart reducer. No React, network, disk or process globals. */
export function applyCommand(
  source: SaleResponse,
  command: SaleCommand,
  profile: PosProfile,
  product: ProductResponse | undefined,
  itemId: string,
  now: string,
): SaleResponse {
  if (source.status !== 'DRAFT')
    throw new PosError('SALE_NOT_EDITABLE', 'Чек уже закрыт или отложен.');
  requirePermission(
    profile,
    source.items.length ? 'sales.modify' : 'sales.create',
  );
  const sale = structuredClone(source);
  if (command.type === 'scan')
    throw new Error('Resolve a scan before applying it');
  if (command.type === 'add') {
    requirePermission(profile, 'product.read');
    assertProductSellable(product, command.markingCode);
    const q = quantity(command.quantity ?? '1', product.unit);
    const nkt = product.nkt && !product.nkt.is_deactivated ? product.nkt : null;
    if (nkt?.is_marked && q !== '1.000')
      throw new PosError(
        'INVALID_PRODUCT_QUANTITY',
        'Маркированный товар добавляется по одной упаковке.',
      );
    if (
      command.markingCode &&
      sale.items.some((i) => i.marking_code === command.markingCode)
    )
      throw new PosError(
        'PRODUCT_MARKING_CODE_DUPLICATE',
        'Эта упаковка уже добавлена в чек.',
      );
    const price = money(product.retail_price);
    const existing = sale.items.find(
      (i) =>
        !i.is_marked &&
        i.product_id === product.id &&
        i.base_unit_price === price &&
        i.unit_price === price &&
        !i.price_overridden_by_membership_id,
    );
    if (existing)
      existing.quantity = quantity(
        new D(existing.quantity).plus(q).toFixed(3),
        product.unit,
      );
    else {
      if (sale.items.length >= 300)
        throw new PosError(
          'SALE_ITEM_LIMIT_EXCEEDED',
          'Достигнут лимит 300 позиций.',
        );
      sale.items.push({
        id: itemId,
        product_id: product.id,
        name: product.name,
        barcode: product.barcode,
        sku: product.sku,
        line_number: Math.max(0, ...sale.items.map((i) => i.line_number)) + 1,
        unit_code: product.unit,
        quantity: q,
        base_unit_price: price,
        unit_price: price,
        line_subtotal: '0.00',
        line_total: '0.00',
        discount_amount: '0.00',
        vat_rate: product.vat_rate ?? 'NONE',
        vat_amount: '0.00',
        nkt_name: nkt?.name_ru ?? null,
        ntin_code: nkt?.ntin_code ?? null,
        gtin: nkt?.gtin ?? product.barcode ?? null,
        is_marked: nkt?.is_marked ?? false,
        marking_code: command.markingCode ?? null,
        price_override_reason: null,
        price_overridden_by_membership_id: null,
        source_sale_item_id: null,
        return_disposition: null,
      });
    }
  } else if (command.type === 'applyDiscount') {
    if (new D(command.percentage).lte(0))
      throw new PosError(
        'SALE_DISCOUNT_PERCENTAGE_INVALID',
        'Укажите скидку больше нуля.',
      );
    sale.discount_percentage = command.percentage;
    sale.discount_reason = command.reason;
    sale.discount_applied_by_membership_id = profile.session.membership_id;
  } else if (command.type === 'resetDiscount') {
    sale.discount_percentage = null;
    sale.discount_reason = null;
    sale.discount_applied_by_membership_id = null;
  } else {
    const item = sale.items.find((i) => i.id === command.itemId);
    if (!item)
      throw new PosError('SALE_ITEM_NOT_FOUND', 'Позиция уже удалена.');
    if (command.type === 'setQuantity') {
      const q = quantity(command.quantity, item.unit_code);
      if (item.is_marked && q !== '1.000')
        throw new PosError(
          'INVALID_PRODUCT_QUANTITY',
          'Нельзя изменить количество маркированного товара.',
        );
      item.quantity = q;
    } else if (command.type === 'remove') {
      if (sale.items.length === 1)
        throw new PosError(
          'SALE_EMPTY',
          'Отмените чек, чтобы удалить последнюю позицию.',
        );
      sale.items = sale.items.filter((i) => i.id !== item.id);
    } else {
      requirePermission(profile, 'sales.price.override');
      if (command.type === 'overridePrice') {
        const price = money(command.unitPrice);
        if (price === item.unit_price)
          throw new PosError(
            'SALE_PRICE_OVERRIDE_SAME_VALUE',
            'Цена совпадает с текущей.',
          );
        item.unit_price = price;
        item.price_override_reason = command.reason;
        item.price_overridden_by_membership_id = profile.session.membership_id;
      } else {
        item.unit_price = item.base_unit_price;
        item.price_override_reason = null;
        item.price_overridden_by_membership_id = null;
      }
    }
  }
  sale.updated_at = now;
  return priceSale(sale);
}

export function draftPayload(
  sale: SaleResponse,
  expectedVersion: number,
  commandId: string,
): Record<string, unknown> {
  return {
    command_id: commandId,
    sale_id: sale.id,
    cashier_session_id: sale.cashier_session_id,
    expected_version: expectedVersion,
    status: sale.status,
    ...(sale.discount_percentage
      ? {
          discount_percentage: sale.discount_percentage,
          discount_reason: sale.discount_reason,
        }
      : {}),
    ...(sale.cancellation_reason
      ? { cancellation_reason: sale.cancellation_reason }
      : {}),
    items: sale.items.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      ...(i.marking_code ? { marking_code: i.marking_code } : {}),
      ...(i.price_overridden_by_membership_id
        ? {
            price_override: {
              unit_price: i.unit_price,
              reason: i.price_override_reason,
            },
          }
        : {}),
    })),
  };
}
