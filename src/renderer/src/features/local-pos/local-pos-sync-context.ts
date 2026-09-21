import { createContext, useContext } from 'react';

import type { PosStatus } from '../../../../shared/pos/contracts';

export const localPosStatusKey = ['local-pos', 'status'] as const;
export type LocalPosSyncSnapshot = {
  state: PosStatus | undefined;
  active: boolean;
  isError: boolean;
  updatedAt: number;
  issue: { label: string; detail: string } | null;
  isChecking: boolean;
  refreshStatus: () => void;
};
export const LocalPosSyncContext = createContext<LocalPosSyncSnapshot>({
  state: undefined,
  active: false,
  isError: false,
  updatedAt: 0,
  issue: null,
  isChecking: false,
  refreshStatus: () => {},
});
export const useLocalPosSync = (): LocalPosSyncSnapshot =>
  useContext(LocalPosSyncContext);
