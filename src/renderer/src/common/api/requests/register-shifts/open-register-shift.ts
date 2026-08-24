import { request } from '../../request';
import type { RegisterShiftResponse } from '../../responses/register-shift.response';
import type { OpenRegisterShiftPayload } from '../../types/register-shift.types';

export const openRegisterShift = async (
  payload: OpenRegisterShiftPayload,
): Promise<RegisterShiftResponse> => {
  const response = await request.post('/v1/register-shifts', payload);
  return response.data.data.register_shift as RegisterShiftResponse;
};
