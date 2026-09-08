import { localPosProfile } from '../../../lib/local-pos';
import { request } from '../../request';
import type { RegisterShiftResponse } from '../../responses/register-shift.response';

export const getCurrentRegisterShift = async (
  registerId: string,
): Promise<RegisterShiftResponse | null> => {
  const local = localPosProfile();
  if (local?.session.register_id === registerId) return local.shift;
  const response = await request.get('/v1/register-shifts/current', {
    params: { registerId },
  });
  return response.data.data.register_shift as RegisterShiftResponse | null;
};
