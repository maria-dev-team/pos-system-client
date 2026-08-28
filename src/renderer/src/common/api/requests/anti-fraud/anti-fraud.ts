import { request } from '../../request';
import type { TriggerAntiFraudEventPayload } from '../../types';

export const triggerAntiFraudEvent = async (
  payload: TriggerAntiFraudEventPayload,
): Promise<void> => {
  await request.post('/v1/anti-fraud/events/trigger', payload);
};
