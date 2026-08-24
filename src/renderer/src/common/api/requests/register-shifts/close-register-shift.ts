import { request } from '../../request';
import type { RegisterShiftResponse } from '../../responses/register-shift.response';
import type { CloseRegisterShiftPayload } from '../../types/register-shift.types';

export const closeRegisterShift = async (
  registerShiftId: string,
  payload: CloseRegisterShiftPayload,
): Promise<RegisterShiftResponse> => {
  const response = await request.post(
    `/v1/register-shifts/${registerShiftId}/close`,
    payload,
  );
  return response.data.data.register_shift as RegisterShiftResponse;
};
