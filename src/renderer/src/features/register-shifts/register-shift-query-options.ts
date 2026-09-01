import { queryOptions } from '@tanstack/react-query';

import {
  getActiveRegisters,
  getCurrentRegisterShift,
  getRegisterShifts,
} from '@renderer/common/api';
import { queryKeys } from '@renderer/common/constants';

export const activeRegistersQueryOptions = (storeId?: string | null) =>
  queryOptions({
    enabled: Boolean(storeId),
    queryFn: getActiveRegisters,
    queryKey: queryKeys.registers.active(storeId),
    retry: false,
  });

export const currentRegisterShiftQueryOptions = (registerId: string) =>
  queryOptions({
    queryFn: () => getCurrentRegisterShift(registerId),
    queryKey: queryKeys.registerShifts.current(registerId),
    retry: false,
  });

export const registerShiftHistoryQueryOptions = (
  registerId: string,
  enabled: boolean,
) =>
  queryOptions({
    enabled,
    queryFn: () => getRegisterShifts(registerId),
    queryKey: queryKeys.registerShifts.history(registerId),
    retry: false,
  });
