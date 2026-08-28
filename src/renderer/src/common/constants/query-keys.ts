export const queryKeys = {
  auth: {
    context: () => ['auth', 'context'] as const,
    currentUser: () => ['auth', 'user'] as const,
  },
  cashierSessions: {
    all: () => ['cashier-sessions'] as const,
    current: (registerId: string) =>
      ['cashier-sessions', 'current', registerId] as const,
  },
  health: {
    api: () => ['health', 'api'] as const,
  },
  products: {
    all: () => ['products'] as const,
    detail: (productId: string) => ['products', 'detail', productId] as const,
    search: (
      organizationId: string | null | undefined,
      storeId: string | null | undefined,
      term: string,
    ) =>
      [
        'products',
        'search',
        organizationId ?? null,
        storeId ?? null,
        term,
      ] as const,
  },
  organizations: {
    mine: () => ['organizations', 'mine'] as const,
  },
  registers: {
    active: (storeId?: string | null) =>
      ['registers', 'active', storeId ?? null] as const,
    all: () => ['registers'] as const,
  },
  registerShifts: {
    all: () => ['register-shifts'] as const,
    current: (registerId: string) =>
      ['register-shifts', 'current', registerId] as const,
  },
  sales: {
    all: () => ['sales'] as const,
    current: (cashierSessionId: string) =>
      ['sales', 'current', cashierSessionId] as const,
    detail: (saleId: string) => ['sales', 'detail', saleId] as const,
    held: (cashierSessionId: string) =>
      ['sales', 'held', cashierSessionId] as const,
    receipt: (receiptNumber: string) =>
      ['sales', 'receipts', 'detail', receiptNumber] as const,
    receiptPage: (limit: number, offset: number) =>
      ['sales', 'receipts', 'page', limit, offset] as const,
    receiptPages: () => ['sales', 'receipts', 'page'] as const,
  },
};
