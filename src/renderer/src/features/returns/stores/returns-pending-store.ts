import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type {
  CreateReceiptReturnPayload,
  CreateWithoutReceiptReturnPayload,
} from '@renderer/common/api';

export type PendingReturnCommand =
  | {
      endpoint: `/v1/returns/receipts/${string}`;
      idempotencyKey: string;
      payload: CreateReceiptReturnPayload;
      receiptNumber: string;
      type: 'receipt';
    }
  | {
      endpoint: '/v1/returns/without-receipt';
      idempotencyKey: string;
      payload: CreateWithoutReceiptReturnPayload;
      type: 'withoutReceipt';
    };

type ReturnsPendingStore = {
  clearPending: (cashierSessionId: string) => void;
  pendingBySession: Record<string, PendingReturnCommand>;
  setPending: (
    cashierSessionId: string,
    command: PendingReturnCommand,
  ) => boolean;
};

export const returnsPendingStorageName = 'maria-pos-pending-returns';

export const useReturnsPendingStore = create<ReturnsPendingStore>()(
  persist(
    (set, get) => ({
      clearPending: (cashierSessionId) =>
        set((state) => {
          const pendingBySession = { ...state.pendingBySession };
          delete pendingBySession[cashierSessionId];
          return { pendingBySession };
        }),
      pendingBySession: {},
      setPending: (cashierSessionId, command) => {
        if (get().pendingBySession[cashierSessionId]) return false;
        set((state) => ({
          pendingBySession: {
            ...state.pendingBySession,
            [cashierSessionId]: command,
          },
        }));
        return true;
      },
    }),
    {
      name: returnsPendingStorageName,
      partialize: (state) => ({ pendingBySession: state.pendingBySession }),
      storage: createJSONStorage(() => window.localStorage),
      version: 1,
    },
  ),
);
