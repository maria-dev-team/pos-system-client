import { request } from '../../request';
import type { FiscalShiftReportResponse } from '../../responses/register-shift.response';

export const getXReport = async (
  registerShiftId: string,
): Promise<FiscalShiftReportResponse> => {
  const response = await request.post(
    `/v1/register-shifts/${registerShiftId}/x-report`,
  );
  return response.data.data.x_report as FiscalShiftReportResponse;
};
