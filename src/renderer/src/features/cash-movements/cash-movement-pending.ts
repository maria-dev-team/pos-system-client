import type { CashMovementPayload } from '@renderer/common/api';

import { pendingCashMovementSchema } from './cash-movement.schema';

const key = (sessionId: string) => `maria-pos-cash-movement:${sessionId}`;
export function readPendingCashMovement(
  sessionId: string,
): CashMovementPayload | null {
  const raw = localStorage.getItem(key(sessionId));
  return raw ? pendingCashMovementSchema.parse(JSON.parse(raw)) : null;
}
export function savePendingCashMovement(
  sessionId: string,
  payload: CashMovementPayload,
) {
  // Storage must succeed before sending money commands. A retry always uses this exact payload.
  localStorage.setItem(key(sessionId), JSON.stringify(payload));
}
export function clearPendingCashMovement(sessionId: string) {
  localStorage.removeItem(key(sessionId));
}
