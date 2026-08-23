import { request } from '../../request';
import type { AuthContextResponse } from '../../responses/auth-context.response';

export const getAuthContext = async (): Promise<AuthContextResponse> => {
  const response = await request.get('/v1/auth/context');
  return response.data.data.context as AuthContextResponse;
};
