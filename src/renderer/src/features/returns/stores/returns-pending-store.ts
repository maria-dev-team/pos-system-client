import { create } from 'zustand';

import type { PendingReturnCommand } from '../../../../../shared/pos/return-command';

export type { PendingReturnCommand } from '../../../../../shared/pos/return-command';

export const returnsPendingStorageName = 'maria-pos-pending-returns';
type Pending = Record<string, PendingReturnCommand>;
function read(): Pending {
  if (typeof window === 'undefined') return {};
  const raw = window.localStorage.getItem(returnsPendingStorageName);
  if (!raw) return {};
  const value = JSON.parse(raw);
  if (
    !value?.state?.pendingBySession ||
    typeof value.state.pendingBySession !== 'object'
  )
    throw new Error(
      'Не удалось прочитать очередь возвратов. Не удаляйте данные кассы.',
    );
  return value.state.pendingBySession;
}
function write(pendingBySession: Pending): void {
  window.localStorage.setItem(
    returnsPendingStorageName,
    JSON.stringify({ state: { pendingBySession }, version: 1 }),
  );
}

// Publish only after the synchronous browser fallback has committed. Desktop
// commands additionally use the encrypted worker journal before any HTTP request.
export const useReturnsPendingStore = create<{
  pendingBySession: Pending;
  storageError: Error | null;
  hydrate: () => void;
  publishPending: (
    sessionId: string,
    command: PendingReturnCommand | null,
  ) => void;
  setPending: (sessionId: string, command: PendingReturnCommand) => boolean;
  clearPending: (sessionId: string, expectedKey?: string) => void;
}>()((set, get) => {
  let initial: Pending = {};
  let storageError: Error | null = null;
  try {
    initial = read();
  } catch (error) {
    storageError = error as Error;
  }
  return {
    pendingBySession: initial,
    storageError,
    hydrate: () => {
      const pendingBySession = read();
      set({ pendingBySession, storageError: null });
    },
    publishPending: (sessionId, command) => {
      const pendingBySession = { ...get().pendingBySession };
      if (command) pendingBySession[sessionId] = command;
      else delete pendingBySession[sessionId];
      set({ pendingBySession });
    },
    setPending: (sessionId, command) => {
      if (get().storageError) throw get().storageError;
      if (get().pendingBySession[sessionId]) return false;
      const pendingBySession = {
        ...get().pendingBySession,
        [sessionId]: command,
      };
      write(pendingBySession);
      set({ pendingBySession });
      return true;
    },
    clearPending: (sessionId, expectedKey) => {
      if (
        expectedKey &&
        get().pendingBySession[sessionId]?.idempotencyKey !== expectedKey
      )
        return;
      const pendingBySession = { ...get().pendingBySession };
      delete pendingBySession[sessionId];
      write(pendingBySession);
      set({ pendingBySession });
    },
  };
});

export function assertNoPendingReturns(sessionId?: string): void {
  const state = useReturnsPendingStore.getState();
  if (state.storageError) throw state.storageError;
  if (
    sessionId
      ? state.pendingBySession[sessionId]
      : Object.keys(state.pendingBySession).length
  )
    throw new Error(
      'Сначала проверьте неподтверждённый возврат в окне возвратов.',
    );
}
