import { queryOptions } from '@tanstack/react-query';

import {
  getActiveRegisters,
  getCurrentRegisterShift,
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
