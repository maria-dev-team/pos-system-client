import axios from 'axios';

import { getAccessToken } from '../../access-token.provider';
import { apiConfig } from '../../config/api.config';
import { serializeRequestData } from '../../request-data.serializer';
import type { TriggerAntiFraudEventPayload } from '../../types';

// Capture is best-effort and must not refresh/clear the cashier's auth session,
// participate in the receipt outbox, or build up an unbounded retry queue.
const captureRequest = axios.create({
  baseURL: apiConfig.apiUrl,
  headers: { 'Content-Type': 'application/json' },
  timeout: 5_000,
  withCredentials: false,
});
const inFlight = new Set<string>();
const MAX_IN_FLIGHT = 4;

export const triggerAntiFraudEvent = async (
  payload: TriggerAntiFraudEventPayload,
): Promise<void> => {
  const accessToken = getAccessToken();
  const key = `${payload.registerId}:${payload.externalEventId}`;
  if (!accessToken || inFlight.has(key) || inFlight.size >= MAX_IN_FLIGHT)
    return;

  inFlight.add(key);
  try {
    await captureRequest.post(
      '/v1/anti-fraud/events/trigger',
      serializeRequestData(payload),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  } finally {
    inFlight.delete(key);
  }
};
