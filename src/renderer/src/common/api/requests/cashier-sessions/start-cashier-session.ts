import { request } from '../../request';
import type { CashierSessionResponse } from '../../responses/cashier-session.response';
import type { StartCashierSessionPayload } from '../../types/cashier-session.types';

export const startCashierSession = async (
  registerShiftId: string,
  payload: StartCashierSessionPayload,
): Promise<CashierSessionResponse> => {
  const response = await request.post(
    `/v1/register-shifts/${registerShiftId}/cashier-sessions`,
    payload,
  );
  return response.data.data.cashier_session as CashierSessionResponse;
};
