import { request } from '../../request';
import type { RegisterShiftResponse } from '../../responses/register-shift.response';

export const getRegisterShifts = async (
  registerId: string,
): Promise<RegisterShiftResponse[]> => {
  const response = await request.get('/v1/register-shifts', {
    params: { registerId },
  });
  return response.data.data.register_shifts as RegisterShiftResponse[];
};
