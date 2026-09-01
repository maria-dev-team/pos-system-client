import { request } from '../../request';
import type { FiscalShiftReportResponse } from '../../responses/register-shift.response';

export const getZReport = async (
  registerShiftId: string,
): Promise<FiscalShiftReportResponse> => {
  const response = await request.get(
    `/v1/register-shifts/${registerShiftId}/z-report`,
  );
  return response.data.data.z_report as FiscalShiftReportResponse;
};
