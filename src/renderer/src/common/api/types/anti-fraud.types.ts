export type AntiFraudEventType = 'cancel' | 'refund';

export type TriggerAntiFraudEventPayload = {
  externalEventId: string;
  occurredAt: string;
  postBufferSeconds?: number;
  preBufferSeconds?: number;
  reason?: string;
  registerId: string;
  saleId: string;
  type: AntiFraudEventType;
};
