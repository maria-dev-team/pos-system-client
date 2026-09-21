import { type SaleResponse, triggerAntiFraudEvent } from '@renderer/common/api';

// Call only after the sale operation succeeds (including a durable local cancel).
// This promise is deliberately never awaited by the sale/return command.
export const reportSaleAntiFraud = async (
  sale: SaleResponse,
  reason?: string,
): Promise<void> => {
  try {
    const type =
      sale.transaction_type === 'SALE' && sale.status === 'CANCELLED'
        ? 'cancel'
        : sale.transaction_type === 'RETURN' && sale.status === 'COMPLETED'
          ? 'refund'
          : null;
    if (!type) return;
    const occurredAt =
      type === 'cancel' ? sale.cancelled_at : sale.completed_at;
    if (!occurredAt) return;

    await triggerAntiFraudEvent({
      externalEventId: `sale-${type}:${sale.id}`,
      occurredAt,
      postBufferSeconds: 15,
      preBufferSeconds: 15,
      reason:
        (type === 'cancel' ? sale.cancellation_reason : sale.return_reason) ??
        reason,
      registerId: sale.register_id,
      saleId: sale.id,
      type,
    });
  } catch {
    // Camera, network and capture errors never change the financial result.
    // Do not replay the operation or persist a receipt-sync failure here.
  }
};
