import { request } from '../../request';
import type { RegisterShiftResponse } from '../../responses/register-shift.response';

export const getCurrentRegisterShift = async (
  registerId: string,
): Promise<RegisterShiftResponse | null> => {
  const response = await request.get('/v1/register-shifts/current', {
    params: { registerId },
  });
  return response.data.data.register_shift as RegisterShiftResponse | null;
};
