import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { queryKeys } from '@renderer/common/constants';
import {
  callLocalPos,
  localPosProfile,
  subscribeLocalPosProfile,
} from '@renderer/common/lib/local-pos';

import type { SaleResponse } from '../../../../shared/pos/contracts';
import {
  LocalPosSyncContext,
  localPosStatusKey,
} from './local-pos-sync-context';
import { LocalPosStatusReader, statusReadIssue } from './read-local-pos-status';

/** One IPC observer for every screen. Reading indicators never starts a backend sync. */
export function LocalPosSyncProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const client = useQueryClient();
  const catalogVersion = useRef<string | null>(null);
  const categoriesVersion = useRef<string | null>(null);
  const profile = useSyncExternalStore(
    subscribeLocalPosProfile,
    localPosProfile,
  );
  const sessionId = profile?.session.id;
  const active = enabled && Boolean(window.localPos && sessionId);
  const [reader] = useState(() => new LocalPosStatusReader());
  const status = useQuery({
    queryKey: [...localPosStatusKey, sessionId],
    queryFn: () => reader.read(sessionId!),
    enabled: active,
    networkMode: 'always',
    refetchInterval: 15000,
    retry: false,
  });
  const state =
    active && !status.isError && status.data?.sessionId === sessionId
      ? status.data
      : undefined;

  useEffect(() => {
    const revision = state?.catalogRevision ?? state?.catalogUpdatedAt;
    if (revision && revision !== catalogVersion.current) {
      catalogVersion.current = revision;
      void client.invalidateQueries({ queryKey: queryKeys.products.all() });
    }
  }, [client, state?.catalogRevision, state?.catalogUpdatedAt]);

  useEffect(() => {
    if (
      state?.categoriesRevision &&
      state.categoriesRevision !== categoriesVersion.current
    ) {
      categoriesVersion.current = state.categoriesRevision;
      void client.invalidateQueries({
        queryKey: queryKeys.categories.tree(profile?.context.organizationId),
      });
    }
  }, [client, state?.categoriesRevision, profile?.context.organizationId]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.localPos?.onChange(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void client.invalidateQueries(
          { queryKey: localPosStatusKey },
          { cancelRefetch: false },
        );
        const sessionId = localPosProfile()?.session.id;
        if (!sessionId) return;
        const currentKey = queryKeys.sales.current(sessionId);
        const requestedId =
          client.getQueryData<SaleResponse | null>(currentKey)?.id ?? null;
        void callLocalPos<SaleResponse | null>({ type: 'current' })
          .then((sale) => {
            if (!disposed && localPosProfile()?.session.id === sessionId)
              client.setQueryData<SaleResponse | null>(
                currentKey,
                (current) => {
                  if (
                    (current?.id ?? null) !== requestedId &&
                    current?.id !== sale?.id
                  )
                    return current;
                  if (
                    current &&
                    sale &&
                    current.id === sale.id &&
                    (current.local_revision ?? 0) > (sale.local_revision ?? 0)
                  )
                    return current;
                  return sale;
                },
              );
          })
          .catch(() => undefined);
        void client.invalidateQueries({
          queryKey: queryKeys.sales.held(sessionId),
        });
      }, 40);
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [client, enabled]);

  return (
    <LocalPosSyncContext.Provider
      value={{
        state,
        active,
        isError: status.isError,
        updatedAt: status.dataUpdatedAt,
        issue: active && status.isError ? statusReadIssue(status.error) : null,
        isChecking: status.isFetching,
        refreshStatus: () => {
          if (active) void status.refetch({ cancelRefetch: false });
        },
      }}
    >
      {children}
    </LocalPosSyncContext.Provider>
  );
}
