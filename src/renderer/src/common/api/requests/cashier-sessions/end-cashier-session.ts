import { request } from '../../request';
import type { CashierSessionResponse } from '../../responses/cashier-session.response';
import type { EndCashierSessionPayload } from '../../types/cashier-session.types';

export const endCashierSession = async (
  sessionId: string,
  payload: EndCashierSessionPayload,
): Promise<CashierSessionResponse> => {
  const response = await request.post(
    `/v1/cashier-sessions/${sessionId}/end`,
    payload,
  );
  return response.data.data.cashier_session as CashierSessionResponse;
};
