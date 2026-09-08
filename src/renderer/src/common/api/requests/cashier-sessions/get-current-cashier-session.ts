import { connectLocalPos, localPosProfile } from '../../../lib/local-pos';
import { request } from '../../request';
import type { CashierSessionResponse } from '../../responses/cashier-session.response';

export const getCurrentCashierSession = async (
  registerId: string,
): Promise<CashierSessionResponse | null> => {
  const local = localPosProfile();
  if (local?.session.register_id === registerId)
    return (await connectLocalPos(registerId)).session;
  const response = await request.get(
    `/v1/registers/${registerId}/cashier-sessions/current`,
  );
  const session = response.data.data
    .cashier_session as CashierSessionResponse | null;
  if (window.localPos && session?.status === 'ACTIVE')
    return (await connectLocalPos(registerId)).session;
  return session;
};
