import { request } from '../../request';
import type { AuthResponse } from '../../responses/auth.response';

export const refreshTokens = async (): Promise<AuthResponse> => {
  const response = await request.post('/v1/auth/refresh', {});
  return response.data.data.auth as AuthResponse;
};
