import { request } from '../../request';

export type CashMovementPayload = {
  operationId: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: string;
  reason: string;
};
export type CashMovementResponse = {
  id: string;
  organization_id: string;
  store_id: string;
  register_id: string;
  register_shift_id: string;
  cashier_session_id: string;
  membership_id: string;
  type: 'DEPOSIT' | 'WITHDRAWAL';
  amount: string;
  reason: string;
  created_at: string;
};
export type CashMovementsResponse = {
  movements: CashMovementResponse[];
  balance: string;
  deposited: string;
  withdrawn: string;
  meta: { total: number; limit: number; offset: number; has_more: boolean };
};
export async function getCashMovements(
  sessionId: string,
  offset = 0,
): Promise<CashMovementsResponse> {
  const response = await request.get(
    `/v1/cashier-sessions/${sessionId}/cash-movements`,
    { params: { offset } },
  );
  return response.data.data;
}
export async function createCashMovement(
  sessionId: string,
  payload: CashMovementPayload,
): Promise<CashMovementResponse> {
  const response = await request.post(
    `/v1/cashier-sessions/${sessionId}/cash-movements`,
    payload,
  );
  return response.data.data.movement;
}
