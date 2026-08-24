import { request } from '../../request';
import type { RegisterResponse } from '../../responses/register.response';

export const getActiveRegisters = async (): Promise<RegisterResponse[]> => {
  const response = await request.get('/v1/registers', {
    params: { status: 'ACTIVE' },
  });
  return response.data.data.registers as RegisterResponse[];
};
