import { type SaleResponse, triggerAntiFraudEvent } from '@renderer/common/api';

export const reportCancellation = (
  cancelledSale: SaleResponse,
  reason: string,
): void => {
  if (cancelledSale.status !== 'CANCELLED' || !cancelledSale.cancelled_at) {
    return;
  }

  void triggerAntiFraudEvent({
    externalEventId: `sale-cancel:${cancelledSale.id}`,
    occurredAt: cancelledSale.cancelled_at,
    postBufferSeconds: 15,
    preBufferSeconds: 15,
    reason,
    registerId: cancelledSale.register_id,
    saleId: cancelledSale.id,
    type: 'cancel',
  }).catch(() => undefined);
};
