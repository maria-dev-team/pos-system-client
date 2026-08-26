import { request } from '../../request';
import type { CashierSessionResponse } from '../../responses/cashier-session.response';

export const getCurrentCashierSession = async (
  registerId: string,
): Promise<CashierSessionResponse | null> => {
  const response = await request.get(
    `/v1/registers/${registerId}/cashier-sessions/current`,
  );
  return response.data.data.cashier_session as CashierSessionResponse | null;
};
