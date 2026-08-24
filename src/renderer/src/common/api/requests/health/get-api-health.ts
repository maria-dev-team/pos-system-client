import { statusBarConfig } from '../../../config/status-bar.config';
import { request } from '../../request';
import type { HealthResponse } from '../../responses/health.response';

export const getApiHealth = async (): Promise<HealthResponse> => {
  const response = await request.get('/health', {
    timeout: statusBarConfig.healthCheckTimeoutMs,
  });
  return response.data as HealthResponse;
};
