import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import type {
  AuthContextResponse,
  CashierSessionResponse,
} from '@renderer/common/api';
import { organizationsQueryOptions } from '@renderer/features/organizations';
import { currentUserQueryOptions } from '@renderer/features/user';

import type { ReceiptMetadata } from './receipt-data';

/** Cache display-only receipt details while online, before the first offline payment. */
export function useReceiptMetadata(
  context: AuthContextResponse,
  session: CashierSessionResponse,
): ReceiptMetadata {
  const user = useQuery(currentUserQueryOptions());
  const organizations = useQuery(organizationsQueryOptions());
  const key = `pos-receipt-metadata:${session.organization_id}:${session.store_id}:${session.membership_id}`;
  let cached: ReceiptMetadata = {};
  try {
    cached = JSON.parse(localStorage.getItem(key) ?? '{}') as ReceiptMetadata;
  } catch {
    /* No usable cache. */
  }
  const organization = organizations.data?.find(
    (m) => m.organization?.id === session.organization_id,
  )?.organization;
  const store = context.storeScope.stores.find(
    (s) => s.id === session.store_id,
  );
  const name = user.data
    ? [user.data.first_name, user.data.last_name].filter(Boolean).join(' ') ||
      user.data.email
    : null;
  const metadata: ReceiptMetadata = {
    organization: organization
      ? {
          name: organization.name,
          trade_name: organization.trade_name,
          timezone: organization.timezone,
        }
      : cached?.organization,
    store: store ? { name: store.name, address: store.address } : cached?.store,
    currentCashier: name
      ? { id: session.membership_id, name }
      : cached?.currentCashier,
  };
  const serialized = JSON.stringify(metadata);
  useEffect(() => {
    try {
      localStorage.setItem(key, serialized);
    } catch {
      /* Printing still uses in-memory details. */
    }
  }, [key, serialized]);
  return metadata;
}
