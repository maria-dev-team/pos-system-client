import Decimal from 'decimal.js';

import {
  type LocalSale,
  PosError,
  type SaleResponse,
} from '../../shared/pos/contracts';
import { assertSaleAcknowledgement } from './pos-outbox';

export type PaymentState = {
  sale: SaleResponse;
  retry_safe: boolean;
  replay_ready: boolean;
  fiscal_state?: string;
};

const invalid = (): never => {
  throw new PosError(
    'POS_API_INVALID_RESPONSE',
    'Сервер вернул некорректное подтверждение оплаты. Чек сохранён для проверки; повторная отправка не выполняется.',
  );
};
const isMoney = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,18}(?:\.\d{1,2})?$/.test(value);
const text = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0;

/** Validate evidence before clearing the durable SENT intent or replaying a command. */
export function assertCompletedPayment(
  sale: unknown,
  record: LocalSale,
): asserts sale is SaleResponse {
  assertSaleAcknowledgement(sale, record);
  const receipt = sale.fiscal_receipt;
  const fiscalizationMode = sale.fiscalization_mode ?? 'FISCAL';
  if (
    sale.status !== 'COMPLETED' ||
    !isMoney(sale.total) ||
    (fiscalizationMode === 'NON_FISCAL' && receipt !== null) ||
    (fiscalizationMode === 'FISCAL' &&
      (!receipt ||
        receipt.status !== 'FISCALIZED' ||
        !['WEBKASSA', 'REKASSA'].includes(receipt.provider) ||
        receipt.currency !== sale.currency ||
        receipt.operation_type !== sale.transaction_type ||
        !isMoney(receipt.total) ||
        !new Decimal(sale.total).eq(receipt.total) ||
        !text(receipt.fiscal_sign) ||
        !text(receipt.receipt_number) ||
        !text(receipt.cashbox_unique_number) ||
        !text(receipt.shift_number))) ||
    (record.payment &&
      !new Decimal(sale.total).eq(record.payment.request.total))
  )
    invalid();
}

export function assertPaymentState(
  value: unknown,
  record: LocalSale,
): asserts value is PaymentState {
  if (!value || typeof value !== 'object') invalid();
  const state = value as PaymentState;
  assertSaleAcknowledgement(state.sale, record);
  if (
    typeof state.retry_safe !== 'boolean' ||
    typeof state.replay_ready !== 'boolean' ||
    (state.retry_safe && state.replay_ready) ||
    (state.retry_safe && !['DRAFT', 'HELD'].includes(state.sale.status)) ||
    (state.replay_ready && state.sale.status !== 'DRAFT') ||
    (state.fiscal_state !== undefined &&
      !['NONE', 'PREPARING', 'SENT', 'REJECTED', 'COMPLETED'].includes(
        state.fiscal_state,
      )) ||
    (state.retry_safe &&
      ['SENT', 'COMPLETED'].includes(state.fiscal_state ?? '')) ||
    (state.replay_ready &&
      state.fiscal_state !== undefined &&
      state.fiscal_state !== 'COMPLETED')
  )
    invalid();
  if (state.sale.status === 'COMPLETED')
    assertCompletedPayment(state.sale, record);
}
