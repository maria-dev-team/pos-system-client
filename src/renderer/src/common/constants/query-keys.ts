export const queryKeys = {
  auth: {
    context: () => ['auth', 'context'] as const,
    currentUser: () => ['auth', 'user'] as const,
  },
  organizations: {
    mine: () => ['organizations', 'mine'] as const,
  },
  registers: {
    active: (storeId?: string | null) =>
      ['registers', 'active', storeId ?? null] as const,
    all: () => ['registers'] as const,
  },
};
